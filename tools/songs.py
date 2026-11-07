#!/usr/bin/env python3
"""The song library: public-domain songs written in a compact shorthand, turned into MusicXML.

    python3 tools/songs.py        # writes src/examples/library/<slug>.musicxml and index.json

Shorthand, one string per bar, tokens separated by spaces:
    E4/q        a note: pitch (C..B, # or b, octave) / length: w h q e s, with "." for dotted
    r/e         a rest
    E4/q:Twin-  a note with a lyric syllable; a trailing "-" means the word carries on
    [C] [G7]    a chord symbol at the next note's position
A bar that starts with "pickup" is a short opening bar. Every other bar must add up to the time
signature exactly: the script stops with an error if one doesn't, which catches rhythm slips.
"""
import json, os, re, sys
import xml.dom.minidom
from xml.sax.saxutils import escape
from fractions import Fraction as F

LEN = {"w": F(4), "h": F(2), "q": F(1), "e": F(1, 2), "s": F(1, 4)}
DIV = 4  # divisions per quarter note
TYPE = {F(4): "whole", F(2): "half", F(1): "quarter", F(1, 2): "eighth", F(1, 4): "16th"}

SONGS = [
    dict(slug="twinkle", title="Twinkle, Twinkle, Little Star", composer="Traditional", fifths=0, time=(4, 4), tempo=100, source="example"),
    dict(slug="mary-had-a-little-lamb", title="Mary Had a Little Lamb", composer="Lowell Mason (1830)", fifths=0, time=(4, 4), tempo=110, bars=[
        "[C] E4/q:Ma- D4/q:ry C4/q:had D4/q:a", "[C] E4/q:lit- E4/q:tle E4/h:lamb,", "[G] D4/q:lit- D4/q:tle D4/h:lamb,", "[C] E4/q:lit- G4/q:tle G4/h:lamb,",
        "[C] E4/q:Ma- D4/q:ry C4/q:had D4/q:a", "[C] E4/q:lit- E4/q:tle E4/q:lamb, E4/q:its", "[G] D4/q:fleece D4/q:was E4/q:white D4/q:as", "[C] C4/w:snow.",
    ]),
    dict(slug="frere-jacques", title="Frère Jacques (Are You Sleeping?)", composer="Traditional", fifths=0, time=(4, 4), tempo=104, bars=[
        "[C] C4/q:Are D4/q:you E4/q:sleep- C4/q:ing,", "[C] C4/q:are D4/q:you E4/q:sleep- C4/q:ing,", "[C] E4/q:Bro- F4/q:ther G4/h:John,", "[C] E4/q:Bro- F4/q:ther G4/h:John?",
        "[C] G4/e:Morn- A4/e:ing G4/e:bells F4/e:are E4/q:ring- C4/q:ing,", "[C] G4/e:morn- A4/e:ing G4/e:bells F4/e:are E4/q:ring- C4/q:ing.",
        "[C] C4/q:Ding, [G7] G3/q:dang, [C] C4/h:dong.", "[C] C4/q:Ding, [G7] G3/q:dang, [C] C4/h:dong.",
    ]),
    dict(slug="row-row-row-your-boat", title="Row, Row, Row Your Boat", composer="Traditional (1852)", fifths=0, time=(6, 8), tempo=72, tempo_unit="q.", bars=[
        "[C] C4/q.:Row, C4/q.:row,", "[C] C4/q:row D4/e:your E4/q.:boat", "[C] E4/q:gent- D4/e:ly E4/q:down F4/e:the", "[C] G4/h.:stream.",
        "[C] C5/e:Mer- C5/e:ri- C5/e:ly, G4/e:mer- G4/e:ri- G4/e:ly,", "[C] E4/e:mer- E4/e:ri- E4/e:ly, C4/e:mer- C4/e:ri- C4/e:ly,",
        "[G7] G4/q:life F4/e:is E4/q:but D4/e:a", "[C] C4/h.:dream.",
    ]),
    dict(slug="ode-to-joy", title="Ode to Joy", composer="Ludwig van Beethoven (1824)", fifths=0, time=(4, 4), tempo=108, bars=[
        "[C] E4/q E4/q F4/q G4/q", "[G] G4/q F4/q E4/q D4/q", "[C] C4/q C4/q D4/q E4/q", "[C] E4/q. [G] D4/e D4/h",
        "[C] E4/q E4/q F4/q G4/q", "[G] G4/q F4/q E4/q D4/q", "[C] C4/q C4/q D4/q E4/q", "[G] D4/q. [C] C4/e C4/h",
        "[G] D4/q D4/q E4/q C4/q", "[G] D4/q E4/e F4/e [C] E4/q C4/q", "[G] D4/q E4/e F4/e E4/q D4/q", "[C] C4/q D4/q [G] G3/h",
        "[C] E4/q E4/q F4/q G4/q", "[G] G4/q F4/q E4/q D4/q", "[C] C4/q C4/q D4/q E4/q", "[G] D4/q. [C] C4/e C4/h",
    ]),
    dict(slug="jingle-bells", title="Jingle Bells (chorus)", composer="James Lord Pierpont (1857)", fifths=0, time=(4, 4), tempo=120, bars=[
        "[C] E4/q:Jin- E4/q:gle E4/h:bells,", "[C] E4/q:jin- E4/q:gle E4/h:bells,", "[C] E4/q:jin- G4/q:gle C4/q.:all D4/e:the", "[C] E4/w:way.",
        "[F] F4/q:Oh F4/q:what F4/q.:fun F4/e:it", "[C] F4/q:is E4/q:to E4/q:ride E4/e:in E4/e:a", "[D7] E4/q:one- D4/q:horse D4/q:o- E4/q:pen", "[G7] D4/h:sleigh, G4/h:hey!",
        "[C] E4/q:Jin- E4/q:gle E4/h:bells,", "[C] E4/q:jin- E4/q:gle E4/h:bells,", "[C] E4/q:jin- G4/q:gle C4/q.:all D4/e:the", "[C] E4/w:way.",
        "[F] F4/q:Oh F4/q:what F4/q:fun F4/q:it", "[C] F4/q:is E4/q:to E4/q:ride E4/e:in E4/e:a", "[G7] G4/q:one- G4/q:horse F4/q:o- D4/q:pen", "[C] C4/w:sleigh.",
    ]),
    dict(slug="happy-birthday", title="Happy Birthday to You", composer="Mildred J. Hill & Patty Smith Hill", fifths=0, time=(3, 4), tempo=96, bars=[
        "pickup G4/e.:Hap- G4/s:py",
        "[C] A4/q:birth- G4/q:day C5/q:to", "[G7] B4/h:you, G4/e.:hap- G4/s:py", "[G7] A4/q:birth- G4/q:day D5/q:to", "[C] C5/h:you, G4/e.:hap- G4/s:py",
        "[C7] G5/q:birth- E5/q:day C5/q:dear", "[F] B4/q:friend, A4/q F5/e.:hap- F5/s:py", "[C] E5/q:birth- C5/q:day [G7] D5/q:to", "[C] C5/h.:you!",
    ]),
    dict(slug="fur-elise", title="Für Elise (opening)", composer="Ludwig van Beethoven (1810)", fifths=0, mode="minor", time=(3, 8), tempo=60, tempo_unit="q.", bars=[
        "pickup E5/s D#5/s",
        "E5/s D#5/s E5/s B4/s D5/s C5/s", "[Am] A4/e r/s C4/s E4/s A4/s", "[E] B4/e r/s E4/s G#4/s B4/s", "[Am] C5/e r/s E4/s E5/s D#5/s",
        "E5/s D#5/s E5/s B4/s D5/s C5/s", "[Am] A4/e r/s C4/s E4/s A4/s", "[E] B4/e r/s E4/s C5/s B4/s", "[Am] A4/q.",
    ]),
]

