// gels.mjs <url> <emplacement> <secondes> <sortie.jsonl> : enregistre, sur l'horloge monotone (ms),
// chaque image du flux (pts du compositeur et arrivée), la taille du cache de shaders et le journal du moteur.
import WebSocket from "../../m3-browser-drive/node_modules/ws/wrapper.mjs";
import { createWriteStream, statSync, readdirSync, openSync, readSync, fstatSync } from "node:fs";
const [url, slot, seconds, out] = [process.argv[2], process.argv[3], Number(process.argv[4]), process.argv[5]];
const now = () => Number(process.hrtime.bigint()) / 1e6;
const w = createWriteStream(out);
const put = (o) => w.write(JSON.stringify(o) + "\n");
const title = slot.split("/").slice(-2)[0];
const cache = `${slot}/data/games/${title}/cache/shader`;
const logs = `${slot}/home/.config/Ryujinx/Logs`;
const log = `${logs}/${readdirSync(logs).sort().at(-1)}`;
const fd = openSync(log, "r"); let offset = fstatSync(fd).size; let pending = "";
put({ start: now(), log, cache });
const ws = new WebSocket(url.replace(/^http/, "ws") + "/video"); ws.binaryType = "nodebuffer";
ws.on("message", (m) => { if (m.length >= 8) put({ f: now(), pts: Number(m.readBigUInt64LE(0)) / 1000, n: m.length }); });
let sizes = "";
setInterval(() => {
  try { const s = readdirSync(cache).filter((n) => n.endsWith(".data")).map((n) => `${n}:${statSync(`${cache}/${n}`).size}`).join(" "); if (s !== sizes) { put({ c: now(), s }); sizes = s; } } catch {}
  const size = fstatSync(fd).size;
  if (size > offset) { const b = Buffer.alloc(size - offset); readSync(fd, b, 0, b.length, offset); offset = size; pending += b.toString(); const lines = pending.split("\n"); pending = lines.pop(); const t = now(); for (const l of lines) if (l.trim()) put({ l: t, x: l.slice(0, 240) }); }
}, 50);
setTimeout(() => { ws.close(); w.end(() => process.exit(0)); }, seconds * 1000);
