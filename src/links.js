import { showError } from "./load.js";
import { player } from "./player.js";
import { $, esc } from "./util.js";

/* ---------- Spotify or YouTube link → search for the sheet music ---------- */
(() => {
  const SPOTIFY = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?|spotify:)(track|album)[/:]([A-Za-z0-9]{10,40})/;
  const SPOTIFY_SHORT = /spotify\.link\/[A-Za-z0-9]+/;
  const YOUTUBE = /(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
  const which = (t) => (SPOTIFY.test(t) || SPOTIFY_SHORT.test(t) ? "spotify" : YOUTUBE.test(t) ? "youtube" : null);
  let current = null;

  // Strip the extras that only get in the way of a search:
  // "Song - Remastered 2011 (feat. X)" -> "Song"; "Artist - Song (Official Video) [4K]" -> artist + song
  const EXTRAS = /\s*[([](?:[^)\]]*\b(?:official|video|audio|lyrics?|lyric video|visuali[sz]er|remaster(?:ed)?|live|hd|hq|4k|mv|m\/v|feat\.?|ft\.?|with|from|piano tutorial|tutorial|synthesia|easy|cover|karaoke|instrumental)\b[^)\]]*)[)\]]/gi;
  const tidySpotify = (t) => t.replace(/\s*[-–]\s*(?:\d{4}\s+)?(?:remaster|live|mono|stereo|single|radio|edit|version|mix|acoustic|demo|from )[^]*$/i, "")
    .replace(EXTRAS, "").trim();
  const tidyChannel = (c) => c.replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "").replace(/\s*(?:official|music|tv|channel)\s*$/gi, "").trim();
  function tidyYouTube(title, channel) {
    let t = title.replace(EXTRAS, "").replace(/\s*\|.*$/, "")
      .replace(/\b(?:piano tutorial|piano cover|synthesia|easy piano|sheet music|official (?:music )?video|lyric video|lyrics)\b/gi, "")
      .replace(/\s+(?:ft\.?|feat\.?)\s.*$/i, "").replace(/\s{2,}/g, " ").trim();
    let artist = "", song = t;
    const dash = /^(.+?)\s+[-–—]\s+(.+)$/.exec(t);
    if (dash) { artist = dash[1].trim(); song = dash[2].trim(); }
    // without "Artist - Song", trust the channel only when it is plainly the artist's own
    else if (/\s-\sTopic$|VEVO$/i.test(channel)) artist = tidyChannel(channel);
    song = song.replace(/^["“'‘]|["”'’]$/g, "").trim();
    return { song, artist };
  }

  const SITES = [
    ["MuseScore", (q) => `https://musescore.com/sheetmusic?text=${encodeURIComponent(q)}`],
    ["Mutopia", (q) => `https://www.mutopiaproject.org/cgibin/make-table.cgi?searchingfor=${encodeURIComponent(q)}`],
    ["IMSLP", (q) => `https://imslp.org/index.php?title=Special:Search&search=${encodeURIComponent(q)}`],
    ["8notes", (q) => `https://www.8notes.com/school/search_fsm.asp?keyword=${encodeURIComponent(q)}`],
    // free-scores.com blocks automated checks, so its own search address couldn't be confirmed: search the web within it
    ["free-scores", (q) => `https://duckduckgo.com/?q=${encodeURIComponent("site:free-scores.com " + q)}`],
    ["the web", (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q + " musicxml OR midi")}`],
  ];
  function links() {
    const q = $("#spotQuery").value.trim();
    $("#spotFinds").innerHTML = q
      ? `<span class="finds-label">Search on</span>` + SITES.map(([name, url]) => `<a class="btn" href="${esc(url(q))}" target="_blank" rel="noopener" aria-label="Search ${esc(name)}"><span class="pre">Search </span>${esc(name)}</a>`).join("")
        + (current?.id && current.canEmbed && !$("#spotPlayer iframe") ? `<button class="btn" type="button" id="spotListen">Listen here</button>` : "")
      : `<span class="status">Type the song's name to search for it.</span>`;
    $("#spotListen")?.addEventListener("click", listen);
  }
  // the player is someone else's page, so it loads only when asked for
  function listen() {
    const c = current;
    $("#spotPlayer").innerHTML = c.source === "youtube"
      // youtube-nocookie: YouTube's privacy-enhanced player, no tracking cookies until you press play
      ? `<iframe class="yt" title="YouTube player" src="https://www.youtube-nocookie.com/embed/${c.id}?rel=0" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
      : `<iframe title="Spotify player" src="https://open.spotify.com/embed/${c.kind}/${c.id}?utm_source=generator" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
    $("#spotListen")?.remove();
  }
  async function lookup(raw) {
    raw = raw.trim();
    if (!raw) return;
    const source = which(raw);
    if (!source) { showError("That doesn't look like a Spotify or YouTube link. In either app, tap Share → Copy link, then paste it here."); return; }
    showError("");
    let href, kind = "", id = "";
    if (source === "spotify") {
      const m = SPOTIFY.exec(raw);
      href = m ? `https://open.spotify.com/${m[1]}/${m[2]}` : raw;
      kind = m?.[1] || ""; id = m?.[2] || "";
    } else {
      id = YOUTUBE.exec(raw)[1];
      href = `https://www.youtube.com/watch?v=${id}`;
      kind = "video";
    }
    current = { source, kind, id, canEmbed: false };
    $("#spotifyCard").hidden = false;
    $("#spotifyCard").dataset.source = source;
    $("#spotTitle").textContent = "Looking it up…"; $("#spotBy").textContent = ""; $("#spotCover").hidden = true;
    $("#spotPlayer").innerHTML = ""; $("#spotQuery").value = ""; $("#spotFinds").innerHTML = "";
    $("#spotHint").textContent = source === "youtube"
      ? "YouTube doesn't share notes, so Sheet Letters can't read the video itself."
      : "Spotify doesn't share notes, so Sheet Letters can't read the song itself.";
    try {
      const r = await fetch(`/api/${source}?url=${encodeURIComponent(href)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "lookup failed");
      Object.assign(current, { kind: d.kind || current.kind, id: d.id || current.id, canEmbed: true });
      $("#spotTitle").textContent = d.title || "Untitled";
      if (d.thumbnail) { $("#spotCover").src = d.thumbnail; $("#spotCover").hidden = false; }
      if (source === "youtube") {
        const { song, artist } = tidyYouTube(d.title || "", d.channel || "");
        $("#spotBy").textContent = d.channel ? `on YouTube · ${d.channel}` : "on YouTube";
        $("#spotQuery").value = [song, artist].filter(Boolean).join(" ");
      } else {
        $("#spotBy").textContent = d.artists?.length ? d.artists.join(", ") : (current.kind === "album" ? "Album" : "");
        $("#spotQuery").value = [tidySpotify(d.title || ""), d.artists?.[0] || ""].filter(Boolean).join(" ");
      }
    } catch (e) {
      // no lookup here (the copy of the app inside Claude can't reach these sites): the search still works
      $("#spotTitle").textContent = source === "youtube" ? "YouTube video" : "Spotify song";
      $("#spotBy").textContent = /isn't|doesn't|won't/.test(e.message) ? e.message : "Couldn't look up the title here. Type the song's name below.";
    }
    links();
    if (!$("#spotQuery").value) $("#spotQuery").focus();
  }
  $("#spotifyForm").addEventListener("submit", (e) => { e.preventDefault(); lookup($("#spotifyUrl").value); });
  $("#spotQuery").addEventListener("input", links);
  $("#spotClose").addEventListener("click", () => { $("#spotifyCard").hidden = true; $("#spotPlayer").innerHTML = ""; current = null; });
  // pasting a song link anywhere on the page (outside a text box) looks it up too
  document.addEventListener("paste", (e) => {
    if (e.target.closest?.("input, textarea, [contenteditable]")) return;
    const t = e.clipboardData?.getData("text") || "";
    if (which(t)) { e.preventDefault(); $("#spotifyUrl").value = t.trim(); lookup(t); }
  });
  window.SheetLettersLinks = { tidyYouTube, tidySpotify, which };
})();
