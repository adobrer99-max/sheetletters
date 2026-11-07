import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMusicXML } from "../../src/parse/musicxml.js";
import { finish } from "../../src/score/finish.js";
import { playOrder } from "../../src/score/order.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../../src/examples/library");
const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
const open = (slug) => finish(parseMusicXML(readFileSync(slug === "twinkle" ? join(here, "../../src/examples/twinkle.musicxml") : join(dir, `${slug}.musicxml`), "utf8")));
const tune = (s) => s.measures.flatMap((m) => (m.rows[s.rows[0].id] || []).filter((e) => !e.rest).map((e) => e.notes[0].step + (e.notes[0].alter > 0 ? "#" : "")));

describe("song library", () => {
  for (const song of index) {
    it(`${song.title} opens with its title, time, tempo and chords`, () => {
      const s = open(song.slug);
      expect(s.title).toBe(song.title);
      expect(s.measures.length).toBeGreaterThanOrEqual(8);
      expect(s.measures.find((m) => m.time)?.time).toBe(song.time);
      if (song.slug !== "twinkle") expect(s.tempo).toBeGreaterThan(0); // the original example has no tempo; the app uses 90
      expect(s.hasChords).toBe(true);
      expect(playOrder(s.measures)).toHaveLength(s.measures.length);
    });
  }
  it("the openings are right", () => {
    expect(tune(open("ode-to-joy")).slice(0, 8).join(" ")).toBe("E E F G G F E D");
    expect(tune(open("happy-birthday")).slice(0, 6).join(" ")).toBe("G G A G C B");
    expect(tune(open("fur-elise")).slice(0, 9).join(" ")).toBe("E D# E D# E B D C A");
    expect(tune(open("jingle-bells")).slice(0, 11).join(" ")).toBe("E E E E E E E G C D E");
  });
  it("pickup bars, minor keys, compound time and lyrics come through", () => {
    const hb = open("happy-birthday"), fe = open("fur-elise"), row = open("row-row-row-your-boat");
    expect(hb.measures[0]).toMatchObject({ number: "0", len: 1 }); // a dotted eighth and a sixteenth
    expect(fe.keyInfo.mode).toBe("minor");
    expect(fe.measures[0].len).toBe(0.5);
    expect(row.measures[0].timeLen).toBe(3);
    expect(Math.round(row.tempo)).toBe(108); // dotted-quarter = 72
    expect(hb.measures[1].rows[hb.rows[0].id][0].lyric.text).toBe("birth");
  });
});
