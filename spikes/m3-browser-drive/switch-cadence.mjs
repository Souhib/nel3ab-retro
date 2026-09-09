// La cadence RÉELLE du flux Switch, lue comme la page la lit.
//
// Compte les images sur /video pendant N secondes et range les écarts entre
// horodatages du compositeur en périodes de 16,67 ms. Une source à 60 donne
// presque tout en « 1 »; une sortie Sway sans taux de rafraîchissement donne
// presque tout en « 2 » (31,5 images par seconde mesurées le 9 septembre 2026
// sur l'écran de titre de Looney Tunes, contre 58,9 avec `@60Hz` écrit).
//
// Par WebSocket et jamais par le FIFO du recorder: un FIFO n'a qu'un lecteur,
// et lire à côté du relais lui vole des octets au milieu d'un paquet, ce qu'il
// prend pour un en-tête invalide. Trois relances de capture ont été provoquées
// ainsi avant que ce pilote existe.
//
//   node switch-cadence.mjs http://127.0.0.1:8100 8 full
import WebSocket from "ws";
const [url, seconds, half] = [process.argv[2], Number(process.argv[3] ?? 8), process.argv[4] === "half"];
const ws = new WebSocket(url.replace(/^http/, "ws") + (half ? "/video?half=1" : "/video")); ws.binaryType = "nodebuffer";
let last = null; const gaps = [];
ws.on("message", (m) => { const pts = Number(m.readBigUInt64LE(0)) / 1000; if (last !== null) gaps.push(pts - last); last = pts; });
ws.on("open", () => setTimeout(() => {
  const bins = {}; for (const g of gaps) { const k = Math.round(g / 16.67); bins[k] = (bins[k] ?? 0) + 1; }
  const runs = []; let run = 0; for (const g of gaps) { if (g > 25) { run++; } else if (run) { runs.push(run); run = 0; } }
  console.log(JSON.stringify({ stream: half ? "half" : "full", frames: gaps.length + 1, fps: +((gaps.length + 1) / seconds).toFixed(1), periods: bins, consecutive_misses: runs.slice(0, 12) }));
  ws.close(); process.exit(0);
}, seconds * 1000));
