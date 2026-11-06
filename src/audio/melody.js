// From the notes heard in a part to one melody line, placed on the beat, written as a MIDI file
// that Sheet Letters' own MIDI reader then turns into measures, a key and note names.
// Note events look like Basic Pitch's: { startTimeSeconds, durationSeconds, pitchMidi, amplitude }
// (its Python version says pitch_midi; both are accepted).

import { beatPosition } from "./rhythm.js";

// What each part sounds like, so stray notes outside it are dropped and the right one of several
// notes sounding at once is kept.
export const PARTS = {
  vocals: { label: "Vocals", min: 40, max: 84, pick: "loudest" },
  other: { label: "Lead instrument", min: 45, max: 96, pick: "loudest" }, // the tune is usually louder than the chords around it
  bass: { label: "Bass", min: 24, max: 60, pick: "lowest" },
  solo: { label: "Solo recording", min: 21, max: 108, pick: "highest" },
};

/** One note at a time. Where notes overlap, keep the one the part calls for and cut the other short. */
export function melodyLine(events, part = "vocals", { minLen = 0.07 } = {}) {
  const P = PARTS[part] || PARTS.vocals;
  const notes = events
    .map((e) => ({ start: e.startTimeSeconds, end: e.startTimeSeconds + e.durationSeconds, midi: e.pitchMidi ?? e.pitch_midi, amp: e.amplitude ?? 0.5 }))
    .filter((n) => n.midi >= P.min && n.midi <= P.max && n.end - n.start >= minLen)
    .sort((a, b) => a.start - b.start || b.amp - a.amp);
  if (!notes.length) return [];
  const loudest = Math.max(...notes.map((n) => n.amp));
  const strong = notes.filter((n) => n.amp >= loudest * 0.25); // drop faint bleed from other parts
  const better = (a, b) => { // is a the better melody note than b?
    if (P.pick === "highest" && Math.abs(a.amp - b.amp) < 0.35 * Math.max(a.amp, b.amp)) return a.midi > b.midi;
    if (P.pick === "lowest" && Math.abs(a.amp - b.amp) < 0.35 * Math.max(a.amp, b.amp)) return a.midi < b.midi;
    return a.amp * (a.end - a.start) ** 0.3 > b.amp * (b.end - b.start) ** 0.3;
  };
  const line = [];
  for (const n of strong) {
    const last = line[line.length - 1];
    if (!last || n.start >= last.end - 0.02) { line.push({ ...n }); continue; }
    // overlapping: the same pitch carries on; otherwise the better note wins the overlap
    if (n.midi === last.midi) { last.end = Math.max(last.end, n.end); continue; }
    if (better(n, last)) {
      if (n.start - last.start < minLen) line[line.length - 1] = { ...n };
      else { last.end = n.start; line.push({ ...n }); }
    } else if (n.end > last.end + minLen) {
      line.push({ ...n, start: last.end });
    }
  }
  // octave slips (a sung note heard an octave off for an instant) get folded back into their neighbours
  for (let i = 1; i < line.length - 1; i++) {
    const a = line[i - 1], b = line[i], c = line[i + 1];
    if (b.end - b.start < 0.2 && Math.abs(b.midi - a.midi) === 12 && Math.abs(b.midi - c.midi) === 12) b.midi = a.midi;
  }
  return line.filter((n) => n.end - n.start >= minLen);
}

/** Place notes on the beat grid. Returns notes as { midi, on, off } in beats from the first bar line,
 *  plus where that first bar line is. `grid` is the smallest step in beats (0.25 = sixteenth notes). */
export function quantize(line, beats, { downbeat = 0, perBar = 4, grid = 0.25 } = {}) {
  const q = (x) => Math.round(x / grid) * grid;
  let notes = line.map((n) => ({ midi: n.midi, on: q(beatPosition(n.start, beats)), off: q(beatPosition(n.end, beats)) }));
  // the first bar line: the chosen downbeat, moved back whole bars until it's before the first note
  let origin = downbeat;
  const first = notes.length ? notes[0].on : 0;
  while (origin > first + 1e-6) origin -= perBar;
  while (origin + perBar <= first + 1e-6) origin += perBar;
  notes = notes.map((n) => ({ midi: n.midi, on: n.on - origin, off: Math.max(n.off, n.on + grid) - origin }));
  // no overlaps after rounding, and nothing shorter than one grid step
  const out = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && n.on < last.off) {
      if (n.on <= last.on) { if (n.off > last.off) last.off = n.off; continue; } // landed on the same step
      last.off = n.on;
    }
    if (n.off - n.on >= grid - 1e-9) out.push(n);
  }
  return { notes: out, origin };
}

/** A standard MIDI file (format 0) holding the melody at a steady tempo. */
export function toMidiFile(notes, { bpm = 120, perBar = 4, title = "", ppq = 480 } = {}) {
  const ev = [];
  const vlq = (n) => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
  const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data];
  const text = (s) => [...new TextEncoder().encode(s)];
  const header = [];
  if (title) header.push([0, meta(0x03, text(title))]);
  const us = Math.round(60e6 / bpm);
  header.push([0, meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255])]);
  header.push([0, meta(0x58, [perBar, 2, 24, 8])]);
  for (const n of notes) {
    ev.push([Math.round(n.on * ppq), [0x90, n.midi, 88]]);
    ev.push([Math.round(n.off * ppq), [0x80, n.midi, 0]]);
  }
  ev.sort((a, b) => a[0] - b[0] || (a[1][0] === 0x80 ? -1 : 1)); // note-offs first at the same tick
  const all = header.concat(ev);
  const end = all.length ? all[all.length - 1][0] : 0;
  all.push([end, meta(0x2f, [])]);
  const track = [];
  let t = 0;
  for (const [tick, bytes] of all) { track.push(...vlq(tick - t), ...bytes); t = tick; }
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 0, 0, 1, (ppq >> 8) & 255, ppq & 255,
    0x4d, 0x54, 0x72, 0x6b, ...u32(track.length), ...track,
  ]);
}
