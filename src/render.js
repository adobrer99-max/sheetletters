import { player } from "./player.js";
import { keyLabel } from "./score/harmony.js";
import { normFifths, transposeScore } from "./score/transpose.js";
import { opts, state } from "./state.js";
import { $, EPS, accText, esc, keyName } from "./util.js";
import { noteName, nameText, chordText, NAME_WIDTH } from "./score/names.js";

/* ---------- rendering ---------- */
// the key each measure is in, for Do-Re-Mi and number names: { fifths, minor } by measure index
function keysByMeasure(s) {
  let fifths = s.keyInfo.fifths, minor = s.keyInfo.mode === "minor";
  return s.measures.map((m) => {
    if (m.key !== undefined) { fifths = m.key; if (m.mode) minor = m.mode === "minor"; }
    return { fifths, minor };
  });
}
let nameKey = { fifths: 0, minor: false }; // the measure being drawn

function noteHTML(n) {
  const x = noteName(n, opts.names || "letters", nameKey.fifths, nameKey.minor);
  const oct = opts.octave ? `<sub>${n.octave}</sub>` : "";
  const pre = x.pre ? `<span class="acc pre">${x.pre}</span>` : "";
  return `<span class="note${n.held ? " held" : ""}${x.text.length > 1 ? " word" : ""}" data-l="${n.step}">${pre}${x.text}${x.acc ? `<span class="acc">${x.acc}</span>` : ""}${oct}</span>`;
}
function lyricText(l) { return l.text + (l.syllabic === "begin" || l.syllabic === "middle" ? "-" : ""); }

function renderFacts() {
  const s = state.score, ki = s.keyInfo, orig = state.original.keyInfo, first = s.measures[0];
  const facts = [];
  if (s.composer) facts.push(`<span>${esc(s.composer)}</span>`);
  facts.push(`<span title="${ki.guessed ? "The file doesn't say major or minor, so this is worked out from the notes." : "As written in the file."}">Key <b>${keyLabel(ki.fifths, ki.mode)}</b>${ki.guessed ? " (likely)" : ""} · ${keyName(ki.fifths)}</span>`);
  if (state.transpose) facts.push(`<span class="moved">Transposed ${semiText(state.transpose)} from ${keyLabel(orig.fifths, orig.mode)}</span>`);
  if (first.time) facts.push(`<span>Time <b>${first.time}</b></span>`);
  facts.push(`<span><b>${s.measures.length}</b> measures</span>`);
  if (s.hasChords) facts.push(`<span>Chords ${s.chordsHeard ? "heard in the recording" : s.chordSource === "score" ? "from the chord symbols in the score" : "worked out from the notes"}</span>`);
  facts.push(`<span>from ${s.format}</span>`);
  $("#facts").innerHTML = facts.join("");
}
const semiText = (n) => `${n > 0 ? "up" : "down"} ${Math.abs(n)} semitone${Math.abs(n) === 1 ? "" : "s"}`;
function accCount(f) { return f === 0 ? "no ♯/♭" : `${Math.abs(f)}${f > 0 ? "♯" : "♭"}`; }
function fillTransposeMenu() {
  const ki = state.original.keyInfo, sel = $("#transpose");
  sel.innerHTML = "";
  for (let n = -6; n <= 5; n++) {
    const f = n ? normFifths(ki.fifths + 7 * n) : ki.fifths;
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n === 0 ? `${keyLabel(f, ki.mode)} · original` : `${keyLabel(f, ki.mode)} · ${n > 0 ? "+" : "−"}${Math.abs(n)} · ${accCount(f)}`;
    sel.appendChild(o);
  }
  sel.value = String(state.transpose);
}
function setTranspose(n) {
  n = Math.max(-6, Math.min(5, n));
  if (n === state.transpose && state.score) return;
  state.transpose = n;
  state.score = transposeScore(state.original, n);
  $("#transpose").value = String(n);
  if (opts.plain || !relabel()) render();
}
// Transposing only changes letters, chord names and key labels; the layout stays put. So instead of
// rebuilding the sheet, swap the text in place. Returns false if the sheet doesn't match the score.
function relabel() {
  const s = state.score, rows = s.rows.filter((r) => state.visible.has(r.id));
  const measures = $("#measures").children;
  if (measures.length !== s.measures.length) return false;
  const keys = keysByMeasure(s);
  for (let mi = 0; mi < measures.length; mi++) {
    const el = measures[mi], m = s.measures[mi];
    nameKey = keys[mi];
    for (const ev of el.querySelectorAll(".ev[data-i]")) {
      const e = m.rows[rows[+ev.dataset.r]?.id]?.[+ev.dataset.i];
      if (!e) return false;
      const lyric = ev.querySelector(".lyric");
      ev.innerHTML = e.notes.map(noteHTML).join("");
      if (lyric) ev.appendChild(lyric);
    }
    const chords = el.querySelectorAll(".chord");
    if (chords.length && chords.length !== m.chords.length) return false;
    chords.forEach((c, i) => { c.textContent = chordText(m.chords[i], opts.names); });
    if (chords.length && !opts.compact) { // a longer chord name can need a wider measure
      const hasLyrics = $("#optLyrics").closest(".chip").hidden === false;
      const w = measureWidth(m, rows.map((r) => m.rows[r.id] || []), opts.lyrics && hasLyrics, true).toFixed(1) + "em";
      if (el.style.width !== w) el.style.width = w;
    }
    const chg = el.querySelector(".chg[data-key]");
    if (chg && m.key !== undefined) chg.textContent = `→ ${keyLabel(m.key, m.mode || s.keyInfo.mode)}`;
  }
  renderFacts();
  player.onRender();
  return true;
}

