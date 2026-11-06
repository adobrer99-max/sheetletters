// The "open a recording" panel: choose where the melody is, run the import, then fix the speed,
// bar lines and detail without redoing the slow part.

import { RecordingImport, audioDuration, wavBlob, looksLikePhone, canSplitHere } from "./audio/pipeline.js";
import { PARTS } from "./audio/melody.js";
import { show, showError } from "./load.js";
import { $, esc } from "./util.js";

const STEPS = {
  decode: "Opening the recording",
  model: "Downloading the song-splitting model (once)",
  engine: "Starting the model",
  split: "Splitting the song into parts",
  beat: "Finding the beat",
  notes: "Writing down the notes",
};
const job = new RecordingImport({ onProgress: progress });
let file = null, duration = 0, started = 0, running = false, current = null;

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const secs = (t) => { const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(t || ""); return m ? (+(m[1] || 0)) * 60 + +m[2] : null; };
const panel = (which) => { for (const id of ["recSetup", "recWork", "recDone"]) $("#" + id).hidden = id !== which; };
const part = () => document.querySelector('input[name="recPart"]:checked').value;

export async function openRecording(f) {
  file = f; job.stop(); job.reset();
  showError("");
  $("#recPanel").hidden = false;
  $("#recTitle").textContent = (f.name || "Recording").replace(/\.[^.]+$/, "");
  $("#recBy").textContent = "Reading the recording…";
  panel("recSetup");
  $("#recPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  try { duration = await audioDuration(f); }
  catch { $("#recBy").textContent = ""; showError("This browser can't open that audio file. Try an MP3 or WAV."); $("#recPanel").hidden = true; return; }
  $("#recBy").textContent = `${mmss(duration)} · a recording`;
  $("#recFrom").value = "0:00"; $("#recTo").value = mmss(duration);
  // phones: song splitting needs a computer for now (it's heavy); solo recordings work anywhere
  const phone = looksLikePhone();
  for (const r of document.querySelectorAll('input[name="recPart"]')) r.disabled = phone && r.value !== "solo";
  if (phone) document.querySelector('input[name="recPart"][value="solo"]').checked = true;
  note();
}

function note() {
  const p = part(), phone = looksLikePhone();
  const len = Math.max(0, (secs($("#recTo").value) ?? duration) - (secs($("#recFrom").value) ?? 0));
  const gpu = !!navigator.gpu;
  let t;
  if (p === "solo") t = "Solo recordings skip the splitting step, so this is quick." + (phone ? " Finding the melody in a full band song needs a computer for now; phones and tablets are coming later." : "");
  else if (phone) t = "Finding the melody in a full song needs a computer for now. Phones and tablets are coming later; solo recordings work here already.";
  else t = `The first time, this downloads a 172 MB model (kept for next time). Splitting ${mmss(len)} of music takes ${gpu ? "about " + mmss(len * 2) + "–" + mmss(len * 4) : "a while: this browser has no WebGPU, so allow " + mmss(len * 8) + " or more. Chrome or Edge on a computer is much faster"}.`;
  $("#recNote").textContent = t;
}

function stepsFor(p) { return p === "solo" ? ["decode", "beat", "notes"] : ["decode", "model", "engine", "split", "beat", "notes"]; }

function progress(m) {
  const order = stepsFor(current?.part || "vocals");
  const at = order.indexOf(m.stage);
  [...$("#recSteps").children].forEach((li, i) => { li.className = i < at ? "done" : i === at ? "now" : ""; });
  const li = $("#recSteps").children[at];
  if (li) {
    let sub = "";
    if (m.stage === "model") sub = m.cached ? "already downloaded" : `${Math.round(m.done / 1e6)} of ${Math.round(m.total / 1e6)} MB`;
    if (m.stage === "split" && m.device) sub = m.device === "webgpu" ? "using the graphics chip" : "using the processor (slower)";
    li.querySelector(".sub").textContent = sub ? ` · ${sub}` : "";
  }
  const frac = m.total ? m.done / m.total : 0;
  $("#recBar").value = (at + Math.min(1, frac)) / order.length;
  if ((m.stage === "split" || m.stage === "notes") && frac > 0.03) {
    const el = (performance.now() - (m.stage === "split" ? splitStart ||= performance.now() : started)) / 1000;
    const left = el / frac - el;
    $("#recEta").textContent = left > 5 ? `About ${mmss(left)} left for this step.` : "";
  } else if (m.stage !== "split") splitStart = 0;
}
let splitStart = 0;

async function go() {
  if (running || !file) return;
  const from = secs($("#recFrom").value) ?? 0, to = secs($("#recTo").value) ?? duration;
  if (to <= from) { showError("The end time needs to be after the start."); return; }
  current = { part: part(), from, to };
  $("#recSteps").innerHTML = stepsFor(current.part).map((s) => `<li>${esc(STEPS[s])}<span class="sub"></span></li>`).join("");
  $("#recBar").value = 0; $("#recEta").textContent = "";
  panel("recWork");
  running = true; started = performance.now(); splitStart = 0;
  try {
    const score = await job.run(file, current);
    done(score);
  } catch (err) {
    if (running) { console.error(err); showError(err.message || String(err)); panel("recSetup"); }
  } finally { running = false; }
}

function done(score) {
  panel("recDone");
  const r = score?.fromRecording || { part: job.settings?.part, notes: 0 };
  const switched = job.switchedFrom && r.part === "other" ? "The vocals part came out almost silent (an instrumental?), so this is the lead instrument. " : "";
  $("#recSummary").textContent = switched + (r.notes
    ? `Found ${r.notes} notes at about ${r.bpm} beats per minute. If the letters drift from the song, fix the speed or bar lines here.`
    : "No clear melody turned up in that part. Try another part below, or a different section of the song.");
  const sw = $("#recSwitch");
  sw.querySelectorAll(".chip").forEach((c) => c.remove());
  const parts = job.stems ? ["vocals", "other", "bass"] : ["solo"];
  for (const p of parts) {
    const label = document.createElement("label");
    label.className = "chip";
    label.innerHTML = `<input type="radio" name="recSwitch" value="${p}"${p === r.part ? " checked" : ""}><span>${esc(PARTS[p].label)}</span>`;
    label.querySelector("input").addEventListener("change", () => switchPart(p));
    sw.appendChild(label);
  }
  sw.hidden = parts.length < 2;
  setAudio(r.part);
  for (const el of document.querySelectorAll('input[name="recMeter"]')) el.checked = +el.value === (job.settings.perBar || 4);
  for (const el of document.querySelectorAll('input[name="recGrid"]')) el.checked = +el.value === (job.settings.grid || 0.25);
  if (score) show(score, file.name, false);
}

let audioUrl = null;
function setAudio(p) {
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(wavBlob(job.partAudio(p)));
  $("#recAudio").src = audioUrl;
  $("#recAudio").title = `Hear the ${PARTS[p].label.toLowerCase()} on its own`;
}

async function switchPart(p) {
  $("#recSummary").textContent = `Writing down the notes in the ${PARTS[p].label.toLowerCase()}…`;
  try { done(await job.setPart(p)); } catch (err) { showError(err.message || String(err)); }
}

const fix = (fn) => () => { try { done(fn()); } catch (err) { showError(err.message || String(err)); } };
$("#recGo").addEventListener("click", go);
$("#recStop").addEventListener("click", () => { running = false; job.stop(); panel("recSetup"); });
$("#recClose").addEventListener("click", () => { running = false; job.stop(); $("#recPanel").hidden = true; });
$("#recHalf").addEventListener("click", fix(() => job.halfSpeed()));
$("#recDouble").addEventListener("click", fix(() => job.doubleSpeed()));
$("#recShift").addEventListener("click", fix(() => job.shiftBar(1)));
for (const el of document.querySelectorAll('input[name="recMeter"]')) el.addEventListener("change", fix(() => job.setMeter(+el.value)));
for (const el of document.querySelectorAll('input[name="recGrid"]')) el.addEventListener("change", fix(() => job.setDetail(+el.value)));
for (const el of document.querySelectorAll('input[name="recPart"]')) el.addEventListener("change", note);
$("#recFrom").addEventListener("input", note); $("#recTo").addEventListener("input", note);
if (!canSplitHere()) $("#recNote").textContent = "This browser can't process recordings.";

export const recording = { job };
window.SheetLettersRecording = recording; // for tests and the console
