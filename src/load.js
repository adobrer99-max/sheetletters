import { parseMIDI } from "./parse/midi.js";
import { parseMusicXML } from "./parse/musicxml.js";
import { readMxl } from "./parse/mxl.js";
import { player } from "./player.js";
import { fillTransposeMenu, render, viewScore } from "./render.js";
import { finish } from "./score/finish.js";
import { state } from "./state.js";
import { $, decodeText, esc } from "./util.js";
import { isAudioFile } from "./audio/pipeline.js";
import { openRecording } from "./recording.js";

/* ---------- loading ---------- */
function showError(msg) { const e = $("#error"); e.textContent = msg; e.hidden = !msg; }

function show(score, filename, isExample) {
  finish(score);
  state.original = state.score = score;
  state.transpose = 0;
  state.isExample = !!isExample;
  state.edited = false;
  state.slug = null; // only library songs have a shareable link; openSong sets it
  state.visible = new Set(score.rows.map((r) => r.id));
  if (!score.title) score.title = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  // keep only real key changes
  let prev = null;
  for (const m of score.measures) {
    if (m.key !== undefined) { if (m.key === prev) delete m.key; else prev = m.key; }
  }
  $("#songTitle").textContent = score.title;
  $("#exampleTag").hidden = !isExample;
  if (isExample) $("#exampleTag").textContent = typeof isExample === "string" ? isExample : "Example";
  fillTransposeMenu();


  const group = $("#partGroup");
  group.querySelectorAll(".chip").forEach((c) => c.remove());
  score.rows.forEach((r, i) => {
    const label = document.createElement("label");
    label.className = "chip";
    label.innerHTML = `<input type="checkbox" id="part-${i}" checked><span>${esc(r.name)}</span>`;
    label.querySelector("input").addEventListener("change", (ev) => {
      if (ev.target.checked) state.visible.add(r.id); else state.visible.delete(r.id);
      if (!state.visible.size) { state.visible.add(r.id); ev.target.checked = true; }
      render();
    });
    group.appendChild(label);
  });
  group.hidden = score.rows.length < 2;
  $("#result").hidden = false;
  $("#scanHelp").hidden = true;
  showError("");
  player.onLoad(score);
  state.score = viewScore(0); // melody only, if that's on
  render();
}

async function loadFile(file) {
  const name = file.name || "song";
  const ext = (name.match(/\.([^.]+)$/) || [, ""])[1].toLowerCase();
  $("#status").textContent = "";
  try {
    if (/^(pdf|png|jpe?g|tiff?|webp|heic|bmp|gif)$/.test(ext) || /^image\//.test(file.type) || file.type === "application/pdf") {
      showError("");
      $("#scanTitle").textContent = `“${name}” is a scan. It needs one extra step.`;
      $("#scanHelp").hidden = false;
      $("#scanHelp").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const head = String.fromCharCode(...u8.subarray(0, 4));
    if (isAudioFile(file, head, u8)) { $("#scanHelp").hidden = true; return openRecording(file); }
    let score;
    if (head === "MThd" || head === "RIFF" || /^(mid|midi|kar|rmi)$/.test(ext)) score = parseMIDI(buf);
    else if (head === "PK\u0003\u0004" || ext === "mxl") score = parseMusicXML(await readMxl(buf));
    else if (/^(musicxml|xml)$/.test(ext) || head.startsWith("<") || u8[0] === 0xEF || u8[0] === 0xFF || u8[0] === 0xFE) score = parseMusicXML(decodeText(u8));
    else throw new Error(`“${name}” isn't a format Sheet Letters can read. Open a MusicXML (.musicxml, .xml, .mxl) or MIDI (.mid) file, or a recording (MP3, WAV, M4A, FLAC). Most notation apps, including MuseScore, Sibelius, Finale and Dorico, can export MusicXML.`);
    show(score, name, false);
  } catch (err) {
    console.error(err);
    showError(err.message || String(err));
  }
}

function loadExample() { return import("./library.js").then((l) => l.openSong("twinkle")); }

export { showError, show, loadFile, loadExample };
