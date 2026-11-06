// Finding the beat in a recording, and placing notes on it.
// Everything here is plain maths on arrays, so it runs in a worker and in unit tests.
//
//   onsetEnvelope(samples, rate)  how much "new sound" starts in each ~23 ms frame
//   estimateTempo(env, fps)       the most likely beats per minute (60–200)
//   trackBeats(env, fps, bpm)     beat times in seconds, allowed to drift with the music
//   pickDownbeat(env, fps, beats) which beat of every 4 (or 3) starts a bar
//   beatPosition(t, beats)        a time in seconds as a (fractional) beat number

const HOP = 512, N = 1024;

// in-place radix-2 FFT on re/im arrays of length n (a power of two)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/** Onset strength: how much new sound starts in each frame. Measured in 24 bands spaced the way
 *  hearing is (so broadband hiss doesn't drown out a kick drum), plus the low end (kick and bass)
 *  counted again on its own, since that's what usually drives the beat in pop music.
 *  Returns { env, low, fps }: `env` for the beat, `low` for finding bar starts, both scaled 0..1. */
export function onsetEnvelope(samples, rate, { bands = 24 } = {}) {
  const frames = Math.max(0, Math.floor((samples.length - N) / HOP) + 1);
  const full = new Float32Array(frames), low = new Float32Array(frames);
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const mel = (f) => 2595 * Math.log10(1 + f / 700), imel = (m) => 700 * (10 ** (m / 2595) - 1);
  const top = Math.min(11000, rate / 2 - 1);
  const edges = Array.from({ length: bands + 2 }, (_, i) => Math.round((imel(mel(30) + ((mel(top) - mel(30)) * i) / (bands + 1)) * N) / rate));
  const lowBin = Math.max(2, Math.round((150 * N) / rate));
  let prev = new Float32Array(bands), prevLow = 0;
  const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(N / 2);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < N; i++) { re[i] = samples[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    const b = new Float32Array(bands);
    let flux = 0;
    for (let k = 0; k < bands; k++) {
      const lo = edges[k], hi = Math.max(edges[k + 2], lo + 1);
      let e = 0;
      for (let j = lo; j < hi; j++) e += mag[j];
      b[k] = Math.log1p(e / (hi - lo));
      const d = b[k] - prev[k];
      if (d > 0) flux += d;
    }
    let le = 0; // plain (not squashed) loudness, so a big kick stands out from a soft one
    for (let j = 1; j <= lowBin; j++) le += mag[j];
    full[f] = flux; low[f] = Math.max(0, le - prevLow);
    prev = b; prevLow = le;
  }
  // remove the slow-moving loudness so only the "kicks" remain, then scale to 0..1
  const clean = (a) => {
    const w = 16, sm = new Float32Array(a.length);
    let acc = 0;
    for (let i = 0; i < a.length; i++) { acc += a[i]; if (i >= w) acc -= a[i - w]; sm[i] = acc / Math.min(i + 1, w); }
    let max = 0;
    for (let i = 0; i < a.length; i++) { a[i] = Math.max(0, a[i] - sm[i]); if (a[i] > max) max = a[i]; }
    if (max > 0) for (let i = 0; i < a.length; i++) a[i] /= max;
    return a;
  };
  clean(full); clean(low);
  const env = new Float32Array(frames);
  let max = 0;
  for (let i = 0; i < frames; i++) { env[i] = full[i] + Math.sqrt(low[i]); if (env[i] > max) max = env[i]; }
  if (max > 0) for (let i = 0; i < frames; i++) env[i] /= max;
  return { env, low, fps: rate / HOP };
}

/** Most likely tempo, by autocorrelating the (lightly smoothed) onset envelope. The beat and the
 *  half-bar above it and the eighth notes below it should all line up, and a gentle preference for ~110 BPM breaks ties between
 *  half and double speed, which is the usual mistake. */
export function estimateTempo(env, fps, { min = 60, max = 200 } = {}) {
  const sm = new Float32Array(env.length);
  for (let i = 0; i < env.length; i++) sm[i] = 0.25 * (env[i - 1] || 0) + 0.5 * env[i] + 0.25 * (env[i + 1] || 0);
  const ac = (lag) => {
    const l0 = Math.floor(lag), fr = lag - l0;
    let s = 0;
    for (let i = l0 + 1; i < sm.length; i++) s += sm[i] * (sm[i - l0] * (1 - fr) + sm[i - l0 - 1] * fr);
    return s / Math.max(1, sm.length - l0);
  };
  let best = -1, bestBpm = 120;
  for (let bpm = min; bpm <= max; bpm += 0.5) {
    const lag = (60 * fps) / bpm;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2);
    const s = (ac(lag) + 0.5 * ac(2 * lag) + 0.5 * ac(lag / 2)) * prior;
    if (s > best) { best = s; bestBpm = bpm; }
  }
  return bestBpm;
}

