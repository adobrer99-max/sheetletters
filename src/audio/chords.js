// Chord names and the key, heard from a recording.
//
//   estimateKey(weights)        the most likely key, from how much each of the 12 notes sounds overall
//   chordsPerBeat(chroma, e)    one chord (or none) per beat, from per-beat note strengths
//   placeChords(...)            those chords as Sheet Letters chord symbols, measure by measure
//
// Chords are major or minor triads: on real recordings that's what can be told apart reliably.
// Sevenths and the like are left to sheet music, where they're written down.

import { SHARP_SPELL, FLAT_SPELL } from "../util.js";
import { chordLabel } from "../score/harmony.js";

// Krumhansl–Kessler key profiles: how strongly each scale step belongs to a major / minor key
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const corr = (a, b) => {
  const ma = a.reduce((x, y) => x + y, 0) / 12, mb = b.reduce((x, y) => x + y, 0) / 12;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? n / Math.sqrt(da * db) : 0;
};

// key signature for a major key's home note: G -> 1 sharp, F -> 1 flat; F♯/G♭ written with flats
const fifthsOfMajor = (pc) => { const f = (pc * 7) % 12; return f > 5 ? f - 12 : f; };

/** { fifths, minor, tonic } for 12 pitch-class weights (index 0 = C). */
export function estimateKey(weights) {
  let best = { r: -2 };
  for (let t = 0; t < 12; t++) {
    const rot = (p) => p.map((_, i) => p[(i - t + 12) % 12]);
    const rM = corr(weights, rot(MAJOR)), rm = corr(weights, rot(MINOR));
    if (rM > best.r) best = { r: rM, tonic: t, minor: false };
    if (rm > best.r) best = { r: rm, tonic: t, minor: true };
  }
  const majorHome = best.minor ? (best.tonic + 3) % 12 : best.tonic;
  return { fifths: fifthsOfMajor(majorHome), minor: best.minor, tonic: best.tonic };
}

// 24 triads: root weight 1, third and fifth a little less (overtones blur them in recordings)
const TEMPLATES = [];
for (let root = 0; root < 12; root++) {
  for (const [minor, third] of [[false, 4], [true, 3]]) {
    const t = new Float32Array(12);
    t[root] = 1; t[(root + third) % 12] = 0.85; t[(root + 7) % 12] = 0.9;
    const n = Math.hypot(...t);
    TEMPLATES.push({ root, minor, t: t.map((v) => v / n) });
  }
}

/** One chord per beat: { root, minor } or null where nothing chord-like is sounding. Chosen as the
 *  best path through the beats (Viterbi), so a chord holds unless the music clearly moves on. */
export function chordsPerBeat(chroma, energy, { change = 0.18, quiet = 0.2 } = {}) {
  const n = chroma.length;
  if (!n) return [];
  const sorted = [...energy].sort((a, b) => a - b), median = sorted[n >> 1] || 0;
  const S = TEMPLATES.length + 1; // last state = no chord
  const emit = (i, s) => {
    if (energy[i] < quiet * median) return s === S - 1 ? 1 : 0;
    if (s === S - 1) return 0.55; // "no chord" has to beat a poor fit
    let d = 0;
    const t = TEMPLATES[s].t, c = chroma[i];
    for (let k = 0; k < 12; k++) d += t[k] * c[k];
    return d;
  };
  let score = Array.from({ length: S }, (_, s) => emit(0, s));
  const back = [];
  for (let i = 1; i < n; i++) {
    let bestPrev = 0;
    for (let s = 1; s < S; s++) if (score[s] > score[bestPrev]) bestPrev = s;
    const next = new Array(S), from = new Int16Array(S);
    for (let s = 0; s < S; s++) {
      const stay = score[s], jump = score[bestPrev] - change;
      if (stay >= jump) { next[s] = stay + emit(i, s); from[s] = s; }
      else { next[s] = jump + emit(i, s); from[s] = bestPrev; }
    }
    back.push(from); score = next;
  }
  let s = score.indexOf(Math.max(...score));
  const path = new Array(n);
  for (let i = n - 1; i >= 0; i--) { path[i] = s; if (i) s = back[i - 1][s]; }
  return path.map((st) => (st === S - 1 ? null : { root: TEMPLATES[st].root, minor: TEMPLATES[st].minor }));
}

/** A major key and its relative minor share every note, so the notes alone can't tell them apart.
 *  The chords can: whichever home chord (E♭ or Cm, say) sounds for more beats wins. */
export function majorOrMinor(key, perBeat) {
  const majorHome = (((key.fifths * 7) % 12) + 12) % 12, minorHome = (majorHome + 9) % 12;
  let maj = 0, min = 0;
  for (const c of perBeat) {
    if (!c) continue;
    if (!c.minor && c.root === majorHome) maj++;
    if (c.minor && c.root === minorHome) min++;
  }
  if (maj === min) return key;
  const minor = min > maj;
  return { ...key, minor, tonic: minor ? minorHome : majorHome };
}

/** Sheet Letters chord symbols, by measure: chord changes at beat i land at beat (i - origin) of the
 *  song, i.e. measure floor(b / perBar), position b % perBar (in quarter notes). Roots are spelled
 *  to suit the key (flats in flat keys). */
export function placeChords(perBeat, { origin, perBar, measures, fifths }) {
  const spell = (pc) => { const [step, alter] = (fifths < 0 ? FLAT_SPELL : SHARP_SPELL)[pc]; return { step, alter }; };
  const out = Array.from({ length: measures }, () => []);
  let prev = "";
  // start at the first bar line, so a chord already sounding there is named on bar 1
  for (let i = Math.max(0, Math.ceil(origin)); i < perBeat.length; i++) {
    const c = perBeat[i], b = i - origin;
    const key = c ? `${c.root}${c.minor ? "m" : ""}` : "";
    if (key === prev) continue;
    prev = key;
    if (!c) continue;
    const mi = Math.floor(b / perBar);
    if (mi >= measures) break;
    const chord = { t: b - mi * perBar, root: spell(c.root), suffix: c.minor ? "m" : "", bass: null };
    out[mi].push({ ...chord, label: chordLabel(chord) });
  }
  return out;
}
