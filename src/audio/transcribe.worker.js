// Hears the notes in one part (or a solo recording) with Spotify's Basic Pitch model (Apache 2.0),
// in a worker. The model is under 1 MB and ships with the app (public/models/basic-pitch).
//
// in:  { type: "transcribe", samples, modelUrl }   mono Float32Array at 22.05 kHz
// out: { type: "progress", stage: "notes", done, total } ... then { type: "notes", notes: [...] }
//      notes as { startTimeSeconds, durationSeconds, pitch_midi, amplitude }

import * as tf from "@tensorflow/tfjs";
import { BasicPitch, outputToNotesPoly, noteFramesToTime } from "@spotify/basic-pitch";

let model = null;

async function transcribe(samples, modelUrl, opts = {}) {
  if (!model) {
    // WebGL in a worker needs OffscreenCanvas; fall back to plain JavaScript where it's missing
    try { await tf.setBackend(typeof OffscreenCanvas !== "undefined" ? "webgl" : "cpu"); } catch { await tf.setBackend("cpu"); }
    await tf.ready();
    model = new BasicPitch(modelUrl);
  }
  const frames = [], onsets = [];
  await model.evaluateModel(
    samples,
    (f, o) => { frames.push(...f); onsets.push(...o); },
    (p) => self.postMessage({ type: "progress", stage: "notes", done: p, total: 1, backend: tf.getBackend() }),
  );
  // Basic Pitch's own defaults, a little stricter on short notes (sung melodies don't have 60 ms notes)
  const events = outputToNotesPoly(frames, onsets, opts.onset ?? 0.5, opts.frame ?? 0.3, opts.minLen ?? 8, true, null, null, true);
  return noteFramesToTime(events);
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "transcribe") self.postMessage({ type: "notes", notes: await transcribe(m.samples, m.modelUrl, m.opts) });
  } catch (err) {
    self.postMessage({ type: "error", message: err?.message || String(err) });
  }
};