/** Dynamic-programming beat tracker (Ellis 2007): beats land on onsets while keeping a steady
 *  spacing near the tempo. Returns beat times in seconds. */
export function trackBeats(env, fps, bpm, tightness = 100) {
  const period = (60 * fps) / bpm, n = env.length;
  if (!n) return [];
  const score = new Float32Array(n), back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2), hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = -Infinity, arg = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const v = score[p] - tightness * Math.log((t - p) / period) ** 2;
      if (v > best) { best = v; arg = p; }
    }
    score[t] = env[t] + (arg >= 0 ? best : 0);
    back[t] = arg;
  }
  // end on the best-scoring frame within the last beat
  let t = n - 1, bestEnd = -Infinity;
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > bestEnd) { bestEnd = score[i]; t = i; }
  const beats = [];
  while (t >= 0) { beats.push(t / fps); t = back[t]; }
  beats.reverse();
  return beats;
}

/** How much the harmony changes at each beat: the notes sounding in each beat (as 12 pitch classes)
 *  compared with the beat before. Chords usually change on the first beat of a bar. */
export function harmonyChange(samples, rate, beats) {
  const W = 4096, out = new Float32Array(beats.length);
  const re = new Float32Array(W), im = new Float32Array(W);
  const win = new Float32Array(W).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / W));
  const pcOf = new Int8Array(W / 2).fill(-1);
  for (let k = 1; k < W / 2; k++) {
    const f = (k * rate) / W;
    if (f >= 60 && f <= 2000) pcOf[k] = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12; // 0 = C
  }
  let prev = null;
  beats.forEach((b, i) => {
    const end = i + 1 < beats.length ? beats[i + 1] : b + (beats[i] - (beats[i - 1] ?? b - 0.5));
    const chroma = new Float32Array(12);
    // a couple of windows across the beat, averaged
    for (const at of [0.3, 0.7]) {
      const c = Math.round((b + (end - b) * at) * rate) - W / 2;
      for (let j = 0; j < W; j++) { const v = samples[c + j]; re[j] = (v === undefined ? 0 : v) * win[j]; im[j] = 0; }
      fft(re, im);
      for (let k = 1; k < W / 2; k++) if (pcOf[k] >= 0) chroma[pcOf[k]] += Math.log1p(10 * Math.hypot(re[k], im[k]));
    }
    const norm = Math.hypot(...chroma) || 1;
    for (let k = 0; k < 12; k++) chroma[k] /= norm;
    out[i] = prev ? 1 - chroma.reduce((acc, v, k) => acc + v * prev[k], 0) : 0;
    prev = chroma;
  });
  return out;
}

/** Which beat (0..perBar-1) starts each bar. Two clues: chords tend to change there, and the kick
 *  tends to hit hardest there. The harmony counts for more when there is any. */
