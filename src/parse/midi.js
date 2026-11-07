import { $, EPS, FLAT_SPELL, SHARP_SPELL, addNote } from "../util.js";

/* ---------- MIDI ---------- */
function parseMIDI(buf) {
  const v = new DataView(buf), u8 = new Uint8Array(buf);
  const ascii = (a, n) => String.fromCharCode(...u8.subarray(a, a + n));
  let p = 0;
  // RIFF-wrapped MIDI (.rmi)
  if (ascii(0, 4) === "RIFF") { const i = u8.findIndex((_, k) => ascii(k, 4) === "MThd"); if (i > 0) p = i; }
  if (ascii(p, 4) !== "MThd") throw new Error("This file isn't a standard MIDI file.");
  const hlen = v.getUint32(p + 4), format = v.getUint16(p + 8), ntracks = v.getUint16(p + 10), ppq = v.getUint16(p + 12);
  if (ppq & 0x8000) throw new Error("This MIDI file uses frame-based (SMPTE) timing, which can't be split into measures. Re-export it from your notation app.");
  p += 8 + hlen;
  const vlq = () => { let n = 0, b; do { b = u8[p++]; n = (n << 7) | (b & 0x7f); } while (b & 0x80 && p < u8.length); return n; };
  const tracks = [], timeSigs = [], keySigs = [], lyrics = [];
  let songTitle = "", tempoUs = null;
  for (let t = 0; t < ntracks && p + 8 <= u8.length; t++) {
    if (ascii(p, 4) !== "MTrk") break;
    const end = Math.min(u8.length, p + 8 + v.getUint32(p + 4));
    p += 8;
    let tick = 0, running = 0, name = "";
    const open = {}, notes = [];
    while (p < end) {
      tick += vlq();
      let status = u8[p];
      if (status < 0x80) status = running; else { p++; if (status < 0xF0) running = status; }
      if (status === 0xFF) {
        const type = u8[p++], len = vlq(), at = p;
        const str = () => new TextDecoder("latin1").decode(u8.subarray(at, at + len));
        if (type === 0x03 && !name) name = str().trim();
        if (type === 0x05) lyrics.push({ tick, text: str(), track: t });
        if (type === 0x58) timeSigs.push({ tick, beats: u8[at], beatType: 2 ** u8[at + 1] });
        if (type === 0x51 && len === 3 && tempoUs == null) tempoUs = (u8[at] << 16) | (u8[at + 1] << 8) | u8[at + 2];
        if (type === 0x59) keySigs.push({ tick, fifths: (u8[at] << 24) >> 24, minor: u8[at + 1] === 1 });
        p = at + len;
        if (type === 0x2F) break;
      } else if (status === 0xF0 || status === 0xF7) {
        p += vlq();
      } else {
        const hi = status & 0xF0, ch = status & 0x0F;
        const d1 = u8[p++], d2 = hi === 0xC0 || hi === 0xD0 ? 0 : u8[p++];
        const key = ch * 128 + d1;
        if (hi === 0x90 && d2 > 0) (open[key] || (open[key] = [])).push(tick);
        else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) {
          const start = open[key]?.shift();
          if (start !== undefined) notes.push({ start, end: tick, pitch: d1, ch });
        }
      }
    }
    for (const key in open) for (const start of open[key]) notes.push({ start, end: tick, pitch: key % 128, ch: Math.floor(key / 128) });
    p = end;
    if (!notes.length && name && !songTitle && format === 1 && t === 0) songTitle = name;
    tracks.push({ name, notes, index: t });
  }

  // one row per track (or per channel for single-track files); channel 10 is drums, which have no letters
  const rowsSrc = [];
  for (const tr of tracks) {
    const byCh = {};
    for (const n of tr.notes) if (n.ch !== 9) (byCh[n.ch] || (byCh[n.ch] = [])).push(n);
    const chs = Object.keys(byCh);
    if (chs.length === 1 || (chs.length > 1 && format !== 0)) {
      rowsSrc.push({ name: tr.name || `Track ${tr.index + 1}`, notes: chs.flatMap((c) => byCh[c]), track: tr.index });
    } else {
      for (const c of chs) rowsSrc.push({ name: `Channel ${+c + 1}`, notes: byCh[c], track: tr.index });
    }
  }
  if (!rowsSrc.length) throw new Error("This MIDI file has no pitched notes (it may be drums only).");

  // measures from time signatures
  timeSigs.sort((a, b) => a.tick - b.tick);
  keySigs.sort((a, b) => a.tick - b.tick);
  const lastTick = Math.max(...rowsSrc.flatMap((r) => r.notes.map((n) => n.end)));
  const measures = [];
  let tick = 0, ts = { beats: 4, beatType: 4 }, tsi = 0, prevTime = "", prevKey = null;
  while (tick < lastTick - ppq / 24 || measures.length === 0) {
    while (tsi < timeSigs.length && timeSigs[tsi].tick <= tick) ts = timeSigs[tsi++];
    const len = ts.beats * 4 / ts.beatType;
    const m = { number: String(measures.length + 1), len, timeLen: len, beatType: ts.beatType, start: tick, rows: {} };
    const time = `${ts.beats}/${ts.beatType}`;
    if (time !== prevTime) { m.time = time; prevTime = time; }
    const k = keySigs.filter((s) => s.tick <= tick + ppq / 24).pop();
    const fifths = k ? k.fifths : 0;
    if (fifths !== prevKey) { m.key = fifths; prevKey = fifths; if (k?.minor) m.mode = "minor"; }
    m.fifths = fifths;
    measures.push(m);
    tick += Math.round(len * ppq);
    if (measures.length > 5000) break;
  }
  const grid = ppq / 12; // 1/12 of a beat catches sixteenths and triplets
  const q = (tk) => Math.round(tk / grid) * grid;
  const locate = (tk) => { let i = measures.length - 1; while (i > 0 && measures[i].start > tk + EPS) i--; return i; };

  const rows = rowsSrc.map((r, i) => {
    const id = `r${i}`;
    for (const n of r.notes) {
      const s = q(n.start), e = Math.max(q(n.end), s + grid);
      // a note that rings across a bar line carries on into the next bar as a held (tied) note
      let mi = locate(s), from = s, held = false;
      while (mi < measures.length) {
        const m = measures[mi];
        const t = (from - m.start) / ppq, d = Math.min((e - from) / ppq, m.len - t);
        const [step, alter] = (m.fifths < 0 ? FLAT_SPELL : SHARP_SPELL)[n.pitch % 12];
        const octave = Math.floor((n.pitch - alter) / 12) - 1;
        addNote(m.rows[id] || (m.rows[id] = []), t, Math.max(d, 1 / 12), { step, alter, octave, midi: n.pitch, held });
        const next = measures[mi + 1];
        if (!next || e <= next.start + grid / 2) break;
        from = next.start; held = true; mi++;
      }
    }
    return { id, name: r.name, track: r.track };
  });

  // lyrics: attach to the note that starts at the same moment, preferring the lyric's own track
  for (const ly of lyrics) {
    let text = ly.text.replace(/[\r\n]/g, "").replace(/^[\\/]+/, "").trim();
    if (!text || text.startsWith("@")) continue; // karaoke header lines
    let syllabic = "single";
    if (text.endsWith("-")) { syllabic = "begin"; text = text.slice(0, -1); }
    const s = q(ly.tick), m = measures[locate(s)], t = (s - m.start) / ppq;
    const order = [...rows].sort((a, b) => (b.track === ly.track) - (a.track === ly.track));
    for (const r of order) {
      const ev = (m.rows[r.id] || []).find((e) => Math.abs(e.t - t) < 0.26 && !e.lyric);
      if (ev) { ev.lyric = { text, syllabic }; break; }
    }
  }
  pickupBar(measures);
  // MIDI files often leave the major/minor flag at its default, so only a "minor" flag counts as stated
  return { title: songTitle, composer: "", format: "MIDI", rows, measures, mode: keySigs[0]?.minor ? "minor" : null, tempo: tempoUs ? 60e6 / tempoUs : 120 };
}

/** MIDI files can't say "this song starts with a pickup", so a tune starting on the last beat
 *  shows up as a mostly empty first bar. When nothing plays for at least a whole beat at the start,
 *  shorten bar 1 to just the part that's played, as sheet music writes it: a short "bar 0" before
 *  bar 1. Records how much was cut (in quarter notes) as m.pickupCut, for anything placed later. */
function pickupBar(measures) {
  const m = measures[0];
  if (!m || measures.length < 2) return;
  const evs = Object.values(m.rows).flat();
  if (!evs.length) return;
  const first = Math.min(...evs.map((e) => e.t));
  const beat = 4 / (m.beatType || 4);
  const cut = Math.floor((first + EPS) / beat) * beat;
  if (cut < beat - EPS || cut >= m.len - EPS) return;
  for (const evs2 of Object.values(m.rows)) for (const e of evs2) e.t -= cut;
  m.len -= cut;
  m.pickupCut = cut;
  m.pickup = true;
  measures.forEach((x, i) => { x.number = String(i); }); // the pickup is bar 0, the first full bar is 1
}

export { parseMIDI, pickupBar };
