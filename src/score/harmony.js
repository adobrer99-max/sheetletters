import { EPS, FLAT_SPELL, SHARP_SPELL, accText, midiOf } from "../util.js";

/* ---------- key and chords ---------- */
const MAJOR_KEYS = ["C♭","G♭","D♭","A♭","E♭","B♭","F","C","G","D","A","E","B","F♯","C♯"];
const MINOR_KEYS = ["A♭","E♭","B♭","F","C","G","D","A","E","B","F♯","C♯","G♯","D♯","A♯"];
function keyLabel(fifths, mode, short) {
  const i = Math.max(-7, Math.min(7, fifths || 0)) + 7;
  if (mode === "minor") return MINOR_KEYS[i] + (short ? "m" : " minor");
  return MAJOR_KEYS[i] + (short ? "" : " major");
}
const tonicPc = (fifths) => (((fifths || 0) * 7) % 12 + 12) % 12;

// Major or minor isn't in the key signature, so when the file doesn't say, look at the lowest note
// at the start and end of the song and at the minor key's raised 7th (G♯ in A minor).
function guessMode(score, fifths) {
  const major = tonicPc(fifths), minor = (major + 9) % 12, leading = (minor + 11) % 12;
  const all = score.measures.flatMap((m, mi) => Object.values(m.rows).flat().filter((e) => !e.rest).map((e) => ({ e, mi })));
  if (!all.length) return "major";
  const firstMi = Math.min(...all.map((x) => x.mi)), lastMi = Math.max(...all.map((x) => x.mi));
  const firstEvs = all.filter((x) => x.mi === firstMi).map((x) => x.e);
  const t0 = Math.min(...firstEvs.map((e) => e.t));
  const firstBass = Math.min(...firstEvs.filter((e) => Math.abs(e.t - t0) < EPS).flatMap((e) => e.notes.map((n) => n.midi)));
  const lastEvs = all.filter((x) => x.mi === lastMi).map((x) => x.e);
  const tEnd = Math.max(...lastEvs.map((e) => e.t + e.d));
  const lastBass = Math.min(...lastEvs.filter((e) => e.t + e.d >= tEnd - 0.26).flatMap((e) => e.notes.map((n) => n.midi)));
  const notes = all.flatMap((x) => x.e.notes);
  const leadShare = notes.filter((n) => ((n.midi % 12) + 12) % 12 === leading).length / notes.length;
  let maj = 0, min = 0;
  if (lastBass % 12 === major) maj += 2; if (lastBass % 12 === minor) min += 2;
  if (firstBass % 12 === major) maj += 1; if (firstBass % 12 === minor) min += 1;
  if (leadShare > 0.02) min += 1;
  return min > maj ? "minor" : "major";
}

const CHORD_TYPES = [ // suffix, all tones, tones that must be present (the fifth may be left out)
  ["", [0,4,7], [0,4]], ["m", [0,3,7], [0,3]], ["7", [0,4,7,10], [0,4,10]], ["maj7", [0,4,7,11], [0,4,11]],
  ["m7", [0,3,7,10], [0,3,10]], ["sus4", [0,5,7], [0,5,7]], ["sus2", [0,2,7], [0,2,7]], ["6", [0,4,7,9], [0,4,9]],
  ["m6", [0,3,7,9], [0,3,9]], ["dim", [0,3,6], [0,3,6]], ["dim7", [0,3,6,9], [0,3,6,9]], ["m7♭5", [0,3,6,10], [0,3,6,10]],
  ["+", [0,4,8], [0,4,8]], ["5", [0,7], [0,7]],
];
function nameChord(pcs, bass, spell) {
  if (pcs.length < 2) return null;
  let best = null;
  for (const root of pcs) {
    const rel = pcs.map((p) => (p - root + 12) % 12);
    for (const [suffix, full, req] of CHORD_TYPES) {
      if (suffix === "5" && pcs.length !== 2) continue;
      if (!req.every((i) => rel.includes(i))) continue;
      const extras = rel.filter((i) => !full.includes(i)).length;
      if (extras > 1) continue;
      const missing = full.filter((i) => !rel.includes(i)).length;
      const score = full.length * 2 - missing * 3 - extras * 4 + (root === bass ? 2 : 0);
      if (score > 0 && (!best || score > best.score)) best = { root, suffix, score };
    }
  }
  if (!best) return null;
  return { root: spell(best.root), suffix: best.suffix, bass: bass !== null && bass !== best.root ? spell(bass) : null };
}

