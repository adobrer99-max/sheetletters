// Save a song as a MIDI file: one track per staff row, with the speed, time and key signatures,
// track names, the title and the lyrics. Repeats and 1st/2nd endings are written out in playing
// order (MIDI has no way to say "play this twice"), and tied notes become one long note.

import { playOrder } from "../score/order.js";

const PPQ = 480;
const vlq = (n) => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const utf8 = (s) => [...new TextEncoder().encode(s)];
const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data];

function track(events) {
  // note-offs before note-ons at the same moment, so repeated notes sound twice
  events.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  const out = [];
  let at = 0;
  for (const [tick, bytes] of events) { out.push(...vlq(Math.max(0, tick - at)), ...bytes); at = Math.max(at, tick); }
  out.push(0, ...meta(0x2f, []));
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(out.length), ...out];
}

/** The song as MIDI file bytes. tempo: beats per minute (defaults to the song's own, or 90). */
export function toMIDI(s, { tempo, unroll = true } = {}) {
  const order = unroll ? playOrder(s.measures) : s.measures.map((_, i) => i);
  const tick = (q) => Math.round(q * PPQ);
  const first = s.measures[order[0]];
  // a pickup bar is padded out to a full bar at the start, so the bar lines land where they should
  const lead = first && first.pickup !== false && first.len < first.timeLen - 1e-6 ? first.timeLen - first.len : 0;

  // where each played measure starts, in quarter notes
  const starts = [];
  let at = lead;
  for (const i of order) { starts.push(at); at += s.measures[i].len; }

  // conductor track: title, speed, time and key signatures
  const head = [];
  if (s.title) head.push([0, meta(0x03, utf8(s.title)), 1]);
  const us = Math.round(60e6 / (tempo || s.tempo || 90));
  head.push([0, meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]), 1]);
  let time = "", fifths = null;
  const minor = s.keyInfo?.mode === "minor" || s.mode === "minor";
  order.forEach((i, k) => {
    const m = s.measures[i];
    const beatType = m.beatType || 4, beats = Math.round((m.timeLen * beatType) / 4);
    const t = k === 0 ? 0 : tick(starts[k]);
    if (`${beats}/${beatType}` !== time) { time = `${beats}/${beatType}`; head.push([t, meta(0x58, [beats, Math.round(Math.log2(beatType)), 24, 8]), 1]); }
    const f = m.key ?? (k === 0 ? (s.keyInfo?.fifths ?? 0) : fifths);
    if (f !== fifths && f != null) { fifths = f; head.push([t, meta(0x59, [f & 255, minor ? 1 : 0]), 1]); }
  });
  const tracks = [track(head)];

  s.rows.forEach((row, ri) => {
    const ch = ri < 9 ? ri : (ri + 1) % 16; // channel 10 is drums
    const ev = [[0, meta(0x03, utf8(row.name || `Part ${ri + 1}`)), 1]];
    const sounding = new Map(); // midi -> the note-off event of the note still ringing, to extend a tie
    order.forEach((i, k) => {
      const m = s.measures[i];
      const evs = (m.rows[row.id] || []).filter((e) => !e.rest).slice().sort((a, b) => a.t - b.t);
      for (const e of evs) {
        const on = starts[k] + e.t, off = on + Math.min(e.d, m.len - e.t);
        // grace notes: a quick lead-in just before the beat
        (e.grace || []).forEach((g, gi, all) => {
          const gOn = Math.max(0, on - (all.length - gi) / 8);
          ev.push([tick(gOn), [0x90 | ch, g.midi, 80], 2], [tick(gOn + 1 / 8) - 1, [0x80 | ch, g.midi, 0], 0]);
        });
        if (e.lyric?.text) {
          const end = e.lyric.syllabic === "begin" || e.lyric.syllabic === "middle" ? "-" : "";
          ev.push([tick(on), meta(0x05, utf8(e.lyric.text + end)), 1]);
        }
        for (const n of e.notes) {
          const ringing = sounding.get(n.midi);
          if (n.held && ringing && Math.abs(ringing[0] - tick(on)) <= 1) { ringing[0] = tick(off); continue; }
          ev.push([tick(on), [0x90 | ch, n.midi, 88], 2]);
          const noteOff = [tick(off), [0x80 | ch, n.midi, 0], 0];
          ev.push(noteOff);
          sounding.set(n.midi, noteOff);
        }
      }
    });
    tracks.push(track(ev));
  });
  const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 1, (tracks.length >> 8) & 255, tracks.length & 255, (PPQ >> 8) & 255, PPQ & 255];
  return new Uint8Array(header.concat(...tracks));
}
