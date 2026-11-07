// Fixing notes by hand: change a note's pitch, move it, make it longer or shorter, delete it or add
// one after it. Every change works on the song as opened (not the transposed view) and keeps the
// measure tidy: notes in order, no overlaps, and the rests worked out again.
//
// A selection is { mi, rid, ev, note }: the measure, the staff row, the event and the note in it
// that's being changed (the top note of a chord, which is the melody).

import { EPS, FLAT_SPELL, SHARP_SPELL, midiOf } from "../util.js";
import { restRow } from "./finish.js";

const fail = (msg) => ({ ok: false, msg });
const OK = { ok: true };

export function fifthsAt(score, mi) {
  let f = score.measures[0].key || 0;
  for (let i = 0; i <= mi; i++) if (score.measures[i].key !== undefined) f = score.measures[i].key;
  return f;
}
/** A MIDI note spelled the way the key spells it: sharps in sharp keys, flats in flat keys. */
export function spell(midi, fifths) {
  const [step, alter] = (fifths < 0 ? FLAT_SPELL : SHARP_SPELL)[((midi % 12) + 12) % 12];
  const octave = Math.round((midi - midiOf(step, alter, -1)) / 12) - 1;
  return { step, alter, octave, midi };
}

const notesIn = (row) => row.filter((e) => !e.rest);
function around(score, sel) {
  const m = score.measures[sel.mi], row = notesIn(m.rows[sel.rid] || []);
  const i = row.indexOf(sel.ev);
  return { m, prev: row[i - 1], next: row[i + 1] };
}
function tidy(score, sel) {
  const m = score.measures[sel.mi];
  m.rows[sel.rid] = restRow(m.rows[sel.rid] || [], m.len);
}

export function changePitch(score, sel, semis) {
  const n = sel.note || sel.ev.notes[0];
  const midi = n.midi + semis;
  if (midi < 21 || midi > 108) return fail("That's as far as a piano goes.");
  if (sel.ev.notes.some((x) => x !== n && x.midi === midi)) return fail("That note is already in the chord.");
  Object.assign(n, spell(midi, fifthsAt(score, sel.mi)), { held: false });
  tidy(score, sel);
  return OK;
}

export function move(score, sel, by) {
  const { m, prev, next } = around(score, sel), e = sel.ev, t = e.t + by;
  if (t < -EPS || t + e.d > m.len + EPS) return fail(by < 0 ? "It's already at the start of the bar." : "It's already at the end of the bar.");
  if ((prev && t < prev.t + prev.d - EPS) || (next && t + e.d > next.t + EPS)) return fail("There's a note in the way.");
  e.t = Math.max(0, t);
  tidy(score, sel);
  return OK;
}

/** dir -1 shorter, +1 longer: by a sixteenth up to a quarter note, by an eighth above that. */
export function resize(score, sel, dir) {
  const { m, next } = around(score, sel), e = sel.ev;
  const step = dir < 0 ? (e.d > 1 + EPS ? 0.5 : 0.25) : (e.d < 1 - EPS ? 0.25 : 0.5);
  const d = e.d + dir * step;
  if (d < 0.25 - EPS) return fail("It can't get any shorter.");
  const room = (next ? next.t : m.len) - e.t;
  if (d > room + EPS) return fail(next ? "The next note is in the way." : "It already lasts to the end of the bar.");
  e.d = d;
  tidy(score, sel);
  return OK;
}

export function remove(score, sel) {
  const m = score.measures[sel.mi];
  m.rows[sel.rid] = (m.rows[sel.rid] || []).filter((e) => e !== sel.ev);
  // a note held over from this one has nothing to be held from now
  const nextBar = score.measures[sel.mi + 1]?.rows[sel.rid];
  const after = notesIn(m.rows[sel.rid]).find((e) => e.t > sel.ev.t) || (nextBar && notesIn(nextBar)[0]);
  if (after) for (const n of after.notes) if (sel.ev.notes.some((x) => x.midi === n.midi)) n.held = false;
  tidy(score, sel);
  return OK;
}

/** A copy of the note straight after this one, filling the gap (up to the same length). Returns the new event. */
export function addAfter(score, sel) {
  const { m, next } = around(score, sel), e = sel.ev, t = e.t + e.d;
  const room = (next ? next.t : m.len) - t;
  if (room < 0.25 - EPS) return fail(next ? "There's no room after this note." : "There's no room after this note in this bar.");
  const n = sel.note || e.notes[0];
  const ev = { t, d: Math.min(room, Math.max(e.d, 0.25)), notes: [{ ...n, held: false }], lyric: null };
  m.rows[sel.rid].push(ev);
  tidy(score, sel);
  return { ok: true, ev };
}

const LENGTHS = [[4, "whole note"], [3, "dotted half note"], [2, "half note"], [1.5, "dotted quarter note"], [1, "quarter note"],
  [0.75, "dotted eighth note"], [0.5, "eighth note"], [0.25, "sixteenth note"], [2 / 3, "triplet quarter note"], [1 / 3, "triplet eighth note"]];
export function lengthName(d) {
  const hit = LENGTHS.find(([len]) => Math.abs(len - d) < 1e-3);
  if (hit) return hit[1];
  const beats = +d.toFixed(2);
  return `${beats} beat${beats === 1 ? "" : "s"}`;
}

/* ---- several notes at once: a run of notes in one staff row, possibly across bar lines ---- */

