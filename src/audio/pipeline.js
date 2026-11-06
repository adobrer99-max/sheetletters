// A recording -> a Sheet Letters score.
//
//   1. decode the file (any format the browser plays: MP3, WAV, M4A/AAC, FLAC, OGG...)
//   2. split it into drums / bass / other / vocals (separate.worker.js), unless it's a solo recording
//   3. find the beat, from the drums and bass (or the whole recording)
//   4. hear the notes in the chosen part (transcribe.worker.js)
//   5. keep one melody line, put it on the beat, write it as MIDI, read that with the usual MIDI reader
//
// Steps 3–5 are cheap and re-run instantly when the user fixes the speed, the bar line or the part,
// so the expensive split is done once per song.

import { findBeat, beatsToBpm, beatChroma } from "./rhythm.js";
import { estimateKey, chordsPerBeat, placeChords, majorOrMinor } from "./chords.js";
import { melodyLine, quantize, toMidiFile, PARTS } from "./melody.js";
import { parseMIDI } from "../parse/midi.js";

const SPLIT_RATE = 44100, NOTE_RATE = 22050;
const AUDIO_EXT = /^(wav|wave|mp3|m4a|aac|mp4|flac|ogg|oga|opus|webm|aif|aiff|caf)$/;

/** Is this file a recording rather than sheet music? */
export function isAudioFile(file, head4 = "", u8) {
  const ext = ((file.name || "").match(/\.([^.]+)$/) || [, ""])[1].toLowerCase();
  // MIDI is sheet music, not a recording, even though browsers label it audio/midi
  if (head4 === "MThd" || /^(mid|midi|kar|rmi|smf)$/.test(ext) || /midi/i.test(file.type || "")) return false;
  if (head4 === "RIFF" && u8) return String.fromCharCode(...u8.subarray(8, 12)) === "WAVE"; // .wav, not RIFF-wrapped MIDI
  return AUDIO_EXT.test(ext) || /^audio\//.test(file.type || "");
}

/** Decode to 44.1 kHz stereo (what the splitting model wants), optionally just from..to seconds. */
export async function decodeAudio(file, { from = 0, to = Infinity } = {}) {
  const bytes = await file.arrayBuffer();
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const probe = new Ctx(2, 1, SPLIT_RATE);
  const src = await new Promise((ok, bad) => probe.decodeAudioData(bytes, ok, () => bad(new Error("This browser can't open that audio file. Try MP3 or WAV."))));
  const duration = src.duration;
  const a = Math.max(0, Math.min(from, duration)), b = Math.max(a + 1, Math.min(to, duration));
  const len = Math.round((b - a) * SPLIT_RATE);
  const ctx = new Ctx(2, len, SPLIT_RATE); // resample (and down-mix or spread mono) by rendering
  const node = ctx.createBufferSource();
  node.buffer = src; node.connect(ctx.destination); node.start(0, a, b - a);
  const out = await ctx.startRendering();
  return { left: out.getChannelData(0), right: out.getChannelData(1), duration, from: a, to: b };
}

export async function audioDuration(file) {
  const bytes = await file.arrayBuffer();
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const probe = new Ctx(1, 1, SPLIT_RATE);
  const buf = await new Promise((ok, bad) => probe.decodeAudioData(bytes, ok, bad));
  return buf.duration;
}

// does a solo recording play chords? (more than a third of the time, two or more notes at once)
function polyphonic(events = []) {
  let both = 0, any = 0;
  const edges = events.flatMap((e) => [[e.startTimeSeconds, 1], [e.startTimeSeconds + e.durationSeconds, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let on = 0, last = 0;
  for (const [t, d] of edges) { if (on >= 1) any += t - last; if (on >= 2) both += t - last; on += d; last = t; }
  return any > 0 && both / any > 0.33;
}

const rms = (a) => { let s = 0, n = 0; for (let i = 0; i < a.length; i += 5) { s += a[i] * a[i]; n++; } return Math.sqrt(s / Math.max(1, n)); };

function mono22k(left, right) {
  const n = Math.floor(left.length / 2), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.25 * (left[2 * i] + right[2 * i] + left[2 * i + 1] + right[2 * i + 1]);
  return out;
}

// run one job in a worker; resolves with the final message, reports progress on the way
function runWorker(worker, msg, transfer, onProgress, doneType) {
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") onProgress?.(m);
      else if (m.type === "error") reject(new Error(m.message));
      else if (m.type === doneType) resolve(m);
    };
    worker.onerror = (e) => reject(new Error(e.message || "The worker stopped."));
    worker.postMessage(msg, transfer);
  });
}

