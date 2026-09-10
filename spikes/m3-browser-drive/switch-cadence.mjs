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
// Un message de moins de huit octets n'est pas une image : Looney Tunes en a
// reçu le 10 septembre, et le pilote s'arrêtait net sur sa lecture.
let short = 0;
ws.on("message", (m) => { if (m.length < 8) { short++; return; } const pts = Number(m.readBigUInt64LE(0)) / 1000; if (last !== null) gaps.push(pts - last); last = pts; });
ws.on("open", () => setTimeout(() => {
  const bins = {}; for (const g of gaps) { const k = Math.round(g / 16.67); bins[k] = (bins[k] ?? 0) + 1; }
  const runs = []; let run = 0; for (const g of gaps) { if (g > 25) { run++; } else if (run) { runs.push(run); run = 0; } }
  // La régularité, en millisecondes : un compositeur plus rapide ne change pas
  // le nombre d'images, mais peut changer leur espacement.
  const sorted = [...gaps].sort((a, b) => a - b); const at = (q) => +(sorted[Math.round((sorted.length - 1) * q)] ?? 0).toFixed(2);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length; const spread = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
  console.log(JSON.stringify({ stream: half ? "half" : "full", frames: gaps.length + 1, fps: +((gaps.length + 1) / seconds).toFixed(1), periods: bins, consecutive_misses: runs.slice(0, 12), short_messages: short, gap_ms: { p5: at(0.05), p50: at(0.5), p95: at(0.95), spread: +spread.toFixed(2) } }));
  ws.close(); process.exit(0);
}, seconds * 1000));
