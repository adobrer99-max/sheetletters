import { analyse } from "./transpose.js";
import { EPS } from "../util.js";

/* ---------- normalise: sort, add rests ---------- */
function finish(score) {
  for (const m of score.measures) {
    for (const id in m.rows) {
      const evs = m.rows[id].filter((e) => e.notes.length).sort((a, b) => a.t - b.t);
      for (const e of evs) e.notes.sort((a, b) => b.midi - a.midi);
      // rests = gaps of at least a beat-and-a-bit that no note covers
      const out = [];
      let cursor = 0;
      for (const e of evs) {
        if (e.t - cursor >= 0.5 - EPS) out.push({ t: cursor, d: e.t - cursor, rest: true, notes: [] });
        out.push(e);
        cursor = Math.max(cursor, e.t + e.d);
      }
      if (evs.length && m.len - cursor >= 0.5 - EPS) out.push({ t: cursor, d: m.len - cursor, rest: true, notes: [] });
      m.rows[id] = out;
    }
  }
  // drop rows that never play a note
  score.rows = score.rows.filter((r) => score.measures.some((m) => (m.rows[r.id] || []).some((e) => !e.rest)));
  if (!score.rows.length) throw new Error("No notes were found in this file.");
  analyse(score);
  return score;
}

export { finish };
