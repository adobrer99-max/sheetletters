# Sheet Letters

Turn sheet music into note letters you can read at a glance (C, D, E, F♯…), measure by measure, with chord
names, the key and the lyrics underneath. Then hear it on a sampled grand piano, slow it down, loop a few
bars, or transpose it.

**New:** open a **recording** instead, even a full band track, and Sheet Letters finds the melody and writes
it down for you. It all runs in your browser. Your music never leaves your device.

Live at **[adamdobrer.ca/projects/sheet-letters](https://adamdobrer.ca/projects/sheet-letters/)**.

## What it opens

| | |
|---|---|
| **MusicXML** (`.musicxml`, `.xml`, `.mxl`) | From MuseScore, Sibelius, Finale, Dorico, or sites like MuseScore.com and 8notes |
| **MIDI** (`.mid`) | Any MIDI file |
| **Recordings** (`.mp3`, `.wav`, `.m4a`, `.flac`, `.ogg`…) | A solo instrument or voice, or a full song |
| **Spotify / YouTube links** | Finds the song's name and searches sheet-music sites for it |
| **PDFs and photos** | Explains the one extra step (music recognition) they need |

## Song library and links

23 public-domain songs to try, grouped by level: **first songs** (Twinkle, Mary Had a Little Lamb, Hot
Cross Buns, Row Row Row Your Boat, Old MacDonald, Happy Birthday), **folk songs** (Frère Jacques, London
Bridge, Yankee Doodle, Au clair de la lune, Lightly Row, Greensleeves), **holidays** (Jingle Bells, Silent
Night, We Wish You a Merry Christmas, Good King Wenceslas, Deck the Halls) and **classical** (Ode to Joy,
Für Elise, Minuet in G, Canon in D, In the Hall of the Mountain King, Bach's Prelude in C), with chords and,
for the sung ones, lyrics. They're written in a compact shorthand in `tools/songs.py`, which checks every bar
adds up and writes the MusicXML: `python3 tools/songs.py`.

Every library song has a link that opens it as you're seeing it:
`…/app/#song=ode-to-joy&key=2&names=fixed&melody=1` (key in semitones; names = letters, fixed, movable or
numbers; melody=1 for melody only). The address bar always holds it, and **Share link** copies it (or opens
the share sheet on a phone).

## Reading it your way

- **Note names:** letters (C D E), Do Re Mi with C as Do (as in Quebec, France and Latin America), Do Re Mi
  with the key's home note as Do, or scale-step numbers (1 2 3; in minor keys the minor home note is 1).
- **Chord names** over the notes, from the score's chord symbols, worked out from the notes, or heard in a
  recording.
- **Melody only** keeps just the top note of each chord, in every staff shown.
- **Print** gives clean black-on-white pages with whole bars, in whichever names you've chosen.
- **Save MusicXML** or **Save MIDI** downloads what's on screen: in the key shown, melody only if it's on,
  hidden staves left out, at the speed you've set. MusicXML (for MuseScore, Sibelius, Finale, Dorico) keeps
  chords, lyrics, ties, triplets, grace notes and repeats. MIDI (for GarageBand, Logic and the like) keeps the
  notes, speed, key and lyrics, with repeats written out in playing order.

## Fixing notes

**Fix notes** turns on editing: tap any note, then make it higher or lower (or an octave), move it earlier or
later, make it shorter or longer, delete it, or add a note after it. Each change plays the note, and **Undo**
steps back. On a keyboard: ↑ ↓ change the pitch (with Shift, an octave), ← → go to the previous or next note,
Delete removes it, Ctrl/Cmd+Z undoes, Esc lets go. Changes stay through transposing, melody only and playing,
and **Save MusicXML** or **Save MIDI** keeps them. Most useful after opening a recording.

## How a recording becomes letters

```
recording ──► split into drums · bass · other · vocals   (HTDemucs, in a Web Worker, WebGPU or WebAssembly)
          ──► find the beat from the drums and bass      (src/audio/rhythm.js)
          ──► hear the notes in the part you picked      (Basic Pitch, in a Web Worker)
          ──► keep one melody line, put it on the beat   (src/audio/melody.js)
          ──► name the chords and the key                (src/audio/chords.js)
          ──► write it as MIDI and read it like any song (src/parse/midi.js)
```

You choose where the melody is: **vocals**, a **lead instrument** (guitar, keys, synth), the **bass**, or
**a solo recording** (which skips the splitting step). Afterwards you can halve or double the speed, move the
bar lines, switch between 4/4 and 3/4, choose eighth- or sixteenth-note detail, try another part, and listen
to the part on its own. None of that redoes the slow splitting.

**Play along with the recording.** The Sound menu in the player switches between the piano, the recording
itself and (for a split song) the part on its own. The letters follow the beat found in the recording, so
they stay with the band even when it speeds up or slows down. The speed box slows the recording down without
changing its pitch (half to double speed), and looping and starting from any bar work the same as with the
piano. The recording stays in its own key when you transpose the letters.

**What to expect.** A clear lead vocal or solo instrument comes out as a good first draft. Rap, heavy effects
and stacked harmonies come out worse. Rhythm is the hardest part, so check it by ear with the Play button.

**Speed.** The first split downloads a 172 MB model, which the browser keeps. Splitting takes roughly 2–4× the
length of the music on a computer with WebGPU (recent Chrome or Edge), and much longer without it. Phones and
tablets can open solo recordings now; full-song splitting on phones is planned.

## Working on it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (parsing, repeats, transposing, beat finding, melody)
npm run build      # dist/: a static site that works from any folder
npm run test:e2e   # browser tests on desktop and phone sizes (run `npx playwright install chromium` once)
```

```
src/
  main.js            wiring
  parse/             MusicXML, .mxl and MIDI readers
  score/             key and chords, transposing, repeat order, tidying
  render.js          the sheet of letters
  player.js          piano playback, metronome, loops
  links.js           Spotify and YouTube links → sheet-music searches
  recording.js       the "open a recording" panel
  audio/             decoding, song splitting, beat finding, note finding, melody
public/
  piano/             Salamander Grand Piano samples
  models/            the Basic Pitch model
```

The Spotify and YouTube look-ups use a small server route (`/api/spotify`, `/api/youtube`) that adamdobrer.ca
provides. Elsewhere the links still work: you just type the song's name.

## Licences

MIT for Sheet Letters itself. The models, engines, piano samples and fonts it uses have their own (MIT,
Apache 2.0, CC BY 3.0, OFL): see [NOTICE.md](NOTICE.md).
