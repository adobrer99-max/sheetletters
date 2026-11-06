import { describe, it, expect } from "vitest";
import { nameText, chordText } from "../../src/score/names.js";

const n = (step, alter = 0) => ({ step, alter });
const scale = (naming, fifths, minor, notes) => notes.map(([s, a]) => nameText(n(s, a), naming, fifths, minor)).join(" ");

describe("note names", () => {
  it("letters", () => expect(scale("letters", 0, false, [["C"], ["F", 1], ["B", -1]])).toBe("C F♯ B♭"));
  it("fixed Do: C is always Do", () => {
    expect(scale("fixed", 0, false, [["C"], ["D"], ["E"], ["F"], ["G"], ["A"], ["B"]])).toBe("Do Re Mi Fa Sol La Si");
    expect(scale("fixed", 2, false, [["D"], ["F", 1]])).toBe("Re Fa♯");
  });
  it("movable Do: the key's home note is Do", () => {
    // D major: D E F# G A B C#
    expect(scale("movable", 2, false, [["D"], ["E"], ["F", 1], ["G"], ["A"], ["B"], ["C", 1]])).toBe("Do Re Mi Fa Sol La Ti");
    // B flat major
    expect(scale("movable", -2, false, [["B", -1], ["E", -1], ["F"]])).toBe("Do Fa Sol");
    // chromatic notes in C: F# is Fi, B flat is Te, E flat is Me
    expect(scale("movable", 0, false, [["F", 1], ["B", -1], ["E", -1], ["G", 1]])).toBe("Fi Te Me Si");
  });
  it("movable Do in minor starts on La", () => {
    expect(scale("movable", 0, true, [["A"], ["B"], ["C"], ["G", 1]])).toBe("La Ti Do Si");
  });
  it("numbers count from the home note, minor keys included", () => {
    expect(scale("numbers", 0, false, [["C"], ["E"], ["G"], ["B", -1]])).toBe("1 3 5 ♭7");
    expect(scale("numbers", 0, true, [["A"], ["C"], ["E"], ["G", 1]])).toBe("1 ♭3 5 7");
    expect(scale("numbers", -3, true, [["C"], ["E", -1], ["G"]])).toBe("1 ♭3 5"); // C minor
    expect(scale("numbers", 1, false, [["G"], ["F", 1], ["C", 1]])).toBe("1 7 ♯4");
  });
  it("chord names get Do-Re-Mi roots only with fixed Do", () => {
    const c = { root: n("D"), suffix: "m", bass: null, label: "Dm" };
    expect(chordText(c, "letters")).toBe("Dm");
    expect(chordText(c, "fixed")).toBe("Re m");
    expect(chordText({ root: n("G"), suffix: "7", bass: n("B"), label: "G7/B" }, "fixed")).toBe("Sol7/Si");
    expect(chordText(c, "movable")).toBe("Dm");
  });
});