export const canSplitHere = () => typeof Worker !== "undefined" && typeof OfflineAudioContext !== "undefined";
export const looksLikePhone = () =>
  matchMedia("(pointer: coarse)").matches && Math.max(screen.width, screen.height) < 1100;

export class RecordingImport {
  constructor({ onProgress } = {}) {
    this.onProgress = onProgress || (() => {});
    this.splitter = null; this.noter = null;
    this.reset();
  }
  reset() { this.file = null; this.stems = null; this.mix = null; this.beat = null; this.events = {}; this.settings = null; }
  stop() {
    this.splitter?.terminate(); this.noter?.terminate();
    this.splitter = this.noter = null;
  }

  /** The whole job. `part` is vocals | other | bass | solo. Returns a score ready for show(). */
  async run(file, { part = "vocals", from = 0, to = Infinity, perBar = 4 } = {}) {
    this.reset();
    this.file = file;
    this.onProgress({ stage: "decode", done: 0, total: 1 });
    const audio = await decodeAudio(file, { from, to });
    this.range = [audio.from, audio.to];
    this.mix = mono22k(audio.left, audio.right);
    if (part !== "solo") {
      this.splitter ||= new Worker(new URL("./separate.worker.js", import.meta.url), { type: "module" });
      const q = new URLSearchParams(location.search), abs = (u) => u && new URL(u, document.baseURI).href;
      const res = await runWorker(this.splitter, { type: "separate", left: audio.left, right: audio.right, modelUrl: abs(q.get("model")), ortDir: abs(q.get("ort")) },
        [audio.left.buffer, audio.right.buffer], this.onProgress, "stems");
      this.stems = res.stems; this.device = res.device;
    }
    this.onProgress({ stage: "beat", done: 0, total: 1 });
    await new Promise((r) => setTimeout(r, 0)); // let the progress paint before the (short) number crunch
    this.findBeat(perBar);
    // An instrumental (or a voice the splitter didn't recognise) leaves the vocals part almost silent:
    // its "notes" would just be leftover hiss, so take the lead instrument instead and say so.
    this.switchedFrom = null;
    if (part === "vocals" && this.stems && rms(this.stems.vocals) < 0.1 * rms(this.stems.other)) { this.switchedFrom = "vocals"; part = "other"; }
    return this.setPart(part, { perBar });
  }

  /** The beat, from the drums and bass when the song has been split, else from the whole recording. */
  findBeat(perBar = 4, bpm) {
    let src = this.mix, harmony = this.mix;
    if (this.stems) {
      const { drums, bass, other } = this.stems;
      src = new Float32Array(drums.length); harmony = new Float32Array(drums.length);
      for (let i = 0; i < src.length; i++) { src[i] = drums[i] + 0.6 * bass[i]; harmony[i] = other[i] + bass[i]; }
    }
    this.beat = findBeat(src, NOTE_RATE, { perBar, bpm, harmony });
    this.harmonyAudio = harmony;
  }

  /** The audio of a part (for "hear it" and for note-finding). */
  partAudio(part) { return part === "solo" || !this.stems ? this.mix : this.stems[part]; }

  /** Hear the notes in a part (cached per part), then build the score. */
  async setPart(part, settings = {}) {
    if (!this.events[part]) {
      this.noter ||= new Worker(new URL("./transcribe.worker.js", import.meta.url), { type: "module" });
      const samples = this.partAudio(part).slice(); // a copy: the original stays for "hear it"
      const modelUrl = new URL("models/basic-pitch/model.json", document.baseURI).href;
      this.events[part] = await this.transcribe(samples, modelUrl);
    }
    return this.build({ ...(this.settings || {}), ...settings, part });
  }

  // Note-finding, with a safety net: if the graphics-chip route goes quiet for 25 s (a driver that
  // stalls), start over with plain JavaScript, which is slower but always finishes.
  async transcribe(samples, modelUrl, backend) {
    const copy = samples.slice();
    let quiet = null;
    const watchdog = new Promise((_, reject) => {
      const arm = () => { clearTimeout(quiet); quiet = setTimeout(() => reject(new Error("stalled")), 25000); };
      this._arm = arm; arm();
    });
    const job = runWorker(this.noter, { type: "transcribe", samples, modelUrl, opts: backend ? { backend } : {} }, [samples.buffer],
      (m) => { this._arm?.(); this.onProgress(m); }, "notes");
    try {
      return (await Promise.race([job, watchdog])).notes;
    } catch (err) {
      if (err.message !== "stalled" || backend === "cpu") throw err;
      this.noter.terminate();
      this.noter = new Worker(new URL("./transcribe.worker.js", import.meta.url), { type: "module" });
      return this.transcribe(copy, modelUrl, "cpu");
    } finally { clearTimeout(quiet); this._arm = null; }
  }

