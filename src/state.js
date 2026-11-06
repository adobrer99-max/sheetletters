/* ---------- state ---------- */
const state = { score: null, original: null, transpose: 0, visible: new Set(), isExample: false };
const opts = { octave: false, lyrics: true, chords: true, color: false, compact: false, plain: false, size: 1, metro: false, countIn: false, names: "letters" };
try { Object.assign(opts, JSON.parse(localStorage.getItem("sheetLetters.opts") || "{}")); } catch (e) {}
const saveOpts = () => { try { localStorage.setItem("sheetLetters.opts", JSON.stringify(opts)); } catch (e) {} };

export { state, opts, saveOpts };
