// "Fix notes": tap any note to change it. The bar above the player changes the selected note
// (higher, lower, an octave, earlier, later, shorter, longer, delete, add one after), with undo.
// Keyboard: ↑ ↓ pitch, Shift+↑ ↓ octave, ← → previous/next note, Delete, Ctrl/Cmd+Z, Esc.
//
// Changes go into the song as opened, so they follow you through transposing, melody only, playing
// and saving. Opening another song (or re-running a recording's fix-ups) starts fresh.

import { player } from "./player.js";
import { refreshView } from "./render.js";
import { addAfter, changePitch, changePitchRange, lengthName, move, moveRange, rangeEvents, remove, removeRange, resize } from "./score/edit.js";
import { nameText } from "./score/names.js";
import { analyse } from "./score/transpose.js";
import { opts, state } from "./state.js";
import { $ } from "./util.js";

let on = false, sel = null, end = null, many = false, undo = [], forSong = null;
const MAX_UNDO = 100;

function setOn(v) {
  on = v;
  $("#editBtn").setAttribute("aria-pressed", String(on));
  $("#editBtn").textContent = on ? "Fixing notes" : "Fix notes";
  $("#sheet").classList.toggle("editing", on);
  $("#editBar").hidden = !on;
  if (!on) { select(null); setMany(false); }
  else { describe(); if (opts.plain) $("#status").textContent = "Switch off the plain-text view to tap notes."; }
}

const visibleRows = () => state.score.rows.filter((r) => state.visible.has(r.id));