/** Every note event in the row from a to b (each { mi, ev }), in playing order, whichever comes first. */
export function rangeEvents(score, rid, a, b) {
  const all = [];
  score.measures.forEach((m, mi) => { for (const ev of notesIn(m.rows[rid] || [])) all.push({ mi, ev }); });
  let i = all.findIndex((x) => x.ev === a.ev), j = all.findIndex((x) => x.ev === b.ev);
  if (i < 0 || j < 0) return [];
  if (i > j) [i, j] = [j, i];
  return all.slice(i, j + 1);
}

// the note straight after a run in the same row (the next bar's first, if the run ends a bar)
function noteAfter(score, rid, item) {
  for (let mi = item.mi; mi < score.measures.length; mi++) {
    const e = notesIn(score.measures[mi].rows[rid] || []).find((x) => mi > item.mi || x.t > item.ev.t + EPS);
    if (e) return e;
  }
  return null;
}
// ties only hold between notes that are still the same: not across the edges of a changed run
function untieEdges(score, rid, list, after) {
  for (const n of list[0].ev.notes) n.held = false;
  if (after) for (const n of after.notes) n.held = false;
}

/** Every note in the run moves up or down together (chords and all). */
export function changePitchRange(score, rid, list, semis) {
  for (const { ev } of list) for (const n of ev.notes) if (n.midi + semis < 21 || n.midi + semis > 108) return fail("That's as far as a piano goes.");
  const after = noteAfter(score, rid, list[list.length - 1]);
  for (const { mi, ev } of list) {
    const f = fifthsAt(score, mi);
    for (const n of ev.notes) Object.assign(n, spell(n.midi + semis, f));
  }
  untieEdges(score, rid, list, after);
  return OK;
}

export function removeRange(score, rid, list) {
  const after = noteAfter(score, rid, list[list.length - 1]);
  if (after) for (const n of after.notes) n.held = false;
  const gone = new Set(list.map((x) => x.ev));
  for (const mi of new Set(list.map((x) => x.mi))) {
    const m = score.measures[mi];
    m.rows[rid] = restRow((m.rows[rid] || []).filter((e) => !gone.has(e)), m.len);
  }
  return OK;
}

/** Move the whole run earlier or later (quarter notes), across bar lines if need be. Notes that end up
 *  crossing a bar line are split there and tied. Other notes in the way stop it. */
export function moveRange(score, rid, list, by) {
  const starts = [];
  let at = 0;
  for (const m of score.measures) { starts.push(at); at += m.len; }
  const total = at;
  const moving = new Set(list.map((x) => x.ev));
  const abs = (mi, e) => starts[mi] + e.t;
  const first = list[0], last = list[list.length - 1];
  const from = abs(first.mi, first.ev) + by, to = Math.max(...list.map(({ mi, ev }) => abs(mi, ev) + ev.d)) + by;
  if (from < -EPS) return fail("It's already at the start of the song.");
  if (to > total + EPS) return fail("It's already at the end of the song.");
  // the notes either side that aren't moving
  let before = null, after = null;
  score.measures.forEach((m, mi) => {
    for (const e of notesIn(m.rows[rid] || [])) {
      if (moving.has(e)) continue;
      const s = abs(mi, e);
      if (s < abs(first.mi, first.ev) - EPS) { if (!before || s > before.s) before = { s, end: s + e.d, e }; }
      else if (s > abs(last.mi, last.ev) - EPS && (!after || s < after.s)) after = { s, e };
    }
  });
  if ((before && from < before.end - EPS) || (after && to > after.s + EPS)) return fail("There's a note in the way.");
  untieEdges(score, rid, list, after?.e);
  // take the run out, then put each note back where it now starts, splitting at bar lines
  const touched = new Set();
  for (const { mi, ev } of list) { const m = score.measures[mi]; m.rows[rid] = m.rows[rid].filter((e) => e !== ev); touched.add(mi); }
  const locate = (q) => { let i = starts.length - 1; while (i > 0 && starts[i] > q + EPS) i--; return i; };
  for (const { mi, ev } of list) {
    let s = abs(mi, ev) + by, left = ev.d, held = false, piece = ev;
    while (left > EPS) {
      const k = locate(s), m = score.measures[k], room = starts[k] + m.len - s;
      const d = Math.min(left, room);
      const e = piece === ev ? ev : { t: 0, d: 0, notes: ev.notes.map((n) => ({ ...n, held: true })), lyric: null };
      e.t = Math.max(0, s - starts[k]); e.d = d;
      if (held) for (const n of e.notes) n.held = true;
      (m.rows[rid] ||= []).push(e); touched.add(k);
      s += d; left -= d; held = true; piece = null;
    }
  }
  // a tied piece that now sits right after its own note in the same bar becomes one note again
  for (const k of touched) {
    const m = score.measures[k];
    const evs = (m.rows[rid] || []).filter((e) => !e.rest).sort((a, b) => a.t - b.t);
    const out = [];
    for (const e of evs) {
      const p = out[out.length - 1];
      if (p && e.notes.every((n) => n.held) && Math.abs(p.t + p.d - e.t) < EPS && e.notes.length === p.notes.length && e.notes.every((n) => p.notes.some((x) => x.midi === n.midi))) { p.d += e.d; continue; }
      out.push(e);
    }
    m.rows[rid] = restRow(out, m.len);
  }
  return OK;
}
