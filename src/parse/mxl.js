import { $, decodeText } from "../util.js";

/* ---------- .mxl (zip) reader, no library needed ---------- */
async function readMxl(buf) {
  const u8 = new Uint8Array(buf), v = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65558); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("This .mxl file looks damaged (it isn't a readable zip archive). Try exporting it again, or export uncompressed MusicXML instead.");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const files = {};
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const off = v.getUint32(p + 42, true);
    files[new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen))] = { method, csize, off };
    p += 46 + nlen + xlen + clen;
  }
  async function read(name) {
    const f = files[name];
    const start = f.off + 30 + v.getUint16(f.off + 26, true) + v.getUint16(f.off + 28, true);
    const data = u8.subarray(start, start + f.csize);
    if (f.method === 0) return decodeText(data);
    if (f.method !== 8 || typeof DecompressionStream === "undefined") throw new Error("This browser can't unpack .mxl files. Update it, or export the song as uncompressed MusicXML (.musicxml).");
    const out = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
    return decodeText(new Uint8Array(out));
  }
  let root = null;
  if (files["META-INF/container.xml"]) {
    const c = new DOMParser().parseFromString(await read("META-INF/container.xml"), "application/xml");
    root = c.querySelector("rootfile")?.getAttribute("full-path");
  }
  if (!root || !files[root]) root = Object.keys(files).find((n) => !n.startsWith("META-INF") && /\.(xml|musicxml)$/i.test(n));
  if (!root) throw new Error("No score was found inside this .mxl file.");
  return read(root);
}

export { readMxl };
