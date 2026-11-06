import { playOrder } from "./score/order.js";
import { opts, saveOpts, state } from "./state.js";
import { $, EPS, esc } from "./util.js";

/* ---------- playback ----------
   Piano samples (Salamander Grand Piano, recorded every third semitone) are fetched the first time
   Play is pressed, only for the notes the song needs, and pitch-shifted to the notes in between.
   Times inside a measure are in quarter notes; the speed box is in beats of the first time signature. */
const player = (() => {
  const SAMPLE_NAME = { 0: "C", 3: "Ds", 6: "Fs", 9: "A" };
  const LOW = 21, HIGH = 108; // A0 … C8
  const nearest = (midi) => Math.min(HIGH, Math.max(LOW, LOW + Math.round((midi - LOW) / 3) * 3));
  const SAMPLE_VERSION = 2; // bump when the sample files change: browsers keep them for a year
  const sampleFile = (m) => `piano/${SAMPLE_NAME[m % 12]}${Math.floor(m / 12) - 1}.mp3?v=${SAMPLE_VERSION}`;
  const LOOKAHEAD = 0.3, TICK = 25;

  let ctx = null, master = null;
  const buffers = new Map(), pending = new Map();
  const voices = new Set();       // everything sounding, so Stop can silence it
  let held = new Map();           // row:midi -> voice, so tied notes extend instead of re-striking
  const P = {
    playing: false, starting: false, steps: [], next: 0, t0: 0, qps: 1.5,
    bpm: 90, beatQ: 1, fileTempo: null,
    pos: { step: 0, local: 0 }, timer: null, raf: 0, shownMi: -1, lastSig: "",
    loop: { on: false, from: 0, to: 0 }, userScrollAt: 0,
  };

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error("This browser can't play audio.");
      ctx = new AC({ latencyHint: "interactive" });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      master = ctx.createGain(); master.gain.value = 0.9;
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // Decoding goes through an offline context, so samples can be fetched and decoded as soon as a song
  // opens, before anyone presses Play (a live AudioContext can only start after a tap or click).
  let decoder = null;
  const decode = (b) => {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const c = ctx || decoder || (decoder = new OAC(1, 1, 44100));
    return new Promise((ok, bad) => c.decodeAudioData(b, ok, bad));
  };
  function loadSample(m) {
    if (buffers.has(m)) return Promise.resolve();
    if (!pending.has(m)) {
      pending.set(m, fetch(sampleFile(m))
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(decode)
        .then((buf) => { buffers.set(m, buf); })
        .catch((e) => { pending.delete(m); throw e; }));
    }
    return pending.get(m);
  }
  // samples in the order the song first needs them, so the opening bars are ready first
  function samplesFor(score, fromMi = 0, toMi = score.measures.length - 1) {
    const need = new Set();
    for (let i = fromMi; i <= toMi && i < score.measures.length; i++) {
      for (const evs of Object.values(score.measures[i].rows)) for (const e of evs) for (const n of e.notes) need.add(nearest(n.midi));
    }
    return [...need];
  }
  // the closest sample that has arrived, for the rare note whose own sample is still on its way
  function bufferFor(midi) {
    const sm = nearest(midi);
    if (buffers.has(sm)) return sm;
    let best = null;
    for (const k of buffers.keys()) if (best === null || Math.abs(k - midi) < Math.abs(best - midi)) best = k;
    return best !== null && Math.abs(best - midi) <= 12 ? best : null;
  }
  // fetch the rest in the background, a few at a time, without holding anything up
  function preload(list) {
    const queue = list.filter((m) => !buffers.has(m));
    const worker = () => { const m = queue.shift(); if (m !== undefined) return loadSample(m).catch(() => {}).then(worker); };
    for (let k = 0; k < 4; k++) worker();
  }
  const saveData = () => !!(navigator.connection && navigator.connection.saveData);

  /* ---- sounds ---- */
  function strike(midi, t, end, vel) {
    const sm = bufferFor(midi), buf = sm !== null && buffers.get(sm);
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 2 ** ((midi - sm) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.004);
    src.connect(g).connect(master);
    src.start(t);
    const v = { src, g, vel, end: 0 };
    release(v, end);
    voices.add(v);
    src.onended = () => { voices.delete(v); g.disconnect(); };
    return v;
  }
  function release(v, end) {
    if (v.end) v.g.gain.cancelScheduledValues(Math.max(v.end, ctx.currentTime));
    v.end = end;
    v.g.gain.setValueAtTime(v.vel, end);
    v.g.gain.setTargetAtTime(0, end, 0.09);
    try { v.src.stop(end + 0.8); } catch (e) {}
  }
  function click(t, accent, vol = 1) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime((accent ? 0.5 : 0.32) * vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.06);
  }
  function silence() {
    const now = ctx ? ctx.currentTime : 0;
    for (const v of voices) {
      try { v.g.gain.cancelScheduledValues(now); v.g.gain.setTargetAtTime(0, now, 0.03); v.src.stop(now + 0.15); } catch (e) {}
    }
    voices.clear();
    held = new Map();
  }

  function buildSteps() {
    const ms = state.score.measures;
    let order;
    if (P.loop.on) { order = []; for (let i = P.loop.from; i <= P.loop.to; i++) order.push(i); }
    else order = playOrder(ms);
    let q = 0;
    P.steps = order.map((mi) => { const st = { mi, q }; q += ms[mi].len; return st; });
    P.loopOrder = order;
  }
  function extendLoop() {
    const ms = state.score.measures, last = P.steps[P.steps.length - 1];
    let q = last.q + ms[last.mi].len;
    for (const mi of P.loopOrder) { P.steps.push({ mi, q }); q += ms[mi].len; }
  }
  const at = (q) => P.t0 + q / P.qps;
  const beatOf = (m) => 4 / (m.beatType || 4);

  function scheduleStep(idx, fromQ) {
    const st = P.steps[idx], s = state.score, m = s.measures[st.mi];
    const rows = s.rows.filter((r) => state.visible.has(r.id));
    rows.forEach((r, ri) => {
      const base = rows.length > 1 && ri === rows.length - 1 ? 0.36 : 0.46;
      for (const e of m.rows[r.id] || []) {
        if (e.rest) continue;
        const q = st.q + e.t;
        if (q < fromQ - EPS) continue;
        const vel = base / Math.sqrt(Math.max(1, e.notes.length * 0.6));
        // grace notes: quick and light, just before the beat, so the main note still lands on it
        if (e.grace?.length) {
          const g = e.grace.length, step = Math.min(0.07, (0.25 / P.qps) / g);
          e.grace.forEach((n, k) => {
            const t0 = at(q) - (g - k) * step;
            if (t0 > ctx.currentTime) strike(n.midi, t0, t0 + step * 0.95, vel * 0.7);
          });
        }
        for (const n of e.notes) {
          const key = r.id + ":" + n.midi;
          const prev = held.get(key);
          if (n.held && prev && prev.end >= at(q) - 0.02) { release(prev, at(q + e.d)); continue; }
          const v = strike(n.midi, at(q), at(q + e.d), vel);
          if (v) held.set(key, v);
        }
      }
    });
    if (opts.metro) {
      const b = beatOf(m), shift = Math.max(0, m.timeLen - m.len); // a pickup bar starts part-way through
      for (let x = (b - (shift % b)) % b; x < m.len - EPS; x += b) {
        const q = st.q + x;
        if (q >= fromQ - EPS) click(at(q), Math.abs((x + shift) % m.timeLen) < EPS);
      }
    }
  }

  function tick() {
    if (!P.playing) return;
    const horizon = ctx.currentTime + LOOKAHEAD;
    while (true) {
      if (P.next >= P.steps.length) { if (P.loop.on) extendLoop(); else break; }
      const st = P.steps[P.next];
      if (at(st.q) > horizon) break;
      scheduleStep(P.next, P.fromQ);
      P.next++;
    }
    const last = P.steps[P.steps.length - 1];
    if (!P.loop.on && ctx.currentTime > at(last.q + state.score.measures[last.mi].len) + 0.6) finish();
  }

  /* ---- where we are, for the highlight ---- */
  function nowQ() {
    const lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    return (ctx.currentTime - lat - P.t0) * P.qps;
  }
  function stepAt(q) {
    let lo = 0, hi = P.steps.length - 1;
    if (q < 0) return -1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (P.steps[mid].q <= q + EPS) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function clearMarks() {
    document.querySelectorAll(".measure.playing").forEach((el) => el.classList.remove("playing"));
    document.querySelectorAll(".ev.on").forEach((el) => el.classList.remove("on"));
    P.shownMi = -1;
  }
  function frame() {
    if (!P.playing) return;
    P.raf = requestAnimationFrame(frame);
    const q = nowQ();
    const idx = stepAt(q);
    if (idx < 0) { if (q < 0) { const beats = Math.ceil(-q / P.beatQ - 1e-3); $("#playStatus").textContent = beats > 0 ? `Count-in… ${beats}` : ""; } return; }
    const st = P.steps[idx], local = q - st.q;
    P.pos = { step: idx, local };
    const el = document.querySelector(`.measure[data-mi="${st.mi}"]`);
    if (st.mi !== P.shownMi) {
      clearMarks();
      P.shownMi = st.mi;
      const m = state.score.measures[st.mi];
      $("#playStatus").textContent = `Measure ${m.number}${P.loop.on ? " · looping" : ""}`;
      if (el) { el.classList.add("playing"); follow(el); }
    }
    if (!el) return;
    // off-screen measures only have estimated sizes until drawn, so a long jump can land a little off:
    // check again a few times a second and nudge it back into view
    if (performance.now() - (P.lastCheck || 0) > 250) { P.lastCheck = performance.now(); follow(el); }
    for (const ev of el.querySelectorAll(".ev[data-t]")) {
      const t = +ev.dataset.t, d = +ev.dataset.d;
      ev.classList.toggle("on", local >= t - 0.02 && local < t + Math.max(d, 0.08) - 0.02);
    }
  }
  function follow(el) {
    if (Date.now() - P.userScrollAt < 3500) return; // the reader scrolled away on purpose
    const r = el.getBoundingClientRect(), barH = $("#player").getBoundingClientRect().height + 24;
    if (performance.now() < (P.scrollingUntil || 0)) return; // a smooth scroll is still on its way
    if (r.top < 12 || r.bottom > innerHeight - barH) {
      const far = r.top > innerHeight * 1.5 || r.bottom < -innerHeight * 0.5;
      const smooth = !far && !matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (far) el.scrollIntoView({ block: "center", behavior: "instant" }); // also makes the browser draw it
      const r2 = el.getBoundingClientRect();
      window.scrollTo({ top: scrollY + r2.top - Math.max(12, (innerHeight - barH - r2.height) / 2), behavior: smooth ? "smooth" : "instant" });
      if (smooth) P.scrollingUntil = performance.now() + 700;
    }
  }
  for (const evName of ["wheel", "touchmove"]) addEventListener(evName, () => { P.userScrollAt = Date.now(); }, { passive: true });
  addEventListener("keydown", (e) => { if (["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key) && e.target === document.body) P.userScrollAt = Date.now(); });

  /* ---- transport ---- */
  function setPlayButton(on) {
    $("#playBtn").innerHTML = on
      ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg><span>Pause</span>'
      : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg><span>Play</span>';
  }
  function sig() { return state.transpose + "|" + [...state.visible].sort().join(","); }

  async function play(stepIdx = P.pos.step, local = P.pos.local, countIn = opts.countIn) {
    if (!state.score || P.starting) return;
    P.starting = true;
    try {
      audio();
      metro.stop();
      // wait only for the first few bars from where we start; the rest keeps loading while it plays
      const order = P.loop.on ? null : playOrder(state.score.measures);
      const startMi = order ? order[Math.min(stepIdx, order.length - 1)] ?? 0 : P.loop.from;
      const soon = samplesFor(state.score, startMi, startMi + 3).filter((m) => !buffers.has(m));
      preload(samplesFor(state.score, startMi).concat(samplesFor(state.score)));
      if (soon.length) {
        $("#playStatus").textContent = "Loading the piano…";
        await Promise.all(soon.map(loadSample));
      }
    } catch (e) {
      $("#playStatus").textContent = "Couldn't load the piano sounds. Check your connection and try again.";
      P.starting = false;
      return;
    }
    P.starting = false;
    buildSteps();
    if (stepIdx >= P.steps.length || stepIdx < 0) { stepIdx = 0; local = 0; }
    const fromQ = P.steps[stepIdx].q + local;
    const first = state.score.measures[P.steps[stepIdx].mi];
    const lead = 0.12, ci = countIn ? Math.round(first.timeLen / beatOf(first)) || 4 : 0;
    const ciLen = ci * beatOf(first) / P.qps;
    P.t0 = ctx.currentTime + lead + ciLen - fromQ / P.qps;
    for (let k = 0; k < ci; k++) click(ctx.currentTime + lead + k * beatOf(first) / P.qps, k === 0);
    P.fromQ = fromQ; P.next = stepIdx; P.playing = true; P.lastSig = sig();
    setPlayButton(true);
    clearInterval(P.timer); P.timer = setInterval(tick, TICK);
    tick();
    cancelAnimationFrame(P.raf); P.raf = requestAnimationFrame(frame);
  }
  function pause() {
    if (!P.playing) return;
    const q = nowQ(), idx = Math.max(0, stepAt(q));
    P.pos = { step: idx, local: Math.max(0, q - P.steps[idx].q) };
    halt();
    $("#playStatus").textContent = `Paused at measure ${state.score.measures[P.steps[idx].mi].number}`;
  }
  function halt() {
    P.playing = false;
    clearInterval(P.timer); cancelAnimationFrame(P.raf);
    silence();
    setPlayButton(false);
  }
  function finish() { halt(); clearMarks(); P.pos = { step: 0, local: 0 }; $("#playStatus").textContent = ""; }
  function rewind() {
    const was = P.playing;
    halt(); clearMarks();
    P.pos = { step: 0, local: 0 };
    $("#playStatus").textContent = "";
    if (was) play(0, 0);
  }
  // restart at the same spot after anything that changes what's scheduled (speed, key, staves, loop)
  function reseek(q = P.playing ? nowQ() : 0) {
    if (!P.playing) return;
    const idx = Math.max(0, stepAt(q)), st = P.steps[idx];
    const mi = st.mi, local = Math.max(0, q - st.q);
    halt();
    buildSteps();
    let k = P.steps.findIndex((s, i) => s.mi === mi && i >= Math.min(idx, P.steps.length - 1));
    if (k < 0) k = P.steps.findIndex((s) => s.mi === mi);
    play(k < 0 ? 0 : k, k < 0 ? 0 : local, false);
  }
  function playFrom(mi) {
    if (!state.score) return;
    if (P.loop.on && (mi < P.loop.from || mi > P.loop.to)) {
      P.loop.from = mi; if (P.loop.to < mi) P.loop.to = mi;
      syncLoopUI();
    }
    halt();
    buildSteps();
    const k = P.steps.findIndex((s) => s.mi === mi);
    play(Math.max(0, k), 0);
  }

  /* ---- speed ---- */
  function setBpm(v, fromInput) {
    v = Math.round(Math.max(20, Math.min(300, +v || P.bpm)));
    const q = P.playing ? nowQ() : 0; // where we are, measured at the old speed
    P.bpm = v;
    P.qps = v * P.beatQ / 60;
    if (!fromInput) $("#bpm").value = v;
    const fileBpm = P.fileTempo ? Math.round(P.fileTempo / P.beatQ) : null;
    $("#bpmMark").title = fileBpm ? `The file says ${fileBpm}` : "The file doesn't give a speed";
    reseek(q);
    metro.retime();
  }
  const taps = [];
  function tap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    const b = $("#tapBtn"); b.classList.add("flash"); setTimeout(() => b.classList.remove("flash"), 90);
    if (taps.length >= 3) {
      const gaps = taps.slice(1).map((t, i) => t - taps[i]);
      setBpm(60000 / (gaps.reduce((a, c) => a + c, 0) / gaps.length));
      if (metro.on) metro.start(); // line the clicks up with the taps
      $("#playStatus").textContent = taps.length < 4 ? "Keep tapping…" : `${P.bpm} BPM from your taps`;
    } else if (!P.playing) $("#playStatus").textContent = "Keep tapping at the speed you want…";
  }

  /* ---- metronome on its own, for finding a speed before (or between) playing ---- */
  const metro = (() => {
    let timer = null, next = 0, beat = 0;
    const perBar = () => { const m = state.score?.measures[0]; return m ? Math.round(m.timeLen / beatOf(m)) || 4 : 4; };
    function run() {
      while (next < ctx.currentTime + LOOKAHEAD) { click(next, beat % perBar() === 0, 0.9); beat++; next += 60 / P.bpm; }
    }
    return {
      get on() { return !!timer; },
      start() { audio(); clearInterval(timer); beat = 0; next = ctx.currentTime + 0.06; run(); timer = setInterval(run, TICK); },
      stop() { clearInterval(timer); timer = null; },
      retime() { /* next click already uses the new speed */ },
    };
  })();

  /* ---- loop UI ---- */
  function syncLoopUI() {
    $("#loopRange").hidden = !P.loop.on;
    $("#loopFrom").value = P.loop.from; $("#loopTo").value = P.loop.to;
    document.querySelectorAll(".measure.loop-in").forEach((el) => el.classList.remove("loop-in"));
    if (P.loop.on) for (let i = P.loop.from; i <= P.loop.to; i++) document.querySelector(`.measure[data-mi="${i}"]`)?.classList.add("loop-in");
  }
  function fillLoopMenus(score) {
    const html = score.measures.map((m, i) => `<option value="${i}">${esc(m.number)}</option>`).join("");
    $("#loopFrom").innerHTML = html; $("#loopTo").innerHTML = html;
    P.loop.from = 0; P.loop.to = Math.min(3, score.measures.length - 1);
  }

  /* ---- wiring ---- */
  $("#playBtn").addEventListener("click", () => (P.playing ? pause() : play()));
  $("#rewindBtn").addEventListener("click", rewind);
  $("#bpmDown").addEventListener("click", () => setBpm(P.bpm - (P.bpm > 60 ? 4 : 2)));
  $("#bpmUp").addEventListener("click", () => setBpm(P.bpm + (P.bpm >= 60 ? 4 : 2)));
  $("#bpm").addEventListener("change", (e) => setBpm(e.target.value));
  $("#tapBtn").addEventListener("click", tap);
  $("#measures").addEventListener("click", (e) => { const b = e.target.closest(".mnum"); if (b) playFrom(+b.dataset.mi); });
  $("#optMetro").checked = !!opts.metro;
  $("#optCountIn").checked = !!opts.countIn;
  $("#optMetro").addEventListener("change", (e) => {
    opts.metro = e.target.checked; saveOpts();
    if (P.playing) reseek(); else if (opts.metro) metro.start(); else metro.stop();
  });
  $("#optCountIn").addEventListener("change", (e) => { opts.countIn = e.target.checked; saveOpts(); });
  $("#optLoop").addEventListener("change", (e) => {
    P.loop.on = e.target.checked;
    if (P.loop.on && P.playing) { const cur = P.steps[Math.max(0, stepAt(nowQ()))]?.mi ?? 0; if (cur < P.loop.from || cur > P.loop.to) { P.loop.from = cur; P.loop.to = Math.min(state.score.measures.length - 1, Math.max(cur + 3, P.loop.to)); } }
    syncLoopUI(); reseek();
  });
  const loopEdit = (e) => {
    let a = +$("#loopFrom").value, b = +$("#loopTo").value;
    if (b < a) { if (e.target.id === "loopFrom") b = a; else a = b; }
    P.loop.from = a; P.loop.to = b; syncLoopUI();
    if (P.playing) { const cur = P.steps[Math.max(0, stepAt(nowQ()))]?.mi; if (cur < a || cur > b) playFrom(a); else reseek(); }
  };
  $("#loopFrom").addEventListener("change", loopEdit);
  $("#loopTo").addEventListener("change", loopEdit);
  addEventListener("keydown", (e) => {
    if (e.code !== "Space" || !state.score || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest("input, select, textarea, button, a, [contenteditable]")) return;
    e.preventDefault();
    P.playing ? pause() : play();
  });
  addEventListener("visibilitychange", () => { if (document.hidden && P.playing) pause(); });

  return {
    onLoad(score) {
      halt(); metro.stop(); clearMarks();
      P.pos = { step: 0, local: 0 };
      P.beatQ = beatOf(score.measures[0]);
      P.fileTempo = score.tempo || null;
      P.bpm = Math.round((P.fileTempo || 90) / P.beatQ);
      P.loop.on = false; $("#optLoop").checked = false;
      fillLoopMenus(score);
      // start fetching the piano quietly once the page is idle, unless the visitor is saving data
      if (!saveData()) (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(() => { try { preload(samplesFor(score)); } catch (e) {} });
      $("#playStatus").textContent = P.fileTempo ? "" : "The file doesn't say how fast, so it starts at 90. Tap or use − + to change it.";
      setBpm(P.bpm);
    },
    onRender() {
      syncLoopUI();
      if (P.playing) { P.shownMi = -1; if (sig() !== P.lastSig) reseek(); }
    },
    play, pause, playFrom, playOrder, get state() { return P; },
  };
})();

export { player };
