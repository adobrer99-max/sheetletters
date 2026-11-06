import { chordLabel, detectChords, guessMode } from "./harmony.js";
import { STEP_SEMI, midiOf } from "../util.js";

/* ---------- transposing ---------- */
const LETTERS = "CDEFGAB";
// keep keys between 5 flats and 6 sharps, the spellings players expect (D♭ not C♯, F♯ not G♭)
const normFifths = (f) => ((((f + 5) % 12) + 12) % 12) - 5;
function shiftPitch(step, alter, midi, letterShift, semis) {
  const newStep = LETTERS[(LETTERS.indexOf(step) + letterShift) % 7];
  const newMidi = midi + semis;
  const octave = Math.round((newMidi - STEP_SEMI[newStep]) / 12) - 1;
  return { step: newStep, alter: newMidi - midiOf(newStep, 0, octave), octave, midi: newMidi };
}
// Moves every note, chord and key by `semis` semitones. Letters move by the interval between the
// old and new key, so notes are spelled the way the new key spells them.
function transposeScore(src, semis) {
  if (!semis) return src;
  const s = structuredClone(src);
  let oldF = src.measures[0].key || 0;
  s.measures.forEach((m, i) => {
    if (src.measures[i].key !== undefined) oldF = src.measures[i].key;
    const newF = normFifths(oldF + 7 * semis);
    const shift = ((((newF - oldF) * 4) % 7) + 7) % 7;
    if (m.key !== undefined) m.key = newF;
    for (const evs of Object.values(m.rows)) for (const e of evs) {
      e.notes = e.notes.map((n) => ({ ...n, ...shiftPitch(n.step, n.alter, n.midi, shift, semis) }));
      if (e.grace) e.grace = e.grace.map((n) => ({ ...n, ...shiftPitch(n.step, n.alter, n.midi, shift, semis) }));
    }
    const movePc = (x) => { const r = shiftPitch(x.step, x.alter, midiOf(x.step, x.alter, 4), shift, semis); return { step: r.step, alter: r.alter }; };
    for (const c of m.chords) {
      if (c.text) continue;
      c.root = movePc(c.root);
      if (c.bass) c.bass = movePc(c.bass);
      c.label = chordLabel(c);
    }
  });
  s.keyInfo = { ...src.keyInfo, fifths: normFifths(src.keyInfo.fifths + 7 * semis) };
  return s;
}

function analyse(score) {
  const fifths = score.measures[0].key || 0;
  const guessed = !score.mode;
  score.keyInfo = { fifths, mode: score.mode || guessMode(score, fifths), guessed };
  const fromScore = score.measures.some((m) => m.harmony?.length);
  score.chordSource = fromScore ? "score" : "notes";
  let curFifths = fifths;
  for (const m of score.measures) {
    if (m.key !== undefined) curFifths = m.key;
    m.chords = fromScore ? (m.harmony || []).sort((a, b) => a.t - b.t) : detectChords(m, score.rows, curFifths);
  }
  score.hasChords = score.measures.some((m) => m.chords.length);
}

export { LETTERS, normFifths, shiftPitch, transposeScore, analyse };
