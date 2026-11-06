// What a note is called on the sheet. Four ways:
//   letters   C D E F G A B                      (the default)
//   fixed     Do Re Mi Fa Sol La Si              (C is always Do, as in Quebec, France, Spain, Latin America)
//   movable   Do Re Mi Fa Sol La Ti              (the key's home note is Do; minor keys start on La)
//   numbers   1 2 3 4 5 6 7                      (steps from the key's home note: in A minor, A is 1 and C is ♭3)
// Movable Do and numbers follow the key signature, including key changes part-way through.

import { accText } from "../util.js";
import { MAJOR_KEYS, MINOR_KEYS } from "./harmony.js";

export const NAMINGS = {
  letters: "Letters (C D E)",
  fixed: "Do Re Mi (C is Do)",
  movable: "Do Re Mi (key's home note is Do)",
  numbers: "Numbers (1 2 3)",
};

const LETTERS = "CDEFGAB";
const FIXED = { C: "Do", D: "Re", E: "Mi", F: "Fa", G: "Sol", A: "La", B: "Si" };
const MOVABLE = ["Do", "Re", "Mi", "Fa", "Sol", "La", "Ti"];
// chromatic movable-Do syllables, by scale step and direction (the usual classroom set)
const RAISED = { 0: "Di", 1: "Ri", 3: "Fi", 4: "Si", 5: "Li" };
const LOWERED = { 1: "Ra", 2: "Me", 4: "Se", 5: "Le", 6: "Te" };
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// the home note for a key signature, e.g. -2 (two flats) -> B flat major, or G minor
function homeOf(fifths, minor = false) {
  const name = (minor ? MINOR_KEYS : MAJOR_KEYS)[(fifths || 0) + 7] || (minor ? "A" : "C");
  return { step: name[0], alter: name.includes("♭") ? -1 : name.includes("♯") ? 1 : 0 };
}

// scale step (0-6) and how far the note is from the plain major-scale note (-2..2)
function degreeOf(n, fifths, minor) {
  const home = homeOf(fifths, minor);
  const deg = (LETTERS.indexOf(n.step) - LETTERS.indexOf(home.step) + 7) % 7;
  const homePc = (STEP_PC[home.step] + home.alter + 12) % 12;
  const pc = (STEP_PC[n.step] + (n.alter || 0) + 12) % 12;
  let diff = (pc - homePc - MAJOR_STEPS[deg] + 24) % 12;
  if (diff > 6) diff -= 12;
  return { deg, diff };
}

/** A note's name in the chosen system: { text, acc } where acc is a sharp/flat sign shown small
 *  (empty when the name itself carries it, as movable-Do syllables like "Fi" do). */
export function noteName(n, naming = "letters", fifths = 0, minor = false) {
  const alter = n.alter || 0;
  if (naming === "fixed") return { text: FIXED[n.step], acc: accText(alter, false) };
  if (naming === "movable" || naming === "numbers") {
    // movable Do keeps La-based minor (A minor's home note is La); numbers count from the minor home note
    const { deg, diff } = degreeOf(n, fifths, naming === "numbers" && minor);
    const sign = diff ? accText(diff, false) : "";
    if (naming === "numbers") return { text: String(deg + 1), acc: "", pre: sign };
    if (diff === 1 && RAISED[deg]) return { text: RAISED[deg], acc: "" };
    if (diff === -1 && LOWERED[deg]) return { text: LOWERED[deg], acc: "" };
    return { text: MOVABLE[deg], acc: sign };
  }
  return { text: n.step, acc: accText(alter, false) };
}

/** As plain text, e.g. "F♯", "Fa♯", "Fi", "♯4". */
export function nameText(n, naming, fifths, minor) {
  const x = noteName(n, naming, fifths, minor);
  return (x.pre || "") + x.text + x.acc;
}

/** Chord names stay as letters except with fixed Do, where the root gets its syllable (Re m, Sol7),
 *  the way chord charts are written in those countries. */
export function chordText(c, naming) {
  if (naming !== "fixed" || !c.root || c.text) return c.label;
  const sp = (x) => FIXED[x.step] + accText(x.alter, false);
  return sp(c.root) + (c.suffix ? (/^m/.test(c.suffix) ? " " : "") + c.suffix : "") + (c.bass ? "/" + sp(c.bass) : "");
}

/** How much wider than a single letter names are, on average, so measures leave room. */
export const NAME_WIDTH = { letters: 1, fixed: 1.5, movable: 1.45, numbers: 1.1 };
