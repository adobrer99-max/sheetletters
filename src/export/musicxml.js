// Save a song as MusicXML, the format MuseScore, Sibelius, Finale and Dorico all open.
// Keeps notes and rests, ties, chords stacked on a staff, chord symbols, lyrics, triplets, grace
// notes, key, time and tempo changes, repeats and 1st/2nd endings. One part per staff row.
//
// Within one row a note that's still sounding when the next one starts is shortened to it (MusicXML
// would need a second voice for the overlap); everything else comes back exactly as it was.

import { HARMONY_KINDS } from "../score/harmony.js";

const D = 48; // divisions per quarter note: sixteenths (12), triplets (16) and 32nds (6) are whole numbers
const EPS = 1e-6;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const KIND_OF = Object.fromEntries(Object.entries(HARMONY_KINDS).map(([kind, suffix]) => [suffix, kind]));

// note values with their MusicXML names, longest first, dotted ones included
const VALUES = [];
for (const [len, type] of [[4, "whole"], [2, "half"], [1, "quarter"], [0.5, "eighth"], [0.25, "16th"], [0.125, "32nd"], [0.0625, "64th"]]) {
  VALUES.push({ len: len * 1.5, type, dot: true }, { len, type, dot: false });
}
VALUES.sort((a, b) => b.len - a.len);

/** A length in quarter notes as one or more note values (tied if more than one). Triplet lengths
 *  (thirds of a beat) come back as triplet notes. */
export function noteValues(len) {
  const exact = VALUES.find((v) => Math.abs(v.len - len) < EPS);
  if (exact) return [{ ...exact }];
  const third = len * 3;
  if (Math.abs(third - Math.round(third)) < EPS) {
    // a triplet note is 2/3 of the plain one: 1/3 is a triplet eighth, 2/3 a triplet quarter
    const plain = VALUES.find((v) => !v.dot && Math.abs(v.len * (2 / 3) - len) < EPS);
    if (plain) return [{ len, type: plain.type, dot: false, triplet: true }];
  }
  const out = [];
  let left = len;
  while (left > EPS) {
    const v = VALUES.find((x) => x.len <= left + EPS) || VALUES[VALUES.length - 1];
    if (v.len > left + EPS) { out.push({ len: left, type: v.type, dot: false }); break; } // tiny remainder
    out.push({ ...v }); left -= v.len;
  }
  return out;
}

const pitchXML = (n) => `<pitch><step>${n.step}</step>${n.alter ? `<alter>${n.alter}</alter>` : ""}<octave>${n.octave}</octave></pitch>`;
const durXML = (len) => `<duration>${Math.max(1, Math.round(len * D))}</duration>`;
const typeXML = (v) => `<type>${v.type}</type>${v.dot ? "<dot/>" : ""}${v.triplet ? "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>" : ""}`;

function harmonyXML(c) {
  if (c.text) return `<harmony><root><root-step>C</root-step></root><kind text="${esc(c.text)}">none</kind><offset>${Math.round(c.t * D)}</offset></harmony>`;
  const kind = KIND_OF[c.suffix];
  const kindXML = kind ? `<kind>${kind}</kind>` : `<kind text="${esc(c.suffix)}">major</kind>`;
  const alter = (a) => (a ? `<root-alter>${a}</root-alter>` : "");
  const bass = c.bass ? `<bass><bass-step>${c.bass.step}</bass-step>${c.bass.alter ? `<bass-alter>${c.bass.alter}</bass-alter>` : ""}</bass>` : "";
  return `<harmony><root><root-step>${c.root.step}</root-step>${alter(c.root.alter)}</root>${kindXML}${bass}<offset>${Math.round(c.t * D)}</offset></harmony>`;
}

const syllabic = (l) => l.syllabic || "single";

