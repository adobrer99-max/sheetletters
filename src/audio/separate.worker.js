// Splits a song into drums, bass, other (guitar, keys, lead) and vocals with Meta's HTDemucs model,
// in the browser. Runs in a worker so the page stays responsive.
//
// Nothing here sends audio anywhere. The only downloads are the model (from Hugging Face, kept in the
// browser's cache after the first time) and ONNX Runtime's engine (from jsDelivr): see NOTICE.md.
//
// in:  { type: "separate", left, right }   44.1 kHz stereo Float32Arrays
// out: { type: "progress", stage, done, total } ... then { type: "stems", rate, stems: { drums, bass, other, vocals } }
//      with each stem mono at 22.05 kHz, which is all the note-finding needs (and a quarter of the memory).

import { DemucsProcessor, CONSTANTS } from "demucs-web";

const ORT_VERSION = "1.31.1";
// Where the engine and model come from. Both can be overridden (for self-hosting, or tests) with
// ?ort=<folder>/ and ?model=<url> on the page, which the page passes along.
let ORT_DIR = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
let MODEL_URL = CONSTANTS.DEFAULT_MODEL_URL; // htdemucs_embedded.onnx, ~172 MB, MIT licence
const CACHE = "sheet-letters-models-v1";
const RATE = 44100, OUT_RATE = 22050;
const CHUNK = 60 * RATE, OVERLAP = 2 * RATE; // work through the song a minute at a time

const post = (m, transfer) => self.postMessage(m, transfer || []);
const progress = (stage, done, total, extra = {}) => post({ type: "progress", stage, done, total, ...extra });

async function loadOrt() {
  const ort = await import(/* @vite-ignore */ ORT_DIR + "ort.webgpu.bundle.min.mjs");
  ort.env.wasm.wasmPaths = ORT_DIR;
  // more threads only work when the page is cross-origin isolated; otherwise ORT uses one
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  return ort;
}

// the model, from the browser's cache if it's been downloaded before
async function loadModel() {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch { /* private browsing: download every time */ }
  const hit = cache && (await cache.match(MODEL_URL));
  if (hit) { progress("model", 1, 1, { cached: true }); return await hit.arrayBuffer(); }
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Couldn't download the song-splitting model (${res.status}).`);
  const total = +res.headers.get("Content-Length") || 180_534_758;
  const reader = res.body.getReader(), parts = [];
  let got = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    if (got - last > 1 << 20) { last = got; progress("model", got, total); }
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  progress("model", got, got);
  if (cache) { try { await cache.put(MODEL_URL, new Response(buf, { headers: { "Content-Type": "application/octet-stream" } })); } catch { /* storage full: fine */ } }
  return buf.buffer;
}

// 44.1 kHz stereo -> 22.05 kHz mono, with a small low-pass so nothing folds back
function toMono22k(left, right, from = 0, to = left.length) {
  const n = Math.floor((to - from) / 2), out = new Float32Array(n);
  const tap = [0.0625, 0.25, 0.375, 0.25, 0.0625];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -2; k <= 2; k++) {
      const j = Math.min(to - 1, Math.max(from, from + 2 * i + k));
      s += tap[k + 2] * (left[j] + right[j]);
    }
    out[i] = s / 2;
  }
  return out;
}

let processor = null, device = "";

// WebGPU only helps on a real graphics chip. A software stand-in (SwiftShader and the like) is far
// slower than plain WebAssembly and eats memory, so treat it as no GPU.
async function realGpu() {
  try {
    const adapter = self.navigator.gpu && (await self.navigator.gpu.requestAdapter());
    if (!adapter) return false;
    const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
    if (adapter.isFallbackAdapter || info.isFallbackAdapter) return false;
    return !/swiftshader|llvmpipe|software/i.test(`${info.vendor} ${info.architecture} ${info.device} ${info.description}`);
  } catch { return false; }
}

async function separate(left, right) {
  if (!processor) {
    progress("engine", 0, 1);
    const ort = await loadOrt();
    const model = await loadModel();
    progress("engine", 0, 1);
    const hasGpu = await realGpu();
    processor = new DemucsProcessor({ ort, sessionOptions: { executionProviders: hasGpu ? ["webgpu", "wasm"] : ["wasm"] } });
    await processor.loadModel(model);
    device = hasGpu ? "webgpu" : "wasm";
    progress("engine", 1, 1, { device });
  }
  const total = left.length;
  const outLen = Math.floor(total / 2);
  const stems = Object.fromEntries(CONSTANTS.TRACKS.map((t) => [t, new Float32Array(outLen)]));
  const chunks = [];
  for (let s = 0; s < total; s += CHUNK - OVERLAP) { chunks.push(s); if (s + CHUNK >= total) break; }
  let doneSamples = 0;
  for (let c = 0; c < chunks.length; c++) {
    const s = chunks[c], e = Math.min(total, s + CHUNK);
    processor.onProgress = (p) => progress("split", doneSamples + (p.progress || 0) * (e - s - (c ? OVERLAP : 0)), total, { device });
    const res = await processor.separate(left.subarray(s, e), right.subarray(s, e));
    const o0 = s / 2, fade = OVERLAP / 2;
    for (const t of CONSTANTS.TRACKS) {
      const mono = toMono22k(res[t].left, res[t].right);
      const dst = stems[t];
      for (let i = 0; i < mono.length && o0 + i < outLen; i++) {
        if (c && i < fade) { const w = i / fade; dst[o0 + i] = dst[o0 + i] * (1 - w) + mono[i] * w; } // cross-fade the overlap
        else dst[o0 + i] = mono[i];
      }
    }
    doneSamples += e - s - (c ? OVERLAP : 0);
  }
  progress("split", total, total, { device });
  post({ type: "stems", rate: OUT_RATE, device, stems }, Object.values(stems).map((a) => a.buffer));
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.ortDir) ORT_DIR = m.ortDir;
  if (m.modelUrl) MODEL_URL = m.modelUrl;
  try {
    if (m.type === "separate") await separate(m.left, m.right);
    if (m.type === "warm") { if (!processor) { await loadOrt(); await loadModel(); } post({ type: "warm" }); }
  } catch (err) {
    post({ type: "error", message: err?.message || String(err) });
  }
};
