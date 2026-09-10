// La continuité du son de la salle, lue sur `/sound` comme la page la lit.
//
// Fait pour le programme de test `guest/nel3ab-probe.nro`, qui joue une
// sinusoïde de 440 Hz à gauche et de 880 Hz à droite par AudioOut, le chemin où
// le jeu tient sa propre file. Une sinusoïde pure vérifie, échantillon par
// échantillon, x[n+1] + x[n-1] = 2 cos(ω) x[n]. Le reste de cette égalité ne
// dépasse pas quelques unités d'arrondi sur un son intact. Un morceau jeté ou
// répété casse la phase, et le reste saute d'une fraction de l'amplitude.
// C'est le défaut du 9 septembre sur Looney Tunes, devenu un nombre.
//
// Ce contrôle ne voit PAS le retard : une sinusoïde en retard reste une
// sinusoïde parfaite. Le 10 septembre 2026, il a validé un son qui arrivait avec
// un retard croissant (carnet de bord). Le retard se lit ailleurs : l'essai
// DevicePull de `spikes/switch-room/amont/` et `sdl_ms` du compteur de sonde.
//
// Compte aussi les silences de plus de 5 ms (une famine) et les trous entre
// les horodatages des paquets. Le son arrive en s16le stéréo à 48 kHz, le
// format que `capture.py` demande à parec.
//
//   node switch-son.mjs http://127.0.0.1:8100 10 440 880
import WebSocket from "ws";
const [url, seconds, left, right] = [process.argv[2], Number(process.argv[3] ?? 10), Number(process.argv[4] ?? 440), Number(process.argv[5] ?? 880)];
const RATE = 48000, SPIKE = 0.05, QUIET = 0.02, QUIET_RUN = RATE / 200;
const ws = new WebSocket(url.replace(/^http/, "ws") + "/sound"); ws.binaryType = "nodebuffer";
const chunks = []; const stamps = [];
ws.on("message", (m) => { stamps.push({ us: Number(m.readBigUInt64LE(0)), frames: (m.length - 8) / 4 }); chunks.push(m.subarray(8)); });
ws.on("open", () => setTimeout(() => {
  ws.close();
  const pcm = Buffer.concat(chunks); const frames = Math.floor(pcm.length / 4);
  const channel = (c, hz) => {
    const x = new Float64Array(frames); for (let n = 0; n < frames; n++) x[n] = pcm.readInt16LE(n * 4 + c * 2);
    const sorted = Float64Array.from(x, Math.abs).sort(); const amplitude = sorted[Math.floor(frames * 0.999)] ?? 0;
    const k = 2 * Math.cos((2 * Math.PI * hz) / RATE);
    const spikes = []; let quiet = 0; let silences = 0;
    for (let n = 1; n + 1 < frames; n++) {
      if (Math.abs(x[n + 1] + x[n - 1] - k * x[n]) > SPIKE * amplitude) spikes.push(+((n / RATE) * 1000).toFixed(1));
      if (Math.abs(x[n]) < QUIET * amplitude) { quiet++; if (quiet === QUIET_RUN) silences++; } else quiet = 0;
    }
    return { hz, amplitude, spikes: spikes.length, first_spikes_ms: spikes.slice(0, 8), silences };
  };
  let gaps = 0;
  for (let i = 1; i < stamps.length; i++) {
    const expected = (stamps[i - 1].frames / RATE) * 1e6;
    if (stamps[i].us - stamps[i - 1].us > expected + 20_000) gaps++;
  }
  console.log(JSON.stringify({ seconds: +(frames / RATE).toFixed(2), packets: stamps.length, left: channel(0, left), right: channel(1, right), timestamp_gaps: gaps }));
  process.exit(0);
}, seconds * 1000));
