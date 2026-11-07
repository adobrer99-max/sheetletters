import { openFromLinkOr } from "./library.js";
import { NAMINGS } from "./score/names.js";
import "./styles.css";
import "./links.js";
import "./save.js";
import { editing } from "./edit.js";
import { loadExample, loadFile } from "./load.js";
import { parseMIDI } from "./parse/midi.js";
import { parseMusicXML } from "./parse/musicxml.js";
import { readMxl } from "./parse/mxl.js";
import { player } from "./player.js";
import { refreshView, render, setTranspose, toText } from "./render.js";
import { finish } from "./score/finish.js";
import { transposeScore } from "./score/transpose.js";
import { opts, saveOpts, state } from "./state.js";
import { $ } from "./util.js";

/* ---------- wiring ---------- */
const bind = (id, key) => {
  const el = $(id);
  if (el.type === "checkbox") el.checked = !!opts[key]; else el.value = opts[key];
  el.addEventListener("input", () => { opts[key] = el.type === "checkbox" ? el.checked : parseFloat(el.value); saveOpts(); render(); });
};
bind("#optOctave", "octave"); bind("#optLyrics", "lyrics"); bind("#optColor", "color");
// note names: letters, Do-Re-Mi (fixed or movable) or numbers
$("#optNames").innerHTML = Object.entries(NAMINGS).map(([k, label]) => `<option value="${k}">${label}</option>`).join("");
if (!NAMINGS[opts.names]) opts.names = "letters";
$("#optNames").value = opts.names;
$("#optNames").addEventListener("change", (e) => { opts.names = e.target.value; saveOpts(); render(); });
bind("#optChords", "chords"); bind("#optCompact", "compact"); bind("#optPlain", "plain"); bind("#optSize", "size");

$("#openBtn").addEventListener("click", () => $("#fileInput").click());
$("#transpose").addEventListener("change", (e) => setTranspose(parseInt(e.target.value, 10)));
$("#transDown").addEventListener("click", () => setTranspose(state.transpose - 1));
$("#transUp").addEventListener("click", () => setTranspose(state.transpose + 1));
$("#exampleBtn").addEventListener("click", loadExample);
$("#fileInput").addEventListener("change", (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ""; });

let dragDepth = 0;
document.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; $("#drop").classList.add("over"); });
document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("#drop").classList.remove("over"); } });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault(); dragDepth = 0; $("#drop").classList.remove("over");
  const f = e.dataTransfer?.files?.[0];
  if (f) loadFile(f);
});

$("#printBtn").addEventListener("click", () => {
  if (player.state.playing) player.pause(); // the highlight would print
  window.print();
});
$("#copyBtn").addEventListener("click", () => {
  const text = toText();
  const done = () => { $("#status").textContent = "Copied. Paste it into Notes or any text app."; };
  const fallback = () => {
    opts.plain = true; $("#optPlain").checked = true; render();
    const range = document.createRange(); range.selectNodeContents($("#plain"));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    $("#status").textContent = "Copying was blocked here. The text is selected below; copy it with your keyboard or the share menu.";
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
});

window.SheetLetters = { parseMusicXML, parseMIDI, readMxl, finish, toText, loadFile, transposeScore, setTranspose, state, opts, player, editing };
// melody only: the top note of each chord
$("#optMelody").checked = !!opts.melody;
$("#optMelody").addEventListener("change", (e) => { opts.melody = e.target.checked; saveOpts(); refreshView(); });
openFromLinkOr(loadExample); // a shared link's song, or the example
