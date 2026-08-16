// Enregistre le flux vidéo tel qu'il sort du worker, en Annex B.
//
// Pour mesurer un encodeur il faut du contenu réel: une mire synthétique n'a ni
// les aplats ni les mouvements d'un jeu GameCube, et un réglage choisi sur elle
// ne dit rien de celui qu'il faut ici. Le fichier écrit se relit avec ffmpeg,
// donc il sert à la fois de référence et de source pour ré-encoder.
//
// Chaque message porte huit octets d'instant de capture puis l'unité d'accès.
// On jette les huit et on colle le reste: c'est exactement un flux H.264 brut.
import fs from "node:fs";
import WebSocket from "ws";

const seconds = Number(process.argv[2] ?? 30);
const out = process.argv[3] ?? "/tmp/capture.h264";
/** Une pointe à ne pas dépasser, en octets. Facultatif, et c'est ce qui rend ce
 * fichier capable d'échouer plutôt que seulement de raconter.
 *
 * L'image-clé est la plus grosse chose que ce flux envoie, et elle est bornée
 * par un réglage de l'encodeur dont la raison est mesurée dans le carnet (7.30).
 * Si ce réglage cesse un jour de mordre — un ffmpeg qui change d'avis sur
 * `i_quant_offset`, un pilote qui l'ignore — la pointe redouble en silence et
 * seule cette ligne s'en aperçoit. */
const peakUnder = Number(process.env.NEL3AB_PEAK_UNDER ?? 0);
const url = process.argv[4] ?? "ws://localhost:8100/video";

const file = fs.createWriteStream(out);
const sizes = [];
const socket = new WebSocket(url, { origin: "http://localhost:8100" });
socket.binaryType = "arraybuffer";
socket.on("message", (data) => {
  const bytes = new Uint8Array(data);
  if (bytes.length <= 8) return;
  sizes.push(bytes.length - 8);
  file.write(Buffer.from(bytes.subarray(8)));
});
socket.on("error", (error) => {
  console.log(`ERREUR ${error.message}`);
  process.exit(1);
});

setTimeout(() => {
  socket.close();
  file.end(() => {
    const sorted = [...sizes].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q))] ?? 0;
    const total = sizes.reduce((sum, size) => sum + size, 0);
    console.log(`${sizes.length} images, ${(total / 1024 / 1024).toFixed(1)} Mio dans ${out}`);
    console.log(
      `  octets par image  p50 ${at(0.5)}  p95 ${at(0.95)}  p99 ${at(0.99)}  max ${at(1)}`,
    );
    console.log(`  débit moyen       ${((total * 8) / seconds / 1e6).toFixed(2)} Mbit/s`);
    if (peakUnder > 0) {
      const worst = at(1);
      const ok = worst <= peakUnder;
      console.log(
        ok
          ? `PASS — la pointe tient sous ${peakUnder} octets`
          : `ÉCHEC — la pointe fait ${worst} octets, la limite est ${peakUnder}`,
      );
      process.exit(ok ? 0 : 1);
    }
    process.exit(0);
  });
}, seconds * 1000);