// Chords are named wherever any row plays two or more notes at once. Every note sounding until the
// next such moment counts (both hands and the melody), weighted by how long it sounds, so quick
// passing notes in the tune don't change the name.
function detectChords(m, rows, fifths) {
  const evs = rows.flatMap((r) => (m.rows[r.id] || []).filter((e) => !e.rest));
  const cuts = [...new Set(evs.filter((e) => e.notes.length >= 2).map((e) => +e.t.toFixed(4)))].sort((a, b) => a - b);
  const out = [];
  let prev = null;
  cuts.forEach((t, i) => {
    const end = i + 1 < cuts.length ? cuts[i + 1] : m.len, span = Math.max(end - t, EPS);
    const weight = new Array(12).fill(0), spellings = {};
    let bass = null, bassMidi = Infinity;
    for (const e of evs) {
      const overlap = Math.min(end, e.t + e.d) - Math.max(t, e.t);
      if (overlap <= EPS) continue;
      const startsHere = Math.abs(e.t - t) < EPS && e.notes.length >= 2;
      for (const n of e.notes) {
        const pc = ((n.midi % 12) + 12) % 12;
        weight[pc] += startsHere ? span : overlap;
        spellings[pc] = spellings[pc] || n;
        if (n.midi < bassMidi) { bassMidi = n.midi; bass = pc; }
      }
    }
    const pcs = weight.map((w, pc) => (w >= span * 0.25 - EPS ? pc : -1)).filter((pc) => pc >= 0);
    if (bass !== null && !pcs.includes(bass)) bass = null;
    const spell = (pc) => {
      const n = spellings[pc];
      if (n && ((midiOf(n.step, n.alter, 0) % 12) + 12) % 12 === pc) return { step: n.step, alter: n.alter };
      const [step, alter] = (fifths < 0 ? FLAT_SPELL : SHARP_SPELL)[pc];
      return { step, alter };
    };
    const chord = nameChord(pcs, bass, spell);
    const label = chord && chordLabel(chord);
    if (label && label !== prev) out.push({ t, ...chord, label });
    if (label) prev = label;
  });
  return out;
}

const HARMONY_KINDS = {
  major: "", minor: "m", augmented: "+", diminished: "dim", dominant: "7", "major-seventh": "maj7",
  "minor-seventh": "m7", "diminished-seventh": "dim7", "augmented-seventh": "+7", "half-diminished": "m7♭5",
  "major-minor": "m(maj7)", "major-sixth": "6", "minor-sixth": "m6", "dominant-ninth": "9", "major-ninth": "maj9",
  "minor-ninth": "m9", "dominant-11th": "11", "dominant-13th": "13", "suspended-second": "sus2",
  "suspended-fourth": "sus4", power: "5", none: "N.C.",
};
function chordLabel(c) {
  if (c.text) return c.text;
  const sp = (x) => x.step + accText(x.alter, false);
  return sp(c.root) + c.suffix + (c.bass ? "/" + sp(c.bass) : "");
}
function harmonyChord(el) {
  const step = el.querySelector("root > root-step")?.textContent.trim();
  const kindEl = el.querySelector("kind");
  const kind = kindEl?.textContent.trim() || "major";
  if (kind === "none") return { text: "N.C." };
  if (!step) return null;
  const alter = Math.round(parseFloat(el.querySelector("root > root-alter")?.textContent || "0"));
  const text = kindEl?.getAttribute("text");
  const suffix = text != null && text !== "" ? text : (HARMONY_KINDS[kind] ?? "");
  const bassStep = el.querySelector("bass > bass-step")?.textContent.trim();
  const bassAlter = Math.round(parseFloat(el.querySelector("bass > bass-alter")?.textContent || "0"));
  return { root: { step, alter }, suffix, bass: bassStep ? { step: bassStep, alter: bassAlter } : null };
}

export { MAJOR_KEYS, MINOR_KEYS, keyLabel, tonicPc, guessMode, CHORD_TYPES, nameChord, detectChords, HARMONY_KINDS, chordLabel, harmonyChord };