def pitch(p):
    m = re.fullmatch(r"([A-G])([#b]?)(\d)", p)
    if not m: raise ValueError(f"bad pitch {p!r}")
    return m.group(1), {"#": 1, "b": -1, "": 0}[m.group(2)], int(m.group(3))

def length(s):
    dotted = s.endswith(".")
    base = LEN[s.rstrip(".")]
    return base * F(3, 2) if dotted else base, s.rstrip("."), dotted

def chord_xml(sym):
    m = re.fullmatch(r"([A-G])([#b]?)(m7|m|7|maj7)?", sym)
    root, acc, q = m.group(1), m.group(2), m.group(3) or ""
    kind = {"": "major", "m": "minor", "7": "dominant", "m7": "minor-seventh", "maj7": "major-seventh"}[q]
    alter = f"<root-alter>{ {'#': 1, 'b': -1}[acc] }</root-alter>" if acc else ""
    return f"<harmony><root><root-step>{root}</root-step>{alter}</root><kind>{kind}</kind></harmony>"

def song_xml(song):
    beats, beat_type = song["time"]
    bar_len = F(beats * 4, beat_type)
    out, carry = [], False
    for i, bar in enumerate(song["bars"]):
        toks = bar.split()
        pickup = toks and toks[0] == "pickup"
        if pickup: toks = toks[1:]
        number = "0" if pickup else str(i if song["bars"][0].startswith("pickup") else i + 1)
        parts, total = [], F(0)
        for t in toks:
            if t.startswith("["):
                parts.append(chord_xml(t.strip("[]"))); continue
            body, _, lyric = t.partition(":")
            p, l = body.split("/")
            d, base, dotted = length(l)
            total += d
            dur = int(d * DIV)
            typ = TYPE[LEN[base]] if base in LEN else "quarter"
            dot = "<dot/>" if dotted else ""
            if p == "r":
                parts.append(f"<note><rest/><duration>{dur}</duration><type>{typ}</type>{dot}</note>"); continue
            step, alter, octave = pitch(p)
            a = f"<alter>{alter}</alter>" if alter else ""
            acc = {1: "<accidental>sharp</accidental>", -1: "<accidental>flat</accidental>"}.get(alter, "")
            ly = ""
            if lyric:
                cont = lyric.endswith("-")
                text = lyric.rstrip("-")
                syl = ("middle" if carry else "begin") if cont else ("end" if carry else "single")
                carry = cont
                ly = f"<lyric number=\"1\"><syllabic>{syl}</syllabic><text>{escape(text)}</text></lyric>"
            parts.append(f"<note><pitch><step>{step}</step>{a}<octave>{octave}</octave></pitch><duration>{dur}</duration><type>{typ}</type>{dot}{acc}{ly}</note>")
        if not pickup and total != bar_len:
            sys.exit(f"{song['slug']} bar {number}: adds up to {total} quarter notes, should be {bar_len}")
        attrs = ""
        if i == 0:
            mode = f"<mode>{song.get('mode', 'major')}</mode>"
            unit, dot = {"q": ("quarter", ""), "q.": ("quarter", "<beat-unit-dot/>"), "h": ("half", "")}[song.get("tempo_unit", "q")]
            q_bpm = song["tempo"] * (F(3, 2) if dot else 1)
            attrs = (f"<attributes><divisions>{DIV}</divisions><key><fifths>{song['fifths']}</fifths>{mode}</key>"
                     f"<time><beats>{beats}</beats><beat-type>{beat_type}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>"
                     f"<direction placement=\"above\"><direction-type><metronome><beat-unit>{unit}</beat-unit>{dot}<per-minute>{song['tempo']}</per-minute></metronome></direction-type>"
                     f"<sound tempo=\"{float(q_bpm):g}\"/></direction>")
        final = "<barline location=\"right\"><bar-style>light-heavy</bar-style></barline>" if i == len(song["bars"]) - 1 else ""
        implicit = " implicit=\"yes\"" if pickup else ""
        out.append(f"<measure number=\"{number}\"{implicit}>{attrs}{''.join(parts)}{final}</measure>")
    return ("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<score-partwise version=\"3.1\">"
            f"<work><work-title>{escape(song['title'])}</work-title></work><identification><creator type=\"composer\">{escape(song['composer'])}</creator>"
            "<rights>Public domain</rights></identification>"
            "<part-list><score-part id=\"P1\"><part-name>Melody</part-name></score-part></part-list>"
            f"<part id=\"P1\">{''.join(out)}</part></score-partwise>\n")

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "..", "src", "examples", "library")
    os.makedirs(out_dir, exist_ok=True)
    index = []
    for song in SONGS:
        if song.get("source") != "example":
            text = song_xml(song)
            xml.dom.minidom.parseString(text.encode("utf-8"))  # stops here if the file isn't well-formed XML
            open(os.path.join(out_dir, f"{song['slug']}.musicxml"), "w", encoding="utf-8").write(text)
        beats, bt = song["time"]
        index.append({"slug": song["slug"], "title": song["title"], "composer": song["composer"], "time": f"{beats}/{bt}"})
    json.dump(index, open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(index)} songs, every bar adds up")

if __name__ == "__main__":
    main()