function measureWidth(m, visibleRows, showLyrics, showChords) {
  if (opts.compact) return null;
  const notesOnly = visibleRows.flat().filter((e) => !e.rest);
  const shortest = Math.max(0.125, Math.min(...notesOnly.map((e) => e.d), m.len));
  const count = Math.max(1, ...visibleRows.map((evs) => evs.length));
  // room for lyrics: each syllable needs its own width so neighbours don't run together
  const lyricRoom = showLyrics ? Math.max(0, ...visibleRows.map((evs) => evs.reduce((w, e) => w + (e.lyric ? Math.max(1.6, lyricText(e.lyric).length * 0.42 + 0.6) : 1.6), 0))) : 0;
  const chordRoom = showChords ? m.chords.reduce((w, c) => w + c.label.length * 0.62 + 0.8, 0) : 0;
  const wide = NAME_WIDTH[opts.names] || 1; // Do-Re-Mi syllables need more room than single letters
  return Math.min(Math.max(m.len / shortest * (showLyrics ? 2.6 : 2) * Math.sqrt(wide), count * 2.1 * wide, lyricRoom, chordRoom, 3.5), 40);
}
function render() {
  const s = state.score;
  if (!s) return;
  renderFacts();
  const rows = s.rows.filter((r) => state.visible.has(r.id));
  const hasLyrics = s.measures.some((m) => Object.values(m.rows).some((evs) => evs.some((e) => e.lyric)));
  $("#optLyrics").closest(".chip").hidden = !hasLyrics;
  const showLyrics = opts.lyrics && hasLyrics;
  $("#optChords").closest(".chip").hidden = !s.hasChords;
  const showChords = opts.chords && s.hasChords;

  $("#sheet").style.setProperty("--zoom", opts.size);
  $("#sheet").classList.toggle("colored", opts.color);
  $("#legend").innerHTML = rows.length > 1
    ? rows.map((r, i) => `<span><b>${i === 0 ? "Top" : i === rows.length - 1 ? "Bottom" : `Row ${i + 1}`}</b> ${esc(r.name)}</span>`).join("")
    : "";

  const html = [];
  const keys = keysByMeasure(s);
  s.measures.forEach((m, mi) => {
    nameKey = keys[mi];
    const visibleRows = rows.map((r) => m.rows[r.id] || []);
    const width = measureWidth(m, visibleRows, showLyrics, showChords);
    const cls = ["measure"];
    if (m.repStart) cls.push("rep-start");
    if (m.repEnd) cls.push("rep-end");
    if (m.final) cls.push("final");
    const head = [`<button class="mnum" type="button" data-mi="${mi}" title="Play from measure ${esc(m.number)}" aria-label="Play from measure ${esc(m.number)}">${esc(m.number)}</button>`];
    if (m.key !== undefined && m !== s.measures[0]) head.push(`<span class="chg" data-key title="Key change: ${keyName(m.key)}">→ ${keyLabel(m.key, m.mode || s.keyInfo.mode)}</span>`);
    if (m.time) head.push(`<span class="chg" title="Time signature">${m.time}</span>`);
    if (m.ending) head.push(`<span class="rep">${esc(m.ending)}.</span>`);
    if (m.repStart) head.push(`<span class="rep">repeat from here</span>`);
    if (m.repEnd) head.push(`<span class="rep">↺ repeat</span>`);
    const chordLine = showChords && m.chords.length
      ? `<div class="chords${opts.compact ? " compact" : ""}">${m.chords.map((c) => `<span class="chord"${opts.compact ? "" : ` style="left:${(c.t / m.len * 100).toFixed(2)}%"`}>${esc(chordText(c, opts.names))}</span>`).join("")}</div>`
      : showChords && s.hasChords ? `<div class="chords"></div>` : "";
    const body = chordLine + visibleRows.map((evs, ri) => {
      const tall = Math.max(1, ...evs.map((e) => e.notes.length));
      const style = opts.compact ? "" : ` style="height:${(tall * 1.2 + (showLyrics ? 1.15 : 0)).toFixed(2)}em"`;
      const items = evs.map((e, ei) => {
        const pos = opts.compact ? "" : ` style="left:${(e.t / m.len * 100).toFixed(2)}%"`;
        const inner = e.rest ? `<span class="rest" title="rest">–</span>` : e.notes.map(noteHTML).join("");
        const lyric = showLyrics && e.lyric ? `<span class="lyric">${esc(lyricText(e.lyric))}</span>` : "";
        return `<div class="ev"${pos}${e.rest ? "" : ` data-t="${e.t}" data-d="${e.d}" data-r="${ri}" data-i="${ei}"`}>${inner}${opts.compact ? lyric : ""}</div>` + (opts.compact ? "" : lyric.replace('class="lyric"', `class="lyric" style="left:${(e.t / m.len * 100).toFixed(2)}%"`));
      }).join("");
      return `<div class="row${opts.compact ? " compact" : ""}"${style}>${items}</div>`;
    }).join("");
    html.push(`<div class="${cls.join(" ")}" data-mi="${mi}"${width ? ` style="width:${width.toFixed(1)}em"` : ""}><div class="mhead">${head.join("")}</div>${body}</div>`);
  });
  $("#measures").innerHTML = html.join("");
  $("#sheet").hidden = opts.plain;
  $("#plain").hidden = !opts.plain;
  if (opts.plain) $("#plain").textContent = toText();
  player.onRender();
}

