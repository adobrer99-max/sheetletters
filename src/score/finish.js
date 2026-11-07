import { analyse } from "./transpose.js";
import { EPS } from "../util.js";

/* ---------- normalise: sort, add rests ---------- */
// one staff row in one measure: notes in order, top note first, and a rest for every gap of half a
// beat or more that no note covers (any old rests are dropped and worked out again)
function restRow(events, len) {
  const evs = events.filter((e) => e.notes.length).sort((a, b) => a.t - b.t);
  for (const e of evs) e.notes.sort((a, b) => b.midi - a.midi);
  const out = [];
  let cursor = 0;
  for (const e of evs) {
    if (e.t - cursor >= 0.5 - EPS) out.push({ t: cursor, d: e.t - cursor, rest: true, notes: [] });
    out.push(e);
    cursor = Math.max(cursor, e.t + e.d);
  }
  if (evs.length && len - cursor >= 0.5 - EPS) out.push({ t: cursor, d: len - cursor, rest: true, notes: [] });
  return out;
}
function finish(score) {
  for (const m of score.measures) for (const id in m.rows) m.rows[id] = restRow(m.rows[id], m.len);
  // drop rows that never play a note
  score.rows = score.rows.filter((r) => score.measures.some((m) => (m.rows[r.id] || []).some((e) => !e.rest)));
  if (!score.rows.length) throw new Error("No notes were found in this file.");
  analyse(score);
  return score;
}

export { finish, restRow };
