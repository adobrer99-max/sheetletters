// "Save MusicXML" and "Save MIDI": download what's on screen, in the key it's shown in, with melody
// only applied and hidden staves left out, at the speed the player is set to.

import { toMIDI } from "./export/midi.js";
import { toMusicXML } from "./export/musicxml.js";
import { player } from "./player.js";
import { keyLabel } from "./score/harmony.js";
import { state } from "./state.js";
import { $ } from "./util.js";

function shown() {
  const s = state.score;
  const rows = s.rows.filter((r) => state.visible.has(r.id));
  return { ...s, rows: rows.length ? rows : s.rows };
}

function fileName(ext) {
  const s = state.score;
  let name = (s.title || "song").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "song";
  if (state.transpose && s.keyInfo) name += ` (in ${keyLabel(s.keyInfo.fifths, s.keyInfo.mode)})`;
  return `${name}.${ext}`;
}

function download(data, type, name) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  $("#status").textContent = `Saved ${name}.`;
}

// the player's speed is in beats; files want quarter notes per minute
const tempo = () => { const P = player.state; return P.bpm * (P.beatQ || 1); };

$("#saveXmlBtn").addEventListener("click", () => {
  if (!state.score) return;
  download(toMusicXML(shown(), { tempo: tempo() }), "application/vnd.recordare.musicxml+xml", fileName("musicxml"));
});
$("#saveMidiBtn").addEventListener("click", () => {
  if (!state.score) return;
  download(toMIDI(shown(), { tempo: tempo() }), "audio/midi", fileName("mid"));
});