/* ---------- plain-text export ---------- */
function toText() {
  const s = state.score;
  const rows = s.rows.filter((r) => state.visible.has(r.id));
  const showLyrics = opts.lyrics;
  const out = [s.title || "Untitled", ""];
  const ki = s.keyInfo;
  out.push(`Key: ${keyLabel(ki.fifths, ki.mode)}${ki.guessed ? " (likely)" : ""}, ${keyName(ki.fifths)}` + (s.measures[0].time ? `   Time: ${s.measures[0].time}` : ""));
  if (state.transpose) out.push(`Transposed ${semiText(state.transpose)} from ${keyLabel(state.original.keyInfo.fifths, state.original.keyInfo.mode)}`);
  const showChords = opts.chords && s.hasChords;
  out.push("[ ] = play together   ~ = keep holding (tied)   _ = rest   | = bar line", "");
  const PER_LINE = 4;
  const keys = keysByMeasure(s), naming = opts.names || "letters";
  for (let i = 0; i < s.measures.length; i += PER_LINE) {
    const group = s.measures.slice(i, i + PER_LINE);
    out.push(`m.${group[0].number}`);
    // build each row's measures as [notes, words] cells, then pad so bar lines line up across rows
    const cells = rows.map((r, ri) => group.map((m, gi) => {
      const key = keys[i + gi];
      let notes = "", words = "", chords = "";
      const evs = m.rows[r.id] || [];
      // chord names ride on the top row: each goes over the note it starts on (or the one before it)
      const chordAt = new Map();
      if (ri === 0 && showChords) for (const c of m.chords) {
        let k = evs.findIndex((e) => e.t > c.t + EPS) - 1;
        if (k < 0) k = evs.findIndex((e) => e.t > c.t + EPS) === -1 ? evs.length - 1 : 0;
        chordAt.set(k, (chordAt.has(k) ? chordAt.get(k) + " " : "") + chordText(c, naming));
      }
      if (!evs.length && chordAt.size) chords = " " + [...chordAt.values()].join(" ") + " ";
      for (const [k, e] of evs.entries()) {
        let tok = e.rest ? "_" : [...e.notes].reverse().map((n) => (n.held ? "~" : "") + nameText(n, naming, key.fifths, key.minor) + (opts.octave ? n.octave : "")).join(" ");
        if (e.notes.length > 1) tok = `[${tok}]`;
        const ly = e.lyric ? lyricText(e.lyric) : "";
        const ch = chordAt.get(k) || "";
        const w = Math.max(tok.length, ly.length, ch.length) + 1;
        chords += " " + ch.padEnd(w);
        notes += " " + tok.padEnd(w);
        words += " " + ly.padEnd(w);
      }
      notes = notes.padEnd(chords.length);
      return [notes, words, chords];
    }));
    const widths = group.map((_, j) => Math.max(...cells.map((c) => c[j][0].length)));
    const label = Math.max(...rows.map((r) => r.name.length)) + 2;
    rows.forEach((r, i) => {
      const chordLine = i === 0 ? cells[0].map((c, j) => c[2].padEnd(widths[j]) + " ").join("") : "";
      if (chordLine.trim()) out.push((" ".repeat((rows.length > 1 ? label : 0) + 1) + chordLine).trimEnd());
      const prefix = rows.length > 1 ? (r.name + ":").padEnd(label) : "";
      out.push((prefix + "|" + cells[i].map((c, j) => c[0].padEnd(widths[j]) + "|").join("")).trimEnd());
      const words = cells[i].map((c, j) => c[1].padEnd(widths[j]) + " ").join("");
      if (showLyrics && words.trim()) out.push((" ".repeat(prefix.length + 1) + words).trimEnd());
    });
    out.push("");
  }
  return out.join("\n");
}

export { keysByMeasure, noteHTML, lyricText, renderFacts, semiText, accCount, fillTransposeMenu, setTranspose, relabel, measureWidth, render, toText };
