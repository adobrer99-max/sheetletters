import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMusicXML } from "../../src/parse/musicxml.js";
import { parseMIDI } from "../../src/parse/midi.js";
import { finish } from "../../src/score/finish.js";
import { transposeScore } from "../../src/score/transpose.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (f) => readFileSync(join(here, "../fixtures", f));
const xml = finish(parseMusicXML(fixture("grace-triplets.musicxml").toString()));
const evs = (s, mi) => (s.measures[mi].rows[s.rows[0].id] || []).filter((e) => !e.rest);
const nm = (n) => n.step + (n.alter > 0 ? "#" : n.alter < 0 ? "b" : "");

describe("grace notes", () => {
  it("are attached to the next note, take no time, and keep their order", () => {
    const bar1 = evs(xml, 1);
    expect(bar1.map((e) => e.notes.map(nm).join("+"))).toEqual(["C", "E", "F", "G", "A"]);
    expect(bar1[0].grace.map(nm)).toEqual(["D"]);
    expect(bar1[4].grace.map(nm)).toEqual(["F#", "G"]);
    [0, 1, 4 / 3, 5 / 3, 2].forEach((t, i) => expect(bar1[i].t).toBeCloseTo(t, 6)); // the grace notes didn't push anything later
  });
  it("move when transposed", () => {
    const up = transposeScore(xml, 2);
    expect(evs(up, 1)[4].grace.map(nm)).toEqual(["G#", "A"]);
  });
});

describe("triplets", () => {
  it("use the file's own group marks", () => {
    const bar1 = evs(xml, 1);
    expect(bar1[1].tupStart).toBe(3);
    expect(bar1[3].tupEnd).toBe(true);
    expect(bar1[2].tupStart).toBeUndefined();
  });
  it("are counted into threes when the file only gives the timing", () => {
    // bar 2 has six triplet eighths and no marks, even though bar 1 has them
    expect(evs(xml, 2).map((e) => e.tupStart || (e.tupEnd ? "end" : "-"))).toEqual([3, "-", "end", 3, "-", "end", "-"]);
    const noMarks = finish(parseMusicXML(fixture("grace-triplets.musicxml").toString().replace(/<notations><tuplet type="(start|stop)"\/><\/notations>/g, "")));
    const b2 = evs(noMarks, 2);
    expect(b2.map((e) => e.tupStart || (e.tupEnd ? "end" : "-"))).toEqual([3, "-", "end", 3, "-", "end", "-"]);
  });
});

describe("pickup bars", () => {
  it("MusicXML pickups stay short", () => {
    expect(xml.measures[0].len).toBe(1);
    expect(xml.measures[0].number).toBe("0");
  });
  it("a MIDI tune starting on beat 4 gets a one-beat bar 0", () => {
    const u8 = new Uint8Array(fixture("pickup.mid"));
    const s = finish(parseMIDI(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)));
    expect(s.measures[0]).toMatchObject({ len: 1, pickup: true, number: "0", pickupCut: 3 });
    expect(evs(s, 0).map((e) => [e.t, nm(e.notes[0])])).toEqual([[0, "G"]]);
    expect(s.measures[1].number).toBe("1");
    expect(evs(s, 1).map((e) => nm(e.notes[0]))).toEqual(["C", "C", "G", "G"]);
  });
  it("a MIDI tune starting on beat 1 is left alone", () => {
    const u8 = new Uint8Array(fixture("waltz.mid"));
    const s = finish(parseMIDI(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)));
    expect(s.measures[0].pickup).toBeUndefined();
    expect(s.measures[0].number).toBe("1");
  });
});