  /** Steps that are instant: melody line, beat grid, bars, MIDI, score. Null if no melody turned up. */
  build(settings) {
    const s = (this.settings = { perBar: 4, grid: 0.25, barShift: 0, ...settings });
    const line = melodyLine(this.events[s.part] || [], s.part);
    const downbeat = (this.beat.downbeat + s.barShift + s.perBar * 8) % s.perBar;
    const { notes, origin } = quantize(line, this.beat.beats, { downbeat, perBar: s.perBar, grid: s.grid });
    const bpm = beatsToBpm(this.beat.beats);
    // what's sounding in each beat: for the key, and for chord names
    if (this._chromaFor !== this.beat.beats) { this.harmony = beatChroma(this.harmonyAudio, NOTE_RATE, this.beat.beats); this._chromaFor = this.beat.beats; }
    const { chroma, energy } = this.harmony;
    const weights = new Array(12).fill(0);
    chroma.forEach((c, i) => { for (let k = 0; k < 12; k++) weights[k] += c[k] * energy[i]; });
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    for (let k = 0; k < 12; k++) weights[k] /= total;
    const melodyW = new Array(12).fill(0);
    for (const n of notes) melodyW[n.midi % 12] += n.off - n.on;
    const mt = melodyW.reduce((a, b) => a + b, 0) || 1;
    let key = estimateKey(weights.map((w, k) => w + 0.5 * (melodyW[k] / mt)));
    const chordsWanted = !!this.stems || polyphonic(this.events[s.part]);
    const perBeat = chordsWanted ? chordsPerBeat(chroma, energy) : null;
    if (perBeat) key = majorOrMinor(key, perBeat);
    const name = (this.file?.name || "Recording").replace(/\.[^.]+$/, "");
    if (!notes.length) return null; // nothing clear in this part: the panel says so and offers the others
    const score = parseMIDI(toMidiFile(notes, { bpm, perBar: s.perBar, key }).buffer);
    // chord names: from the bass and other parts of a split song, or a solo that plays chords (piano, guitar)
    if (perBeat) {
      const placed = placeChords(perBeat, { origin, perBar: s.perBar, measures: score.measures.length, fifths: key.fifths });
      score.measures.forEach((m, i) => { m.harmony = placed[i]; });
      // a trimmed pickup bar moved its notes earlier: move its chords the same way, keeping the one
      // already sounding when the bar now starts
      const m0 = score.measures[0], cut = m0.pickupCut || 0;
      if (cut && m0.harmony.length) {
        const moved = m0.harmony.map((c) => ({ ...c, t: c.t - cut }));
        const before = moved.filter((c) => c.t <= 1e-6).pop();
        m0.harmony = (before ? [{ ...before, t: 0 }] : []).concat(moved.filter((c) => c.t > 1e-6));
      }
      score.chordsHeard = placed.some((c) => c.length);
    }
    score.title = name;
    score.format = `a recording (${PARTS[s.part].label.toLowerCase()})`;
    score.fromRecording = { part: s.part, bpm: Math.round(bpm), notes: notes.length };
    if (score.rows[0]) score.rows[0].name = PARTS[s.part].label;
    return score;
  }

  /** Fix-ups the user can make without re-running anything slow. */
  halfSpeed() { const b = this.beat.beats; this.beat = { ...this.beat, beats: b.filter((_, i) => i % 2 === 0), downbeat: Math.floor(this.beat.downbeat / 2) }; return this.build({}); }
  doubleSpeed() {
    const b = this.beat.beats, out = [];
    b.forEach((t, i) => { out.push(t); if (i < b.length - 1) out.push((t + b[i + 1]) / 2); });
    this.beat = { ...this.beat, beats: out, downbeat: this.beat.downbeat * 2 };
    return this.build({});
  }
  shiftBar(by = 1) { return this.build({ barShift: (this.settings.barShift || 0) + by }); }
  setMeter(perBar) { this.findBeat(perBar); return this.build({ perBar, barShift: 0 }); }
  setDetail(grid) { return this.build({ grid }); }
}

/** A part's audio as a WAV file, so it can be played in an <audio> element. */
export function wavBlob(samples, rate = NOTE_RATE) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const g = peak > 0 ? 0.9 / peak : 1;
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i] * g)) * 32767, true);
  return new Blob([buf], { type: "audio/wav" });
}
