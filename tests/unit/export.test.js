import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMusicXML } from "../../src/parse/musicxml.js";
import { parseMIDI } from "../../src/parse/midi.js";
import { finish } from "../../src/score/finish.js";
import { transposeScore } from "../../src/score/transpose.js";
import { toMusicXML, noteValues } from "../../src/export/musicxml.js";
import { toMIDI } from "../../src/export/midi.js";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "../../src/examples/library");
const index = JSON.parse(readFileSync(join(lib, "index.json"), "utf8"));
const xmlPath = (slug) => (slug === "twinkle" ? join(here, "../../src/examples/twinkle.musicxml") : join(lib, `${slug}.musicxml`));
const openXML = (text) => finish(parseMusicXML(text));
const openMIDI = (bytes) => finish(parseMIDI(bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes));
const r = (x) => Math.round(x * 1000) / 1000;

// everything a reader sees, measure by measure
function picture(s) {
  return s.measures.map((m) => ({
    len: r(m.len), time: m.timeLen, rep: [!!m.repStart, !!m.repEnd, (m.endNums || []).join()],
    chords: (m.chords || []).map((c) => `${r(c.t)}:${c.label}`),
    rows: s.rows.map((row) => (m.rows[row.id] || []).filter((e) => !e.rest).map((e) => [
      r(e.t), r(e.d), e.notes.map((n) => `${n.midi}${n.held ? "~" : ""}`).sort().join(","),
      e.lyric ? `${e.lyric.text}/${e.lyric.syllabic}` : "", (e.grace || []).map((g) => g.midi).join(","), e.tupStart || 0, !!e.tupEnd,
    ].join(" "))),
  }));
}

// what you hear: [start in quarter notes from the top, midi, length], with tied notes joined up
function sounding(s) {
  const out = [], open = new Map();
  let at = 0;
  for (const m of s.measures) {
    for (const row of s.rows) for (const e of m.rows[row.id] || []) {
      if (e.rest) continue;
      for (const n of e.notes) {
        const key = `${row.id}:${n.midi}`, prev = open.get(key);
        if (n.held && prev && Math.abs(prev[0] + prev[2] - (at + e.t)) < 1e-3) { prev[2] += e.d; continue; }
        const note = [at + e.t, n.midi, e.d];
        out.push(note); open.set(key, note);
      }
    }
    at += m.len;
  }
  // counted from the first note: a MIDI file can't say how long a pickup bar is, so the reader may
  // give a short pickup a little lead-in rest, which moves everything along without changing the tune
  const t0 = Math.min(...out.map((n) => n[0]));
  return out.map((n) => [n[0] - t0, n[1], n[2]].map(r).join(" ")).sort();
}

describe("note values", () => {
  it("splits odd lengths into tied standard ones", () => {
    expect(noteValues(1).map((v) => v.type)).toEqual(["quarter"]);
    expect(noteValues(1.5)).toMatchObject([{ type: "quarter", dot: true }]);
    expect(noteValues(5).map((v) => v.len)).toEqual([4, 1]);
    expect(noteValues(1 / 3)).toMatchObject([{ type: "eighth", triplet: true }]);
    expect(noteValues(2 / 3)).toMatchObject([{ type: "quarter", triplet: true }]);
    expect(noteValues(1.25).map((v) => v.len)).toEqual([1, 0.25]);
  });
});

describe("save as MusicXML", () => {
  const files = [
    ...index.map((s) => [s.title, xmlPath(s.slug)]),
    ["repeats and endings", join(here, "../fixtures/repeat.musicxml")],
    ["grace notes and triplets", join(here, "../fixtures/grace-triplets.musicxml")],
  ];
  for (const [name, path] of files) {
    it(`${name} comes back the same`, () => {
      const a = openXML(readFileSync(path, "utf8"));
      const b = openXML(toMusicXML(a));
      expect(b.title).toBe(a.title);
      expect(b.tempo || 0).toBe(a.tempo || 0);
      expect(b.keyInfo.fifths).toBe(a.keyInfo.fifths);
      expect(b.measures.map((m) => m.time)).toEqual(a.measures.map((m) => m.time));
      expect(picture(b)).toEqual(picture(a));
    });
  }
  it("keeps the key it's shown in", () => {
    const a = transposeScore(openXML(readFileSync(xmlPath("ode-to-joy"), "utf8")), 2);
    const b = openXML(toMusicXML(a));
    expect(b.keyInfo.fifths).toBe(2);
    expect(picture(b)).toEqual(picture(a));
  });
  it("a big score saves and opens", () => {
    const a = openXML(readFileSync(join(here, "../fixtures/big-400-bars.musicxml"), "utf8"));
    const b = openXML(toMusicXML(a));
    expect(b.measures.length).toBe(a.measures.length);
    expect(sounding(b)).toEqual(sounding(a));
  });
  it("MIDI songs save as notation that sounds the same", () => {
    for (const f of ["waltz.mid", "pickup.mid"]) {
      const a = openMIDI(readFileSync(join(here, "../fixtures", f)));
      const b = openXML(toMusicXML(a));
      expect(b.measures.length).toBe(a.measures.length);
      expect(sounding(b)).toEqual(sounding(a));
    }
  });
  it("escapes titles and lyrics", () => {
    const text = toMusicXML(openXML(readFileSync(xmlPath("happy-birthday"), "utf8")));
    expect(text).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
    expect(new DOMParser().parseFromString(text, "application/xml").querySelector("parsererror")).toBeNull();
  });
});

describe("save as MIDI", () => {
  for (const s of index) {
    it(`${s.title} sounds the same`, () => {
      const a = openXML(readFileSync(xmlPath(s.slug), "utf8"));
      const b = openMIDI(toMIDI(a));
      expect(sounding(b)).toEqual(sounding(a));
      expect(b.keyInfo.fifths).toBe(a.keyInfo.fifths);
      expect(b.measures.find((m) => m.time)?.time).toBe(a.measures.find((m) => m.time)?.time);
    });
  }
  it("keeps the lyrics and speed", () => {
    const a = openXML(readFileSync(xmlPath("happy-birthday"), "utf8"));
    const b = openMIDI(toMIDI(a));
    const words = (x) => x.measures.flatMap((m) => Object.values(m.rows).flat().filter((e) => e.lyric).map((e) => e.lyric.text));
    expect(words(b)).toEqual(words(a));
    expect(Math.round(b.tempo)).toBe(Math.round(a.tempo));
  });
  it("plays repeats out in order", () => {
    const a = openXML(readFileSync(join(here, "../fixtures/repeat.musicxml"), "utf8"));
    const b = openMIDI(toMIDI(a, { unroll: true }));
    expect(b.measures.length).toBeGreaterThan(a.measures.length);
  });
  it("a MIDI file saves and opens the same", () => {
    const a = openMIDI(readFileSync(join(here, "../fixtures/waltz.mid")));
    expect(sounding(openMIDI(toMIDI(a)))).toEqual(sounding(a));
  });
});
