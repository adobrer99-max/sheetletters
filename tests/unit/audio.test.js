import { describe, it, expect } from "vitest";
import { findBeat, beatPosition, harmonyChange, pickDownbeat } from "../../src/audio/rhythm.js";
import { melodyLine, quantize, toMidiFile } from "../../src/audio/melody.js";
import { parseMIDI } from "../../src/parse/midi.js";
import { finish } from "../../src/score/finish.js";

const RATE = 22050;
// a drum loop: a low kick on beat 1 and 3, a bright snare-like click on 2 and 4, hi-hats on the off-beats,
// starting `lead` seconds in, with a little human timing wobble
function drums(bpm, seconds, { lead = 0.3, wobble = 0.008, seed = 1 } = {}) {
  const out = new Float32Array(Math.round(seconds * RATE));
  let r = seed;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647) - 0.5;
  const hit = (t, f, len, amp, noise) => {
    const s0 = Math.round(t * RATE);
    for (let i = 0; i < len * RATE && s0 + i < out.length; i++) {
      const e = Math.exp(-i / (RATE * len * 0.25));
      out[s0 + i] += amp * e * (noise ? rand() * 2 : Math.sin((2 * Math.PI * f * i) / RATE));
    }
  };
  const beat = 60 / bpm;
  for (let b = 0; lead + b * beat < seconds; b++) {
    const t = lead + b * beat + rand() * wobble;
    if (b % 4 === 0) hit(t, 55, 0.25, 1.0, false);      // kick, bar start
    else if (b % 4 === 2) hit(t, 60, 0.2, 0.6, false);  // softer kick
    else hit(t, 0, 0.12, 0.5, true);                     // snare
    hit(t + beat / 2, 0, 0.03, 0.15, true);              // hat
  }
  return out;
}

describe("finding the beat", () => {
  for (const bpm of [84, 100, 128]) {
    it(`hears ${bpm} BPM`, () => {
      const { bpm: got, beats } = findBeat(drums(bpm, 20), RATE);
      expect(Math.abs(got - bpm)).toBeLessThan(2);
      expect(beats.length).toBeGreaterThan(20 * bpm / 60 - 4);
    });
  }
  it("finds where bars start", () => {
    const { beats, downbeat } = findBeat(drums(100, 20, { lead: 0.3 }), RATE);
    // the bar starts on the kick at 0.3 s + whole bars; the chosen downbeat should land on one of those
    const t = beats[downbeat];
    const barsIn = (t - 0.3) / (4 * 0.6);
    expect(Math.abs(barsIn - Math.round(barsIn))).toBeLessThan(0.05);
  });
  it("turns times into beat numbers", () => {
    const beats = [1, 1.5, 2, 2.5];
    expect(beatPosition(1.25, beats)).toBeCloseTo(0.5);
    expect(beatPosition(3, beats)).toBeCloseTo(4);
    expect(beatPosition(0.5, beats)).toBeCloseTo(-1);
  });
});

describe("melody line", () => {
  const ev = (start, dur, midi, amp = 0.8) => ({ startTimeSeconds: start, durationSeconds: dur, pitch_midi: midi, amplitude: amp });
  it("keeps one note at a time, the loudest for vocals", () => {
    const line = melodyLine([ev(0, 0.5, 60), ev(0.05, 0.4, 67, 0.3), ev(0.5, 0.5, 62)], "vocals");
    expect(line.map((n) => n.midi)).toEqual([60, 62]);
  });
  it("keeps the loudest note for a lead instrument, the top for solo piano, the bottom for bass", () => {
    const chord = [ev(0, 1, 60, 0.7), ev(0, 1, 64, 0.7), ev(0, 1, 67, 0.7)];
    expect(melodyLine([ev(0, 1, 60, 0.4), ev(0, 1, 64, 0.9), ev(0, 1, 67, 0.4)], "other")[0].midi).toBe(64);
    expect(melodyLine(chord, "solo")[0].midi).toBe(67);
    expect(melodyLine(chord.map((e) => ({ ...e, pitch_midi: e.pitch_midi - 24 })), "bass")[0].midi).toBe(36);
  });
  it("reads Basic Pitch's JavaScript field names", () => {
    const line = melodyLine([{ startTimeSeconds: 0, durationSeconds: 0.5, pitchMidi: 60, amplitude: 0.8 }], "solo");
    expect(line.map((n) => n.midi)).toEqual([60]);
  });
  it("drops faint bleed and blips, and fixes octave slips", () => {
    const line = melodyLine([ev(0, 0.5, 64), ev(0.5, 0.1, 76), ev(0.6, 0.5, 64), ev(1.1, 0.03, 70), ev(1.2, 0.4, 62, 0.05)], "vocals");
    expect(line.map((n) => n.midi)).toEqual([64, 64, 64]);
  });
});

describe("placing notes on the beat and reading them back", () => {
  it("rounds to sixteenths from the first bar line and spells the notes", () => {
    const beats = Array.from({ length: 16 }, (_, i) => 0.5 + i * 0.6); // 100 BPM, first beat at 0.5 s
    // Ode to Joy's opening, slightly early and late, starting on beat 1 of the second bar of beats
    const tune = [64, 64, 65, 67, 67, 65, 64, 62];
    const line = tune.map((m, i) => ({ start: 0.5 + (4 + i) * 0.6 + (i % 2 ? 0.02 : -0.015), end: 0.5 + (5 + i) * 0.6 - 0.05, midi: m }));
    const { notes, origin } = quantize(line, beats, { downbeat: 0 });
    expect(origin).toBe(4);
    expect(notes.map((n) => n.on)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(notes.every((n) => n.off - n.on === 1)).toBe(true);
    const bytes = toMidiFile(notes, { bpm: 100, title: "Test" });
    const s = finish(parseMIDI(bytes.buffer));
    expect(Math.round(s.tempo)).toBe(100);
    expect(s.measures).toHaveLength(2);
    const names = s.measures.flatMap((m) => (m.rows[s.rows[0].id] || []).filter((e) => !e.rest).map((e) => e.notes[0].step));
    expect(names).toEqual(["E", "E", "F", "G", "G", "F", "E", "D"]);
  });
});

describe("bar lines from chord changes", () => {
  it("prefers the beat where the chord changes when the kicks can't tell", () => {
    // 100 BPM, a new chord every bar starting on beat 1 (index 1 here), equal kicks everywhere
    const beats = Array.from({ length: 32 }, (_, i) => 0.4 + i * 0.6);
    const chords = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]];
    const x = new Float32Array(Math.round(20 * RATE));
    beats.forEach((b, i) => {
      const bar = Math.floor((i - 1) / 4), ch = chords[((bar % 4) + 4) % 4];
      for (let j = 0; j < 0.6 * RATE; j++) {
        const k = Math.round(b * RATE) + j;
        if (k < x.length) for (const m of ch) x[k] += 0.1 * Math.sin((2 * Math.PI * 440 * 2 ** ((m - 69) / 12) * j) / RATE);
      }
    });
    const flat = new Float32Array(2000).fill(0.5); // the kick clue says nothing
    expect(pickDownbeat(flat, 43, beats, 4, harmonyChange(x, RATE, beats))).toBe(1);
  });
});
