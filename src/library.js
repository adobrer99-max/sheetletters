// The song library (public-domain songs, written in tools/songs.py) and shareable links.
//
// A link names a library song and how it's shown, e.g.
//   …/app/#song=ode-to-joy&key=2&names=fixed&melody=1
// key = semitones up (negative for down), names = letters | fixed | movable | numbers, melody = 1 for
// melody only. The address bar always holds the current song's link, so copying it from the
// browser works as well as the Share button.

import index from "./examples/library/index.json";
import twinkle from "./examples/twinkle.musicxml?raw";
import { parseMusicXML } from "./parse/musicxml.js";
import { show, showError } from "./load.js";
import { state, opts, saveOpts } from "./state.js";
import { NAMINGS } from "./score/names.js";
import { setTranspose } from "./render.js";
import { $, esc } from "./util.js";

export const SONGS = index;
const files = import.meta.glob("./examples/library/*.musicxml", { query: "?raw", import: "default" });

async function songText(slug) {
  if (slug === "twinkle") return twinkle;
  const load = files[`./examples/library/${slug}.musicxml`];
  if (!load) throw new Error("That song isn't in the library.");
  return load();
}

/** Open a library song, optionally with settings from a link. */
export async function openSong(slug, settings = {}) {
  try {
    const score = parseMusicXML((await songText(slug)).trim());
    applying = true;
    if (settings.names && NAMINGS[settings.names]) { opts.names = settings.names; $("#optNames").value = opts.names; }
    if (settings.melody !== undefined) { opts.melody = settings.melody; $("#optMelody").checked = opts.melody; }
    saveOpts();
    show(score, slug, slug === "twinkle" ? "Example" : "From the song library");
    state.slug = slug;
    if (settings.key) setTranspose(settings.key);
    $("#libSelect").value = slug;
  } catch (err) {
    showError(err.message);
  } finally {
    applying = false;
    updateLink();
  }
}

function readLink() {
  const p = new URLSearchParams(location.hash.slice(1));
  const slug = p.get("song");
  if (!slug || !SONGS.some((s) => s.slug === slug)) return null;
  const key = parseInt(p.get("key"), 10);
  return { slug, key: Number.isFinite(key) ? Math.max(-6, Math.min(5, key)) : 0, names: p.get("names") || undefined,
    melody: p.has("melody") ? p.get("melody") === "1" : undefined };
}

function linkFor() {
  const p = new URLSearchParams({ song: state.slug });
  if (state.transpose) p.set("key", String(state.transpose));
  if (opts.names && opts.names !== "letters") p.set("names", opts.names);
  if (opts.melody) p.set("melody", "1");
  return `${location.origin}${location.pathname}#${p.toString()}`;
}

let applying = false;
// keep the address bar in step with what's on screen (without filling up the back button)
function updateLink() {
  if (applying) return;
  const share = $("#shareBtn");
  if (state.slug) {
    const url = linkFor();
    if (url !== location.href) history.replaceState(null, "", url);
    share.hidden = false;
  } else {
    if (location.hash.includes("song=")) history.replaceState(null, "", location.pathname + location.search);
    share.hidden = true;
  }
}
addEventListener("sl:render", updateLink);
addEventListener("hashchange", () => { const l = readLink(); if (l && (l.slug !== state.slug || l.key !== state.transpose)) openSong(l.slug, l); });

// grouped by level, in the order the groups first appear
const groups = [...new Set(SONGS.map((s) => s.level || "More songs"))];
$("#libSelect").innerHTML = `<option value="">Try a song…</option>` + groups.map((g) =>
  `<optgroup label="${esc(g)}">${SONGS.filter((s) => (s.level || "More songs") === g).map((s) => `<option value="${esc(s.slug)}">${esc(s.title)}</option>`).join("")}</optgroup>`).join("");
$("#libSelect").addEventListener("change", (e) => { if (e.target.value) openSong(e.target.value); });

$("#shareBtn").addEventListener("click", async () => {
  const url = linkFor(), title = state.score?.title || "Sheet Letters";
  // phones get their share sheet; computers get the link copied
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try { await navigator.share({ title: `${title} · Sheet Letters`, url }); return; } catch (err) { if (err?.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); $("#status").textContent = "Link copied. Anyone who opens it sees this song, in this key and these note names."; }
  catch { $("#status").textContent = `Copy this link: ${url}`; }
});

/** At start-up: the song a link names, or the example. */
export function openFromLinkOr(fallback) {
  const l = readLink();
  if (l) openSong(l.slug, l); else fallback();
}
