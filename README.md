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

Eight public-domain songs to try (Twinkle, Mary Had a Little Lamb, Frère Jacques, Row Row Row Your Boat,
Ode to Joy, Jingle Bells, Happy Birthday, Für Elise), with melody, chords and lyrics. They're written in a
compact shorthand in `tools/songs.py`, which checks every bar adds up and writes the MusicXML:
`python3 tools/songs.py`.

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