/** The whole song as a MusicXML document (a string). */
export function toMusicXML(s, { tempo } = {}) {
  const parts = [], list = [];
  const firstKey = s.measures.find((m) => m.key !== undefined)?.key ?? s.keyInfo?.fifths ?? 0;
  s.rows.forEach((row, ri) => {
    const id = `P${ri + 1}`;
    list.push(`<score-part id="${id}"><part-name>${esc(row.name || `Part ${ri + 1}`)}</part-name></score-part>`);
    const all = s.measures.flatMap((m) => (m.rows[row.id] || []).flatMap((e) => e.notes.map((n) => n.midi)));
    const clef = all.length && all.reduce((a, b) => a + b, 0) / all.length < 57 ? "<clef><sign>F</sign><line>4</line></clef>" : "<clef><sign>G</sign><line>2</line></clef>";
    const lastNote = new Map(); // midi -> the last written piece, so a tied note can mark its start
    let prevTime = null;
    const measures = s.measures.map((m, mi) => {
      const out = [];
      const beatType = m.beatType || 4, beats = Math.round((m.timeLen * beatType) / 4);
      const time = `${beats}/${beatType}`;
      // attributes: everything at the start, then only what changes
      const attrs = [];
      if (mi === 0) attrs.push(`<divisions>${D}</divisions>`);
      const keyHere = mi === 0 ? firstKey : m.key;
      if (keyHere !== undefined) attrs.push(`<key><fifths>${keyHere}</fifths>${mi === 0 && s.keyInfo?.mode ? `<mode>${s.keyInfo.mode}</mode>` : m.mode ? `<mode>${m.mode}</mode>` : ""}</key>`);
      if (time !== prevTime) { attrs.push(`<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`); prevTime = time; }
      if (mi === 0) attrs.push(clef);
      if (attrs.length) out.push(`<attributes>${attrs.join("")}</attributes>`);
      if (mi === 0 && ri === 0 && (tempo || s.tempo)) out.push(`<direction placement="above"><direction-type><words/></direction-type><sound tempo="${+(tempo || s.tempo).toFixed(2)}"/></direction>`);
      // repeats and endings, left side
      const prev = s.measures[mi - 1], next = s.measures[mi + 1];
      const left = [];
      if (m.repStart) left.push(`<repeat direction="forward"/>`);
      if (m.endNums && (!prev?.endNums || prev.endNums.join() !== m.endNums.join())) left.push(`<ending number="${m.endNums.join(", ")}" type="start"/>`);
      if (left.length) out.push(`<barline location="left">${left.join("")}</barline>`);
      if (ri === 0) for (const c of m.chords || []) out.push(harmonyXML(c));
      // notes
      const evs = (m.rows[row.id] || []).filter((e) => !e.rest).slice().sort((a, b) => a.t - b.t);
      let pos = 0;
      const rest = (len) => { for (const v of noteValues(len)) out.push(`<note><rest/>${durXML(v.len)}${typeXML(v)}</note>`); };
      if (!evs.length) out.push(`<note><rest measure="yes"/>${durXML(m.len)}</note>`);
      evs.forEach((e, i) => {
        if (e.t > pos + EPS) rest(e.t - pos);
        const until = Math.min(e.t + e.d, evs[i + 1] ? evs[i + 1].t : m.len, m.len);
        const pieces = noteValues(Math.max(until - e.t, 1 / 64));
        const notes = e.notes.slice().sort((a, b) => b.midi - a.midi);
        for (const g of e.grace || []) out.push(`<note><grace slash="yes"/>${pitchXML(g)}<type>16th</type></note>`);
        pieces.forEach((v, pi) => {
          notes.forEach((n, ni) => {
            const tieStop = pi > 0 || (n.held && lastNote.has(n.midi));
            if (pi === 0 && n.held && lastNote.has(n.midi)) lastNote.get(n.midi).tieStart = true;
            const piece = { tieStart: pi < pieces.length - 1, tieStop, xml: null };
            const notations = [];
            if (ni === 0 && pi === 0 && e.tupStart) notations.push(`<tuplet type="start" bracket="yes"/>`);
            if (ni === 0 && pi === pieces.length - 1 && e.tupEnd) notations.push(`<tuplet type="stop"/>`);
            const lyric = ni === 0 && pi === 0 && e.lyric ? `<lyric number="1"><syllabic>${syllabic(e.lyric)}</syllabic><text>${esc(e.lyric.text)}</text></lyric>` : "";
            piece.render = () => {
              const ties = (piece.tieStop ? `<tie type="stop"/>` : "") + (piece.tieStart ? `<tie type="start"/>` : "");
              const tied = (piece.tieStop ? `<tied type="stop"/>` : "") + (piece.tieStart ? `<tied type="start"/>` : "");
              const nots = tied || notations.length ? `<notations>${tied}${notations.join("")}</notations>` : "";
              return `<note>${ni ? "<chord/>" : ""}${pitchXML(n)}${durXML(v.len)}${ties}${typeXML(v)}${nots}${lyric}</note>`;
            };
            out.push(piece);
            lastNote.set(n.midi, piece);
          });
        });
        // notes that aren't held on into the next event stop being tie candidates
        for (const [midi, p] of lastNote) if (!notes.some((n) => n.midi === midi)) lastNote.delete(midi);
        pos = until;
      });
      if (evs.length && pos < m.len - EPS) rest(m.len - pos);
      // right side
      const right = [];
      if (m.endNums && (!next?.endNums || next.endNums.join() !== m.endNums.join())) right.push(`<ending number="${m.endNums.join(", ")}" type="${m.repEnd ? "stop" : "discontinue"}"/>`);
      if (m.repEnd) right.push(`<repeat direction="backward"${m.repTimes ? ` times="${m.repTimes}"` : ""}/>`);
      if (right.length || m.final || mi === s.measures.length - 1) out.push(`<barline location="right">${m.final || mi === s.measures.length - 1 ? "<bar-style>light-heavy</bar-style>" : ""}${right.join("")}</barline>`);
      const implicit = mi === 0 && m.len < m.timeLen - EPS ? ` implicit="yes"` : "";
      return { head: `<measure number="${esc(m.number)}"${implicit}>`, body: out };
    });
    parts.push(`<part id="${id}">${measures.map((x) => x.head + x.body.map((p) => (typeof p === "string" ? p : p.render())).join("") + "</measure>").join("")}</part>`);
  });
  const work = `<work><work-title>${esc(s.title || "Untitled")}</work-title></work>`;
  const who = `<identification>${s.composer ? `<creator type="composer">${esc(s.composer)}</creator>` : ""}<encoding><software>Sheet Letters</software></encoding></identification>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise version="3.1">${work}${who}<part-list>${list.join("")}</part-list>${parts.join("")}</score-partwise>\n`;
}
