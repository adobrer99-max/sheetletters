import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
import { parseMusicXML } from "../../src/parse/musicxml.js";
import { parseMIDI } from "../../src/parse/midi.js";
import { finish } from "../../src/score/finish.js";
import { transposeScore } from "../../src/score/transpose.js";
import { playOrder } from "../../src/score/order.js";

const fixture = (f) => readFileSync(join(here, "../fixtures", f));
const twinkle = readFileSync(join(here, "../../src/examples/twinkle.musicxml"), "utf8");
const letters = (score, mi, row = score.rows[0].id) =>
  (score.measures[mi].rows[row] || []).filter((e) => !e.rest).map((e) => e.notes.map((n) => n.step + (n.alter ? (n.alter > 0 ? "#" : "b") : "")).join("+"));

describe("MusicXML", () => {
  const s = finish(parseMusicXML(twinkle));
  it("reads the example song", () => {
    expect(s.title).toMatch(/Twinkle/);
    expect(s.measures).toHaveLength(12);
    expect(letters(s, 0)).toEqual(["C", "C", "G", "G"]);
  });
  it("guesses C major", () => { expect(s.keyInfo.fifths).toBe(0); expect(s.keyInfo.mode).toBe("major"); });
  it("keeps lyrics", () => { expect(s.measures[0].rows[s.rows[0].id][0].lyric.text).toBe("Twin"); });
  it("reads tempo, repeats, endings and ties", () => {
    const r = finish(parseMusicXML(fixture("repeat.musicxml").toString()));
    expect(r.tempo).toBe(120);
    expect(r.measures.map((m) => m.endNums?.join("/") || "-")).toEqual(["-", "-", "1", "2", "-", "-"]);
    expect(r.measures[4].rows[r.rows[0].id][0].notes[0].held).toBe(true);
    expect(playOrder(r.measures).map((i) => r.measures[i].number)).toEqual(["1", "2", "3", "2", "4", "5", "6"]);
  });
});

describe("MIDI", () => {
  it("reads notes, tempo and time signature", () => {
    const u8 = new Uint8Array(fixture("waltz.mid"));
    const s = finish(parseMIDI(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)));
    expect(s.tempo).toBeCloseTo(100);
    expect(s.measures[0].timeLen).toBe(3);
    expect(letters(s, 0)).toEqual(["C", "D", "E"]);
  });
});

describe("transposing", () => {
  it("moves every note and the key", () => {
    const s = finish(parseMusicXML(twinkle));
    const up = transposeScore(s, 2);
    expect(letters(up, 0)).toEqual(["D", "D", "A", "A"]);
    expect(up.keyInfo.fifths).toBe(2);
    expect(transposeScore(s, 0)).toBeTruthy();
  });
});

describe("play order", () => {
  const M = (a) => a.map((x) => ({ len: 4, timeLen: 4, ...x }));
  const cases = {
    "no repeats": [[{}, {}, {}], "012"],
    "back to the start": [[{}, { repEnd: true }, {}], "01012"],
    "from a repeat start": [[{}, { repStart: true }, { repEnd: true }, {}], "012123"],
    "1st and 2nd endings": [[{}, { endNums: [1], repEnd: true }, { endNums: [2] }, {}], "01023"],
    "endings 1-2 then 3": [[{ repStart: true }, { endNums: [1, 2], repEnd: true }, { endNums: [3] }, {}], "0101023"],
    "two repeated sections": [[{}, { repEnd: true }, { repStart: true }, { repEnd: true }, {}], "010123234"],
    "play three times": [[{}, { repEnd: true, repTimes: 3 }, {}], "0101012"],
  };
  for (const [name, [ms, want]] of Object.entries(cases)) it(name, () => expect(playOrder(M(ms)).join("")).toBe(want));
});
