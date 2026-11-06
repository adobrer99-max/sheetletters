const $ = (s) => document.querySelector(s);
const EPS = 1e-6;
const STEP_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_SPELL = [["C",0],["C",1],["D",0],["D",1],["E",0],["F",0],["F",1],["G",0],["G",1],["A",0],["A",1],["B",0]];
const FLAT_SPELL  = [["C",0],["D",-1],["D",0],["E",-1],["E",0],["F",0],["G",-1],["G",0],["A",-1],["A",0],["B",-1],["B",0]];
const SHARP_ORDER = "FCGDAEB", FLAT_ORDER = "BEADGCF";

/* ---------- small helpers ---------- */
function decodeText(u8) {
  if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder("utf-16le").decode(u8);
  if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder("utf-16be").decode(u8);
  return new TextDecoder("utf-8").decode(u8);
}
function keyName(fifths) {
  if (!fifths) return "no sharps or flats";
  const n = Math.abs(fifths), list = (fifths > 0 ? SHARP_ORDER : FLAT_ORDER).slice(0, n).split("");
  const sym = fifths > 0 ? "♯" : "♭";
  return `${n} ${fifths > 0 ? "sharp" : "flat"}${n > 1 ? "s" : ""} (${list.map((l) => l + sym).join(" ")})`;
}
function accText(alter, ascii) {
  if (!alter) return "";
  const one = ascii ? (alter > 0 ? "#" : "b") : (alter > 0 ? "♯" : "♭");
  return one.repeat(Math.min(2, Math.abs(alter)));
}
function addNote(events, t, d, note) {
  let ev = events.find((e) => Math.abs(e.t - t) < EPS);
  if (!ev) { ev = { t, d, notes: [], lyric: null }; events.push(ev); }
  ev.d = Math.max(ev.d, d);
  if (!ev.notes.some((n) => n.midi === note.midi)) ev.notes.push(note);
  return ev;
}
function midiOf(step, alter, octave) { return (octave + 1) * 12 + STEP_SEMI[step] + alter; }

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export { $, EPS, STEP_SEMI, SHARP_SPELL, FLAT_SPELL, SHARP_ORDER, decodeText, keyName, accText, addNote, midiOf, esc };