export function pickDownbeat(low, fps, beats, perBar = 4, change = null) {
  const kick = new Array(perBar).fill(0), harm = new Array(perBar).fill(0);
  beats.forEach((b, i) => {
    const f = Math.round(b * fps);
    let v = 0;
    for (let k = f - 2; k <= f + 2; k++) if (low[k] > v) v = low[k];
    kick[i % perBar] += v;
    if (change) harm[i % perBar] += change[i];
  });
  // compare the phases relative to each other (0 = weakest, 1 = strongest)
  const spread = (a) => { const lo = Math.min(...a), hi = Math.max(...a); return a.map((x) => (hi > lo ? (x - lo) / (hi - lo) : 0)); };
  const k = spread(kick), h = spread(harm);
  const hasHarmony = change && Math.max(...harm) - Math.min(...harm) > 0.02 * beats.length / perBar;
  const score = k.map((x, i) => (hasHarmony ? 0.4 * x + h[i] : x));
  return score.indexOf(Math.max(...score));
}

/** Time in seconds -> beat number (fractional), interpolating between tracked beats and
 *  extending at the first/last beat's spacing outside them. */
export function beatPosition(t, beats) {
  const n = beats.length;
  if (n < 2) return t * 2; // nothing to go on: assume 120 BPM
  if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
  if (t >= beats[n - 1]) return n - 1 + (t - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (beats[mid] <= t) lo = mid; else hi = mid; }
  return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
}

/** Median tempo of tracked beats. */
export function beatsToBpm(beats) {
  if (beats.length < 2) return 120;
  // least-squares slope of beat time against beat number: beat times are rounded to ~23 ms frames,
  // so averaging over all of them is far more precise than any one gap
  const n = beats.length, mx = (n - 1) / 2, my = beats.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  beats.forEach((b, i) => { num += (i - mx) * (b - my); den += (i - mx) ** 2; });
  return 60 / (num / den);
}

// how strongly the envelope peaks near time t (seconds)
const near = (env, fps, t) => { const f = Math.round(t * fps); let v = 0; for (let k = f - 1; k <= f + 1; k++) if (env[k] > v) v = env[k]; return v; };

/** The usual tempo mistake is half or double speed. Check the tracked beats against the music:
 *  hits landing halfway between beats (a backbeat snare) mean the real beat is twice as fast; every
 *  other beat being nearly empty means it's half as fast. Returns 2, 0.5 or 1. */
export function octaveCheck(env, fps, beats) {
  if (beats.length < 8) return 1;
  let on = 0, mid = 0, even = 0, odd = 0;
  for (let i = 0; i < beats.length - 1; i++) {
    const a = near(env, fps, beats[i]);
    on += a; mid += near(env, fps, (beats[i] + beats[i + 1]) / 2);
    if (i % 2) odd += a; else even += a;
  }
  const n = beats.length - 1;
  on /= n; mid /= n;
  const period = (beats[beats.length - 1] - beats[0]) / n;
  if (mid > 0.85 * on && period > 0.6) return 2;          // hits in between as strong as on the beat, and slow enough to double
  const weak = Math.min(even, odd) / Math.max(even, odd);
  if (weak < 0.35 && period < 0.5) return 0.5;            // every other beat nearly empty, and fast enough to halve
  return 1;
}

/** Find the beat of a recording in one go. `samples` is mono; `harmony` (optional) is audio to read
 *  the chords from, such as the bass and other parts of a split song. Returns { bpm, beats, downbeat }. */
export function findBeat(samples, rate, { perBar = 4, bpm: forcedBpm, harmony } = {}) {
  const { env, low, fps } = onsetEnvelope(samples, rate);
  let bpm = forcedBpm || estimateTempo(env, fps);
  let beats = trackBeats(env, fps, bpm);
  if (!forcedBpm) {
    const k = octaveCheck(env, fps, beats);
    const next = beatsToBpm(beats) * k;
    if (k !== 1 && next >= 60 && next <= 200) { bpm = next; beats = trackBeats(env, fps, bpm); }
  }
  const change = harmony ? harmonyChange(harmony, rate, beats) : null;
  return { bpm: beatsToBpm(beats), beats, downbeat: pickDownbeat(low, fps, beats, perBar, change) };
}
