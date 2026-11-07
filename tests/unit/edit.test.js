import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMusicXML } from "../../src/parse/musicxml.js";
import { finish } from "../../src/score/finish.js";
import { addAfter, changePitch, lengthName, move, remove, resize, spell } from "../../src/score/edit.js";
import { toMusicXML } from "../../src/export/musicxml.js";

const here = dirname(fileURLToPath(import.meta.url));
const open = (slug) => finish(parseMusicXML(readFileSync(join(here, "../../src/examples/library", `${slug}.musicxml`), "utf8")));
const pick = (s, mi, k) => { const rid = s.rows[0].id, ev = s.measures[mi].rows[rid].filter((e) => !e.rest)[k]; return { mi, rid, ev, note: ev.notes[0] }; };
const bar = (s, mi) => s.measures[mi].rows[s.rows[0].id].map((e) => (e.rest ? `r${e.d}` : `${e.notes[0].step}${e.notes[0].alter > 0 ? "#" : e.notes[0].alter < 0 ? "b" : ""}${e.notes[0].octave}@${e.t}/${e.d}`)).join(" ");

describe("fixing notes", () => {
  it("spells notes the way the key does", () => {
    expect(spell(61, 2)).toMatchObject({ step: "C", alter: 1, octave: 4 });
    expect(spell(61, -3)).toMatchObject({ step: "D", alter: -1, octave: 4 });
    expect(spell(71, 0)).toMatchObject({ step: "B", alter: 0, octave: 4 });
    expect(spell(72, 0)).toMatchObject({ step: "C", alter: 0, octave: 5 });
  });
  it("higher, lower and by octaves", () => {
    const s = open("mary-had-a-little-lamb"), sel = pick(s, 0, 0); // E4
    expect(changePitch(s, sel, 1).ok).toBe(true);
    expect(bar(s, 0)).toMatch(/^F4@0/);
    changePitch(s, sel, 12);
    expect(bar(s, 0)).toMatch(/^F5@0/);
    changePitch(s, sel, -14);
    expect(bar(s, 0)).toMatch(/^D#4@0/);
    expect(changePitch(s, sel, -60).ok).toBe(false);
  });
  it("earlier and later, but not through other notes or out of the bar", () => {
    const s = open("mary-had-a-little-lamb"), sel = pick(s, 0, 0);
    expect(move(s, sel, -0.25).ok).toBe(false); // already at the start
    expect(move(s, sel, 0.25).ok).toBe(false); // the next note is right there
    const last = pick(s, 1, 2); // the half note "lamb" at beat 3
    expect(move(s, last, 0.25).ok).toBe(false); // it lasts to the end of the bar
    resize(s, last, -1); resize(s, last, -1); // a half note -> dotted quarter -> quarter
    expect(move(s, last, 0.25).ok).toBe(true);
    expect(bar(s, 1)).toBe("E4@0/1 E4@1/1 E4@2.25/1 r0.75");
  });
  it("shorter leaves a rest, longer can't run into the next note", () => {
    const s = open("mary-had-a-little-lamb"), sel = pick(s, 1, 2); // half note at beat 3 (bar 2)
    expect(resize(s, sel, 1).ok).toBe(false);
    resize(s, sel, -1); resize(s, sel, -1);
    expect(bar(s, 1)).toBe("E4@0/1 E4@1/1 E4@2/1 r1");
    expect(lengthName(sel.ev.d)).toBe("quarter note");
    const first = pick(s, 1, 0);
    expect(resize(s, first, 1).ok).toBe(false);
    resize(s, first, -1); resize(s, first, -1); resize(s, first, -1);
    expect(first.ev.d).toBe(0.25);
    expect(resize(s, first, -1).ok).toBe(false);
  });
  it("delete and add after", () => {
    const s = open("mary-had-a-little-lamb");
    remove(s, pick(s, 0, 1));
    expect(bar(s, 0)).toBe("E4@0/1 r1 C4@2/1 D4@3/1");
    const res = addAfter(s, pick(s, 0, 0));
    expect(res.ok).toBe(true);
    expect(bar(s, 0)).toBe("E4@0/1 E4@1/1 C4@2/1 D4@3/1");
    expect(addAfter(s, pick(s, 0, 3)).ok).toBe(false); // end of the bar
  });
  it("the changes save", () => {
    const s = open("mary-had-a-little-lamb");
    changePitch(s, pick(s, 0, 0), 2);
    const again = finish(parseMusicXML(toMusicXML(s)));
    expect(bar(again, 0)).toMatch(/^F#4@0/);
  });
});
