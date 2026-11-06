import { chordLabel, harmonyChord } from "../score/harmony.js";
import { $, EPS, STEP_SEMI, addNote, midiOf } from "../util.js";

/* ---------- MusicXML ---------- */
function parseMusicXML(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("This file couldn't be read as MusicXML. If it came from a scan, open it in MuseScore and export it again.");
  const root = doc.documentElement;
  if (root.nodeName === "score-timewise") throw new Error("This MusicXML file uses the rare 'timewise' layout. Open it in MuseScore and export it again; the export will be in the usual layout.");
  if (root.nodeName !== "score-partwise") throw new Error("This doesn't look like a MusicXML score.");
  const txt = (el, sel) => el.querySelector(sel)?.textContent.trim() || "";
  const num = (el, sel, def = 0) => { const s = txt(el, sel); return s === "" ? def : parseFloat(s); };

  const title = txt(root, "work > work-title") || txt(root, "movement-title") || "";
  const composer = txt(root, 'identification > creator[type="composer"]');
  const partNames = {};
  for (const sp of root.querySelectorAll("part-list > score-part")) {
    partNames[sp.getAttribute("id")] = txt(sp, "part-name") || txt(sp, "part-abbreviation") || "Part";
  }
  const rows = [], rowById = {};
  const measures = [];
  let firstPart = true, statedMode = null, tempo = null, curEnding = null;

  for (const part of root.querySelectorAll(":scope > part")) {
    const pid = part.getAttribute("id");
    const pname = partNames[pid] || `Part ${Object.keys(rowById).length + 1}`;
    let divisions = 1, staves = 1, beats = 4, beatType = 4;
    const clefs = {};
    const rowFor = (staff) => {
      const id = staves > 1 ? `${pid}:${staff}` : pid;
      if (!rowById[id]) {
        const clef = clefs[staff];
        const which = staves > 1 ? (clef === "G" ? "treble" : clef === "F" ? "bass" : `staff ${staff}`) : "";
        rowById[id] = { id, name: which ? `${pname} · ${which}` : pname };
        rows.push(rowById[id]);
      }
      return rowById[id].id;
    };
    [...part.querySelectorAll(":scope > measure")].forEach((mEl, idx) => {
      const m = measures[idx] || (measures[idx] = { number: mEl.getAttribute("number") || String(idx + 1), len: 0, timeLen: 4, rows: {} });
      let pos = 0, maxPos = 0, lastOnset = 0;
      for (const el of mEl.children) {
        switch (el.nodeName) {
          case "attributes": {
            if (el.querySelector("divisions")) divisions = num(el, "divisions", 1) || 1;
            if (el.querySelector("staves")) staves = num(el, "staves", 1);
            for (const c of el.querySelectorAll("clef")) clefs[c.getAttribute("number") || "1"] = txt(c, "sign");
            if (firstPart && el.querySelector("key > fifths")) {
              m.key = num(el, "key > fifths");
              const mode = txt(el, "key > mode").toLowerCase();
              if (mode === "major" || mode === "minor") { m.mode = mode; if (!statedMode) statedMode = mode; }
            }
            if (el.querySelector("time > beats")) {
              beats = parseFloat(txt(el, "time > beats").split("+").reduce((a, b) => +a + +b, 0)) || 4;
              beatType = num(el, "time > beat-type", 4);
              if (firstPart) m.time = `${beats}/${beatType}`;
            }
            break;
          }
          case "note": {
            // one pass over the note's children: notes are most of a file, and repeated selector
            // lookups on each one were the slowest part of opening a big score
            let grace = false, isChord = false, durTxt = "", rest = false, pitch = null, held = false, staffTxt = "", ly = null;
            for (const c of el.children) {
              switch (c.nodeName) {
                case "grace": case "cue": grace = true; break;
                case "chord": isChord = true; break;
                case "duration": durTxt = c.textContent.trim(); break;
                case "rest": rest = true; break;
                case "pitch": pitch = c; break;
                case "tie": if (c.getAttribute("type") === "stop") held = true; break;
                case "notations": for (const t of c.children) if (t.nodeName === "tied" && t.getAttribute("type") === "stop") held = true; break;
                case "staff": staffTxt = c.textContent.trim(); break;
                case "lyric": if (!ly) ly = c; break;
              }
            }
            if (grace) break;
            const dur = (durTxt === "" ? 0 : parseFloat(durTxt)) / divisions;
            const onset = isChord ? lastOnset : pos;
            if (!isChord) { lastOnset = pos; pos += dur; }
            maxPos = Math.max(maxPos, onset + dur);
            if (rest || !pitch) break;
            let step = "", alterTxt = "", octTxt = "";
            for (const c of pitch.children) {
              if (c.nodeName === "step") step = c.textContent.trim().toUpperCase();
              else if (c.nodeName === "alter") alterTxt = c.textContent.trim();
              else if (c.nodeName === "octave") octTxt = c.textContent.trim();
            }
            if (!(step in STEP_SEMI)) break;
            const alter = Math.round(alterTxt === "" ? 0 : parseFloat(alterTxt)), octave = octTxt === "" ? 4 : parseFloat(octTxt);
            const rid = rowFor((staffTxt === "" ? 1 : parseFloat(staffTxt)) || 1);
            const events = m.rows[rid] || (m.rows[rid] = []);
            const ev = addNote(events, onset, dur, { step, alter, octave, midi: midiOf(step, alter, octave), held });
            if (ly && !ev.lyric) {
              let text = "", syl = "";
              for (const c of ly.children) { if (c.nodeName === "text" && !text) text = c.textContent.trim(); else if (c.nodeName === "syllabic" && !syl) syl = c.textContent.trim(); }
              if (text) ev.lyric = { text, syllabic: syl || "single" };
            }
            break;
          }
          case "harmony": {
            const chord = harmonyChord(el);
            if (chord) {
              const t = pos + num(el, "offset") / divisions;
              const list = m.harmony || (m.harmony = []);
              if (!list.some((h) => Math.abs(h.t - t) < EPS)) list.push({ t, ...chord, label: chordLabel(chord) });
            }
            break;
          }
          case "backup": pos -= num(el, "duration") / divisions; break;
          case "forward": pos += num(el, "duration") / divisions; maxPos = Math.max(maxPos, pos); break;
          case "direction": case "sound": {
            const snd = el.nodeName === "sound" ? el : el.querySelector("sound");
            const tp = parseFloat(snd?.getAttribute("tempo"));
            if (tempo == null && tp > 0) tempo = tp;
            break;
          }
          case "barline": {
            const repEl = el.querySelector("repeat");
            const rep = repEl?.getAttribute("direction");
            if (rep === "forward") m.repStart = true;
            if (rep === "backward") { m.repEnd = true; const times = parseInt(repEl.getAttribute("times"), 10); if (times > 1) m.repTimes = times; }
            const end = el.querySelector("ending");
            if (end && firstPart) {
              const type = end.getAttribute("type");
              if (type === "start") {
                curEnding = (end.getAttribute("number") || "1").split(/[,\s]+/).map(Number).filter((n) => n > 0);
                m.endNums = curEnding;
              } else if (type === "stop" || type === "discontinue") { if (curEnding) m.endNums = curEnding; curEnding = null; }
            }
            if (end && end.getAttribute("type") === "start") m.ending = end.getAttribute("number");
            if (txt(el, "bar-style") === "light-heavy" && !rep) m.final = true;
            break;
          }
        }
      }
      m.timeLen = beats * 4 / beatType;
      if (firstPart) m.beatType = beatType;
      if (firstPart && curEnding && !m.endNums) m.endNums = curEnding;
      m.len = Math.max(m.len, maxPos);
    });
    firstPart = false;
  }
  for (const m of measures) if (m.len < EPS) m.len = m.timeLen;
  return { title, composer, format: "MusicXML", rows, measures, mode: statedMode, tempo };
}

export { parseMusicXML };