// the selected note's place on screen, and what it is
function where() {
  if (!sel) return null;
  const row = state.original.measures[sel.mi]?.rows[sel.rid];
  const i = row ? row.indexOf(sel.ev) : -1;
  const r = visibleRows().findIndex((x) => x.id === sel.rid);
  return i < 0 || r < 0 ? null : { i, r };
}
function viewNote() {
  const w = where();
  if (!w) return null;
  const e = state.score.measures[sel.mi].rows[sel.rid][w.i];
  return e && { e, n: e.notes[sel.ev.notes.indexOf(sel.note)] || e.notes[0] };
}
// several notes: everything from the first tap (sel) to the last (end), in one row
const run = () => (sel && end ? rangeEvents(state.original, sel.rid, sel, end) : null);
function elFor(mi, ev) {
  const row = state.original.measures[mi]?.rows[sel.rid];
  const i = row ? row.indexOf(ev) : -1, r = visibleRows().findIndex((x) => x.id === sel.rid);
  return i < 0 || r < 0 ? null : document.querySelector(`.measure[data-mi="${mi}"] .ev[data-r="${r}"][data-i="${i}"]`);
}
function mark() {
  document.querySelectorAll(".ev.sel").forEach((el) => el.classList.remove("sel"));
  if (!sel) return null;
  for (const x of run() || []) elFor(x.mi, x.ev)?.classList.add("sel");
  const el = elFor(sel.mi, sel.ev);
  el?.classList.add("sel");
  return end ? elFor(end.mi, end.ev) : el;
}
// after notes move between bars, find which bar each one is in now
function relocate(x) {
  if (!x) return x;
  const mi = state.original.measures.findIndex((m) => (m.rows[x.rid] || []).includes(x.ev));
  return mi < 0 ? null : { ...x, mi };
}
function setMany(v) {
  many = v;
  $("#edMany").setAttribute("aria-pressed", String(many));
  if (many && sel) $("#editWhat").textContent = "Now tap the last note to include.";
  else describe();
}
function describe() {
  const v = viewNote();
  const tools = $("#editBar").querySelectorAll(".edit-tools .btn:not(#edDone):not(#edUndo)");
  tools.forEach((b) => { b.disabled = !v; });
  $("#edUndo").disabled = !undo.length;
  if (!v) { $("#editWhat").textContent = "Tap a note to fix it."; return; }
  const list = run();
  for (const id of ["#edShorter", "#edLonger", "#edAdd"]) $(id).disabled = !!list;
  if (list) {
    const a = state.score.measures[list[0].mi].number, b = state.score.measures[list[list.length - 1].mi].number;
    $("#editWhat").innerHTML = `<b>${list.length} notes</b> selected · ${a === b ? `bar ${a}` : `bars ${a}–${b}`}`;
    return;
  }
  const m = state.score.measures[sel.mi];
  const name = nameText(v.n, opts.names, state.score.keyInfo.fifths, state.score.keyInfo.mode === "minor");
  const chord = sel.ev.notes.length > 1 ? " (top note of the chord)" : "";
  $("#editWhat").innerHTML = `<b>${name.replace(/</g, "&lt;")}${opts.names === "letters" ? v.n.octave : ""}</b>${chord} · ${lengthName(v.e.d)} · bar ${m.number}`;
}
function select(s, { sound = true, scroll = false, keepEnd = false } = {}) {
  sel = s;
  if (!keepEnd) end = null;
  const el = mark();
  describe();
  if (sel && sound) { const v = viewNote(); if (v) player.preview(v.n.midi); }
  if (el && scroll) el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function snapshot() { return structuredClone(state.original.measures); }
function changed() {
  analyse(state.original); // chord names worked out from the notes follow the change
  if (!state.edited) {
    state.edited = true;
    if (state.slug) { state.slug = null; $("#libSelect").value = ""; } // a library link wouldn't include your changes
  }
  refreshView();
}
function apply(fn) {
  if (!sel) return;
  const before = snapshot();
  const res = fn();
  if (!res.ok) { $("#editWhat").textContent = res.msg; setTimeout(describe, 1800); return; }
  undo.push({ measures: before, sel: { mi: sel.mi, rid: sel.rid, t: sel.ev.t } });
  if (undo.length > MAX_UNDO) undo.shift();
  if (res.ev) sel = { mi: sel.mi, rid: sel.rid, ev: res.ev, note: res.ev.notes[0] };
  const keep = end;
  sel = relocate(sel);
  changed();
  if (keep && sel) { end = relocate(keep); select(sel, { keepEnd: true, sound: false }); const v = viewNote(); if (v) player.preview(v.n.midi); }
  else select(sel);
}
function undoLast() {
  const u = undo.pop();
  if (!u) return;
  state.original.measures = u.measures;
  analyse(state.original);
  if (!undo.length) state.edited = false; // back to the song as opened
  refreshView();
  const ev = (state.original.measures[u.sel.mi]?.rows[u.sel.rid] || []).find((e) => !e.rest && Math.abs(e.t - u.sel.t) < 1e-6);
  select(ev ? { mi: u.sel.mi, rid: u.sel.rid, ev, note: ev.notes[0] } : null, { sound: !!ev });
}

// the note before or after a note, across bar lines
function neighbour(from, dir) {
  const ms = state.original.measures;
  let mi = from.mi, row = ms[mi].rows[sel.rid] || [], i = row.indexOf(from.ev);
  for (;;) {
    i += dir;
    while (i < 0 || i >= row.length) {
      mi += dir;
      if (mi < 0 || mi >= ms.length) return null;
      row = ms[mi].rows[sel.rid] || [];
      i = dir > 0 ? 0 : row.length - 1;
    }
    if (!row[i].rest) return { mi, rid: sel.rid, ev: row[i], note: row[i].notes[0] };
  }
}
function extend(dir) {
  if (!sel) return;
  const n = neighbour(end || sel, dir);
  if (!n) return;
  end = n.ev === sel.ev ? null : n;
  select(sel, { keepEnd: true, sound: false });
  elFor(n.mi, n.ev)?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function step(dir) {
  if (!sel) return;
  const ms = state.original.measures;
  let mi = sel.mi, row = ms[mi].rows[sel.rid] || [], i = row.indexOf(sel.ev);
  for (;;) {
    i += dir;
    while (i < 0 || i >= row.length) {
      mi += dir;
      if (mi < 0 || mi >= ms.length) return;
      row = ms[mi].rows[sel.rid] || [];
      i = dir > 0 ? 0 : row.length - 1;
    }
    if (!row[i].rest) break;
  }
  select({ mi, rid: sel.rid, ev: row[i], note: row[i].notes[0] }, { scroll: true });
}

/* ---- wiring ---- */
$("#editBtn").addEventListener("click", () => setOn(!on));
$("#edDone").addEventListener("click", () => setOn(false));
const S = () => state.original;
const R = () => run();
const pitch = (n) => () => apply(() => (R() ? changePitchRange(S(), sel.rid, R(), n) : changePitch(S(), sel, n)));
const shift = (by) => () => apply(() => (R() ? moveRange(S(), sel.rid, R(), by) : move(S(), sel, by)));
$("#edHigher").addEventListener("click", pitch(1));
$("#edLower").addEventListener("click", pitch(-1));
$("#edOctUp").addEventListener("click", pitch(12));
$("#edOctDown").addEventListener("click", pitch(-12));
$("#edEarlier").addEventListener("click", shift(-0.25));
$("#edLater").addEventListener("click", shift(0.25));
$("#edShorter").addEventListener("click", () => apply(() => resize(S(), sel, -1)));
$("#edLonger").addEventListener("click", () => apply(() => resize(S(), sel, 1)));
$("#edAdd").addEventListener("click", () => apply(() => addAfter(S(), sel)));
$("#edDelete").addEventListener("click", () => {
  if (!sel) return;
  const list = R();
  if (list) {
    undo.push({ measures: snapshot(), sel: { mi: sel.mi, rid: sel.rid, t: sel.ev.t } });
    removeRange(S(), sel.rid, list);
    changed(); select(null);
    return;
  }
  const next = (() => { const row = S().measures[sel.mi].rows[sel.rid]; return row.slice(row.indexOf(sel.ev) + 1).find((e) => !e.rest); })();
  apply(() => remove(S(), sel));
  if (sel && !where()) select(next ? { mi: sel.mi, rid: sel.rid, ev: next, note: next.notes[0] } : null, { sound: false });
});
$("#edMany").addEventListener("click", () => setMany(!many));
$("#edUndo").addEventListener("click", undoLast);

$("#measures").addEventListener("click", (e) => {
  if (!on || e.target.closest(".mnum")) return;
  const evEl = e.target.closest(".ev[data-i]");
  if (!evEl) return;
  const mi = +evEl.closest(".measure").dataset.mi, row = visibleRows()[+evEl.dataset.r];
  const ev = row && state.original.measures[mi].rows[row.id]?.[+evEl.dataset.i];
  if (!ev || ev.rest) return;
  if ((e.shiftKey || many) && sel && sel.rid === row.id) {
    end = ev === sel.ev ? null : { mi, rid: row.id, ev };
    setMany(false);
    select(sel, { keepEnd: true, sound: false });
    return;
  }
  select({ mi, rid: row.id, ev, note: ev.notes[0] });
});

addEventListener("keydown", (e) => {
  if (!on || !sel || e.target.closest("input, select, textarea, [contenteditable]")) return;
  const k = e.key, mod = e.ctrlKey || e.metaKey;
  if (mod && k.toLowerCase() === "z") { e.preventDefault(); undoLast(); return; }
  if (mod || e.altKey) return;
  const acts = {
    ArrowUp: () => $(e.shiftKey ? "#edOctUp" : "#edHigher").click(),
    ArrowDown: () => $(e.shiftKey ? "#edOctDown" : "#edLower").click(),
    ArrowLeft: () => (e.shiftKey ? extend(-1) : step(-1)), ArrowRight: () => (e.shiftKey ? extend(1) : step(1)),
    Delete: () => $("#edDelete").click(), Backspace: () => $("#edDelete").click(),
    Escape: () => (end ? select(sel, { sound: false }) : select(null)),
  };
  if (acts[k]) { e.preventDefault(); acts[k](); }
});

// after every redraw: keep the selection marked; a different song starts fresh
addEventListener("sl:render", () => {
  if (state.original !== forSong) {
    forSong = state.original; undo = []; sel = null; end = null;
    describe();
    return;
  }
  mark(); describe();
});
// don't lose changes by accident
addEventListener("beforeunload", (e) => { if (state.edited) { e.preventDefault(); e.returnValue = ""; } });

export const editing = { get on() { return on; }, setOn, get selection() { return sel; } };
