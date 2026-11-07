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
    dict(slug="twinkle", level="First songs", title="Twinkle, Twinkle, Little Star", composer="Traditional", fifths=0, time=(4, 4), tempo=100, source="example"),
    dict(slug="mary-had-a-little-lamb", level="First songs", title="Mary Had a Little Lamb", composer="Lowell Mason (1830)", fifths=0, time=(4, 4), tempo=110, bars=[
        "[C] E4/q:Ma- D4/q:ry C4/q:had D4/q:a", "[C] E4/q:lit- E4/q:tle E4/h:lamb,", "[G] D4/q:lit- D4/q:tle D4/h:lamb,", "[C] E4/q:lit- G4/q:tle G4/h:lamb,",
        "[C] E4/q:Ma- D4/q:ry C4/q:had D4/q:a", "[C] E4/q:lit- E4/q:tle E4/q:lamb, E4/q:its", "[G] D4/q:fleece D4/q:was E4/q:white D4/q:as", "[C] C4/w:snow.",
    ]),
    dict(slug="frere-jacques", level="Folk songs", title="Frère Jacques (Are You Sleeping?)", composer="Traditional", fifths=0, time=(4, 4), tempo=104, bars=[
        "[C] C4/q:Are D4/q:you E4/q:sleep- C4/q:ing,", "[C] C4/q:are D4/q:you E4/q:sleep- C4/q:ing,", "[C] E4/q:Bro- F4/q:ther G4/h:John,", "[C] E4/q:Bro- F4/q:ther G4/h:John?",
        "[C] G4/e:Morn- A4/e:ing G4/e:bells F4/e:are E4/q:ring- C4/q:ing,", "[C] G4/e:morn- A4/e:ing G4/e:bells F4/e:are E4/q:ring- C4/q:ing.",
        "[C] C4/q:Ding, [G7] G3/q:dang, [C] C4/h:dong.", "[C] C4/q:Ding, [G7] G3/q:dang, [C] C4/h:dong.",
    ]),
    dict(slug="row-row-row-your-boat", level="First songs", title="Row, Row, Row Your Boat", composer="Traditional (1852)", fifths=0, time=(6, 8), tempo=72, tempo_unit="q.", bars=[
        "[C] C4/q.:Row, C4/q.:row,", "[C] C4/q:row D4/e:your E4/q.:boat", "[C] E4/q:gent- D4/e:ly E4/q:down F4/e:the", "[C] G4/h.:stream.",
        "[C] C5/e:Mer- C5/e:ri- C5/e:ly, G4/e:mer- G4/e:ri- G4/e:ly,", "[C] E4/e:mer- E4/e:ri- E4/e:ly, C4/e:mer- C4/e:ri- C4/e:ly,",
        "[G7] G4/q:life F4/e:is E4/q:but D4/e:a", "[C] C4/h.:dream.",
    ]),
    dict(slug="ode-to-joy", level="Classical", title="Ode to Joy", composer="Ludwig van Beethoven (1824)", fifths=0, time=(4, 4), tempo=108, bars=[
        "[C] E4/q E4/q F4/q G4/q", "[G] G4/q F4/q E4/q D4/q", "[C] C4/q C4/q D4/q E4/q", "[C] E4/q. [G] D4/e D4/h",
        "[C] E4/q E4/q F4/q G4/q", "[G] G4/q F4/q E4/q D4/q", "[C] C4/q C4/q D4/q E4/q", "[G] D4/q. [C] C4/e C4/h",
        "[G] D4/q D4/q E4/q C4/q", "[G] D4/q E4/e F4/e [C] E4/q C4/q", "[G] D4/q E4/e F4/e E4/q D4/q", "[C] C4/q D4/q [G] G3/h",
        "[C] E4/q E4/q F4/q G4/q", "[G] G4/q F4/q E4/q D4/q", "[C] C4/q C4/q D4/q E4/q", "[G] D4/q. [C] C4/e C4/h",
    ]),
    dict(slug="jingle-bells", level="Holidays", title="Jingle Bells (chorus)", composer="James Lord Pierpont (1857)", fifths=0, time=(4, 4), tempo=120, bars=[
        "[C] E4/q:Jin- E4/q:gle E4/h:bells,", "[C] E4/q:jin- E4/q:gle E4/h:bells,", "[C] E4/q:jin- G4/q:gle C4/q.:all D4/e:the", "[C] E4/w:way.",
        "[F] F4/q:Oh F4/q:what F4/q.:fun F4/e:it", "[C] F4/q:is E4/q:to E4/q:ride E4/e:in E4/e:a", "[D7] E4/q:one- D4/q:horse D4/q:o- E4/q:pen", "[G7] D4/h:sleigh, G4/h:hey!",
        "[C] E4/q:Jin- E4/q:gle E4/h:bells,", "[C] E4/q:jin- E4/q:gle E4/h:bells,", "[C] E4/q:jin- G4/q:gle C4/q.:all D4/e:the", "[C] E4/w:way.",
        "[F] F4/q:Oh F4/q:what F4/q:fun F4/q:it", "[C] F4/q:is E4/q:to E4/q:ride E4/e:in E4/e:a", "[G7] G4/q:one- G4/q:horse F4/q:o- D4/q:pen", "[C] C4/w:sleigh.",
    ]),
    dict(slug="happy-birthday", level="First songs", title="Happy Birthday to You", composer="Mildred J. Hill & Patty Smith Hill", fifths=0, time=(3, 4), tempo=96, bars=[
        "pickup G4/e.:Hap- G4/s:py",
        "[C] A4/q:birth- G4/q:day C5/q:to", "[G7] B4/h:you, G4/e.:hap- G4/s:py", "[G7] A4/q:birth- G4/q:day D5/q:to", "[C] C5/h:you, G4/e.:hap- G4/s:py",
        "[C7] G5/q:birth- E5/q:day C5/q:dear", "[F] B4/q:friend, A4/q F5/e.:hap- F5/s:py", "[C] E5/q:birth- C5/q:day [G7] D5/q:to", "[C] C5/h.:you!",
    ]),
    dict(slug="fur-elise", level="Classical", title="Für Elise (opening)", composer="Ludwig van Beethoven (1810)", fifths=0, mode="minor", time=(3, 8), tempo=60, tempo_unit="q.", bars=[
        "pickup E5/s D#5/s",
        "E5/s D#5/s E5/s B4/s D5/s C5/s", "[Am] A4/e r/s C4/s E4/s A4/s", "[E] B4/e r/s E4/s G#4/s B4/s", "[Am] C5/e r/s E4/s E5/s D#5/s",
        "E5/s D#5/s E5/s B4/s D5/s C5/s", "[Am] A4/e r/s C4/s E4/s A4/s", "[E] B4/e r/s E4/s C5/s B4/s", "[Am] A4/q.",
    ]),

    # ---- first songs ----
    dict(slug="hot-cross-buns", level="First songs", title="Hot Cross Buns", composer="Traditional", fifths=0, time=(4, 4), tempo=100, bars=[
        "[C] E4/q:Hot D4/q:cross C4/h:buns!", "[C] E4/q:Hot D4/q:cross C4/h:buns!",
        "[C] C4/e:One C4/e:a C4/e:pen- C4/e:ny, [G7] D4/e:two D4/e:a D4/e:pen- D4/e:ny,", "[G7] E4/q:hot D4/q:cross [C] C4/h:buns!",
        "[C] E4/q:Hot D4/q:cross C4/h:buns!", "[C] E4/q:Hot D4/q:cross C4/h:buns!",
        "[C] C4/e:One C4/e:a C4/e:pen- C4/e:ny, [G7] D4/e:two D4/e:a D4/e:pen- D4/e:ny,", "[G7] E4/q:hot D4/q:cross [C] C4/h:buns!",
    ]),
    dict(slug="old-macdonald", level="First songs", title="Old MacDonald Had a Farm", composer="Traditional", fifths=0, time=(4, 4), tempo=116, bars=[
        "[C] C4/q:Old C4/q:Mac- C4/q:Don- G3/q:ald", "[F] A3/q:had A3/q:a [C] G3/h:farm,", "[C] E4/q:E- E4/q:I [G7] D4/q:E- D4/q:I", "[C] C4/h.:O, G3/q:and",
        "[C] C4/q:on C4/q:that C4/q:farm G3/q:he", "[F] A3/q:had A3/q:a [C] G3/h:cow,", "[C] E4/q:E- E4/q:I [G7] D4/q:E- D4/q:I", "[C] C4/w:O.",
    ]),
    # ---- folk songs ----
    dict(slug="london-bridge", level="Folk songs", title="London Bridge Is Falling Down", composer="Traditional", fifths=0, time=(4, 4), tempo=112, bars=[
        "[C] G4/q.:Lon- A4/e:don G4/q:Bridge F4/q:is", "[C] E4/q:fall- F4/q:ing G4/h:down,", "[G7] D4/q:fall- E4/q:ing F4/h:down,", "[C] E4/q:fall- F4/q:ing G4/h:down,",
        "[C] G4/q.:Lon- A4/e:don G4/q:Bridge F4/q:is", "[C] E4/q:fall- F4/q:ing G4/h:down,", "[G7] D4/h:my G4/h:fair", "[C] E4/q:la- C4/h.:dy.",
    ]),
    dict(slug="yankee-doodle", level="Folk songs", title="Yankee Doodle", composer="Traditional (1700s)", fifths=0, time=(4, 4), tempo=120, bars=[
        "[C] C4/q:Yan- C4/q:kee D4/q:Doo- E4/q:dle", "[C] C4/q:went E4/q:to [G7] D4/q:town, G3/q:a-", "[C] C4/q:rid- C4/q:ing D4/q:on E4/q:a", "[C] C4/h:po- [G7] B3/h:ny,",
        "[C] C4/q:Stuck C4/q:a D4/q:fea- E4/q:ther", "[F] F4/q:in E4/q:his [C] D4/q:cap C4/q:and", "[G7] B3/q:called G3/q:it A3/q:ma- B3/q:ca-", "[C] C4/h:ro- C4/h:ni.",
    ]),
    dict(slug="au-clair-de-la-lune", level="Folk songs", title="Au clair de la lune", composer="Traditional French", fifths=0, time=(4, 4), tempo=100, bars=[
        "[C] C4/q:Au C4/q:clair C4/q:de D4/q:la", "[C] E4/h:lu- [G] D4/h:ne,", "[C] C4/q:mon E4/q:a- [G] D4/q:mi D4/q:Pier-", "[C] C4/w:rot,",
        "[C] C4/q:prê- C4/q:te- C4/q:moi D4/q:ta", "[C] E4/h:plu- [G] D4/h:me", "[C] C4/q:pour E4/q:é- [G] D4/q:crire D4/q:un", "[C] C4/w:mot.",
        "[G] D4/q:Ma D4/q:chan- D4/q:del- D4/q:le", "[Am] A3/h:est A3/h:morte,", "[G] D4/q:je C4/q:n'ai B3/q:plus A3/q:de", "[G] G3/w:feu,",
        "[C] C4/q:ou- C4/q:vre- C4/q:moi D4/q:ta", "[C] E4/h:por- [G] D4/h:te", "[C] C4/q:pour E4/q:l'a- [G] D4/q:mour D4/q:de", "[C] C4/w:Dieu.",
    ]),
    dict(slug="lightly-row", level="Folk songs", title="Lightly Row (Hänschen klein)", composer="Traditional German", fifths=0, time=(4, 4), tempo=112, bars=[
        "[C] G4/q E4/q E4/h", "[G7] F4/q D4/q D4/h", "[C] C4/q D4/q E4/q F4/q", "[C] G4/q G4/q G4/h",
        "[C] G4/q E4/q E4/h", "[G7] F4/q D4/q D4/h", "[C] C4/q E4/q G4/q G4/q", "[C] C4/w",
        "[G7] D4/q D4/q D4/q D4/q", "[G7] D4/q E4/q F4/h", "[C] E4/q E4/q E4/q E4/q", "[C] E4/q F4/q G4/h",
        "[C] G4/q E4/q E4/h", "[G7] F4/q D4/q D4/h", "[C] C4/q E4/q G4/q G4/q", "[C] C4/w",
    ]),
    dict(slug="greensleeves", level="Folk songs", title="Greensleeves", composer="Traditional English (1500s)", fifths=0, mode="minor", time=(3, 4), tempo=96, bars=[
        "pickup A4/q",
        "[Am] C5/h D5/q", "[G] E5/q. F5/e E5/q", "[G] D5/h B4/q", "[Em] G4/q. A4/e B4/q",
        "[Am] C5/h A4/q", "[Am] A4/q. G#4/e A4/q", "[E] B4/h G#4/q", "[E] E4/h A4/q",
        "[Am] C5/h D5/q", "[C] E5/q. F5/e E5/q", "[G] D5/h B4/q", "[Em] G4/q. A4/e B4/q",
        "[Am] C5/q. B4/e A4/q", "[E] G#4/q. F#4/e G#4/q", "[Am] A4/h.", "[Am] A4/h.",
    ]),
    # ---- holidays ----
    dict(slug="silent-night", level="Holidays", title="Silent Night", composer="Franz Xaver Gruber (1818)", fifths=0, time=(3, 4), tempo=88, bars=[
        "[C] G4/q.:Si- A4/e G4/q:lent", "[C] E4/h.:night,", "[C] G4/q.:ho- A4/e G4/q:ly", "[C] E4/h.:night,",
        "[G] D5/h:All D5/q:is", "[G] B4/h.:calm,", "[C] C5/h:all C5/q:is", "[C] G4/h.:bright,",
        "[F] A4/h:Round A4/q:yon", "[C] C5/q.:vir- B4/e A4/q:gin", "[C] G4/q.:mo- A4/e:ther G4/q:and", "[C] E4/h.:child,",
        "[F] A4/h:Ho- A4/q:ly", "[C] C5/q.:in- B4/e:fant A4/q:so", "[C] G4/q.:ten- A4/e:der G4/q:and", "[C] E4/h.:mild,",
        "[G] D5/h:Sleep D5/q:in", "[G7] F5/q.:hea- D5/e:ven- B4/q:ly", "[C] C5/h.:peace,", "[C] E5/h.:sleep",
        "[C] C5/q.:in G4/e:hea- E4/q:ven-", "[G7] G4/q.:ly F4/e D4/q", "[C] C4/h.:peace.",
    ]),
    dict(slug="we-wish-you-a-merry-christmas", level="Holidays", title="We Wish You a Merry Christmas", composer="Traditional English", fifths=0, time=(3, 4), tempo=120, bars=[
        "pickup G3/q:We",
        "[C] C4/q:wish C4/e:you D4/e:a C4/e:mer- B3/e:ry", "[F] A3/q:Christ- A3/q:mas, A3/q:we", "[D7] D4/q:wish D4/e:you E4/e:a D4/e:mer- C4/e:ry", "[G] B3/q:Christ- G3/q:mas, G3/q:we",
        "[E7] E4/q:wish E4/e:you F4/e:a E4/e:mer- D4/e:ry", "[Am] C4/q:Christ- A3/q:mas, G3/e:and G3/e:a", "[F] A3/q:hap- [G7] D4/q:py B3/q:New", "[C] C4/h.:Year!",
    ]),
    dict(slug="good-king-wenceslas", level="Holidays", title="Good King Wenceslas", composer="Melody from Piae Cantiones (1582)", fifths=0, time=(4, 4), tempo=104, bars=[
        "[C] C4/q:Good C4/q:King C4/q:Wen- D4/q:ces-", "[C] C4/q:las C4/q:looked [G] G3/h:out", "[Am] A3/q:on G3/q:the A3/q:Feast B3/q:of", "[C] C4/h:Ste- C4/h:phen,",
        "[C] C4/q:When C4/q:the C4/q:snow D4/q:lay", "[C] C4/q:round C4/q:a- [G] G3/h:bout,", "[Am] A3/q:deep G3/q:and A3/q:crisp B3/q:and", "[C] C4/h:e- C4/h:ven;",
        "[C] G4/q:Bright- F4/q:ly E4/q:shone D4/q:the", "[C] E4/q:moon D4/q:that C4/h:night,", "[Am] A3/q:though G3/q:the A3/q:frost B3/q:was", "[C] C4/h:cru- C4/h:el,",
        "[C] G3/q:When G3/q:a A3/q:poor B3/q:man", "[C] C4/q:came C4/q:in [G] D4/h:sight,", "[C] G4/q:gath- F4/q:'ring E4/q:win- D4/q:ter", "[C] C4/h:fu- [F] F4/h", "[C] C4/w:el.",
    ]),
    dict(slug="deck-the-halls", level="Holidays", title="Deck the Halls (opening)", composer="Traditional Welsh", fifths=0, time=(4, 4), tempo=116, bars=[
        "[C] G4/q.:Deck F4/e:the E4/q:halls D4/q:with", "[C] C4/q:boughs D4/q:of E4/q:hol- C4/q:ly,", "[G7] D4/e:Fa E4/e:la F4/e:la D4/e:la E4/q.:la D4/e:la", "[C] C4/q:la [G7] B3/q:la [C] C4/h:la.",
        "[C] G4/q.:'Tis F4/e:the E4/q:sea- D4/q:son", "[C] C4/q:to D4/q:be E4/q:jol- C4/q:ly,", "[G7] D4/e:Fa E4/e:la F4/e:la D4/e:la E4/q.:la D4/e:la", "[C] C4/q:la [G7] B3/q:la [C] C4/h:la.",
    ]),
    # ---- classical ----
    dict(slug="minuet-in-g", level="Classical", title="Minuet in G", composer="Christian Petzold (c. 1725), long credited to J. S. Bach", fifths=1, time=(3, 4), tempo=112, bars=[
        "[G] D5/q G4/e A4/e B4/e C5/e", "[G] D5/q G4/q G4/q", "[C] E5/q C5/e D5/e E5/e F#5/e", "[G] G5/q G4/q G4/q",
        "[C] C5/q D5/e C5/e B4/e A4/e", "[G] B4/q C5/e B4/e A4/e G4/e", "[D] F#4/q G4/e A4/e B4/e G4/e", "[D] A4/h.",
        "[G] D5/q G4/e A4/e B4/e C5/e", "[G] D5/q G4/q G4/q", "[C] E5/q C5/e D5/e E5/e F#5/e", "[G] G5/q G4/q G4/q",
        "[C] C5/q D5/e C5/e B4/e A4/e", "[G] B4/q C5/e B4/e A4/e G4/e", "[D7] A4/q B4/e A4/e G4/e F#4/e", "[G] G4/h.",
    ]),
    dict(slug="canon-in-d", level="Classical", title="Canon in D (the famous line)", composer="Johann Pachelbel (c. 1690)", fifths=2, time=(4, 4), tempo=66, bars=[
        "[D] F#5/h [A] E5/h", "[Bm] D5/h [F#m] C#5/h", "[G] B4/h [D] A4/h", "[G] B4/h [A] C#5/h",
        "[D] D5/h [A] C#5/h", "[Bm] B4/h [F#m] A4/h", "[G] G4/h [D] F#4/h", "[G] G4/h [A] E4/h",
    ]),
    dict(slug="hall-of-the-mountain-king", level="Classical", title="In the Hall of the Mountain King (opening)", composer="Edvard Grieg (1875)", fifths=0, mode="minor", time=(4, 4), tempo=112, bars=[
        "[Am] A3/e B3/e C4/e D4/e E4/e C4/e E4/q", "[E] D#4/e B3/e D#4/q D4/e Bb3/e D4/q", "[Am] A3/e B3/e C4/e D4/e E4/e C4/e E4/e A4/e", "[Am] G4/e E4/e C4/e E4/e G4/h",
        "[Am] A3/e B3/e C4/e D4/e E4/e C4/e E4/q", "[E] D#4/e B3/e D#4/q D4/e Bb3/e D4/q", "[Am] A3/e B3/e C4/e D4/e E4/e C4/e E4/e A4/e", "[Am] G4/e E4/e C4/e E4/e G4/h",
    ]),
    dict(slug="prelude-in-c", level="Classical", title="Prelude in C (opening)", composer="J. S. Bach (1722)", fifths=0, time=(4, 4), tempo=66, bars=[
        " ".join(f"{c} " + " ".join(f"{p}/s" for p in (n[:5] + n[2:5]) * 2) for c, n in [(c, n.split())]) for c, n in [
            ("[C]", "C4 E4 G4 C5 E5"), ("[Dm7]", "C4 D4 A4 D5 F5"), ("[G7]", "B3 D4 G4 D5 F5"), ("[C]", "C4 E4 G4 C5 E5"),
            ("[Am]", "C4 E4 A4 E5 A5"), ("[D7]", "C4 D4 F#4 A4 D5"), ("[G]", "B3 D4 G4 D5 G5"), ("[Cmaj7]", "B3 C4 E4 G4 C5"),
        ]
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
        index.append({"slug": song["slug"], "level": song.get("level", "More songs"), "title": song["title"], "composer": song["composer"], "time": f"{beats}/{bt}"})
    json.dump(index, open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(index)} songs, every bar adds up")

if __name__ == "__main__":
    main()
