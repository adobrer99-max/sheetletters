// Lining the letters up with the recording they came from.
//
// A recording's score is written at one steady speed, but the band doesn't play at one steady speed:
// the beats found in the recording (seconds, one per beat) say where each beat really falls. A place
// in the score (quarter notes from the start of the first bar) is a beat number once the bar-line
// shift is added, and the beat list turns that into seconds; the same in reverse for the highlight.

import { beatPosition } from "./rhythm.js";

/** Seconds at beat number b (fractional), from the beat times. The inverse of beatPosition. */
export function beatTime(b, beats) {
  const n = beats.length;
  if (n < 2) return b / 2; // nothing to go on: 120 BPM
  if (b <= 0) return beats[0] + b * (beats[1] - beats[0]);
  if (b >= n - 1) return beats[n - 1] + (b - (n - 1)) * (beats[n - 1] - beats[n - 2]);
  const i = Math.floor(b);
  return beats[i] + (b - i) * (beats[i + 1] - beats[i]);
}

/** shift: beat number where the score's first bar starts. offset: seconds into the audio file where
 *  the beat times start counting (the start of the chosen section, or 0 for a part's own audio). */
export function makeSync({ beats, shift = 0 }, offset = 0) {
  return {
    timeAt: (q) => offset + beatTime(q + shift, beats),
    posAt: (t) => beatPosition(t - offset, beats) - shift,
  };
}
