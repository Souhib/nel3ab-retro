// De l'appui à l'image sur le chemin Switch, mesuré de l'extérieur, comme un
// joueur le subit: une trame de manette entre par la prise `/input` de la
// salle, et l'on chronomètre la première image qui a CHANGÉ sur `/video`.
//
// Trois écrans, parce qu'ils ne mesurent pas la même chose:
//   titre  Looney Tunes, L+R quitte l'écran de titre, B y revient. Le jeu joue
//          un fondu avant de changer d'écran: c'est un plafond.
//   menu   Looney Tunes, Bas déplace le curseur du menu principal, Haut le
//          ramène. Un curseur n'a pas de raison d'attendre.
//   guest  Le programme de test `guest/nel3ab-probe.nro`, qui dessine l'état de
//          chaque bouton à chaque image. Tous les boutons sauf +, qui le ferait
//          quitter. C'est le plus petit délai qu'un jeu puisse ajouter.
//
// Toutes les heures sont en horloge monotone (`process.hrtime`), celle que
// portent aussi les images: l'horodatage du compositeur voyage avec chaque
// paquet. `REACTION_DUMP=fichier` écrit, appui par appui, l'heure d'envoi, et
// pour la première image changée son heure de composition et d'arrivée, de
// quoi recoller les étapes avec `spikes/switch-room/latence/`.
//
// Changé, et pas « lourde ». La première version attendait une image de plus
// de 60 Kio et de trois fois la médiane, et elle a menti le 10 septembre 2026:
// elle a annoncé 1,5 ms, c'est-à-dire une image clé périodique (126 Kio contre
// 25, une toutes les 2,1 s) tombée juste après l'appui. La taille d'une image
// dit comment l'encodeur l'a codée, pas ce qu'elle montre.
//
// Donc on décode. ffmpeg réduit chaque image à 64×36 niveaux de gris. Chaque
// point a son enveloppe, le plus clair et le plus sombre qu'il a été pendant la
// demi-seconde avant l'instant compté, et l'on compte les points qui en sortent
// de plus de 12 niveaux sur 255. Par point et non en moyenne: la moyenne sur
// toute l'image voyait le fondu du titre, mais pas un curseur qui ne couvre
// qu'un centième de l'écran.
//
// Un écran de jeu s'anime seul, et ce compte grandit donc sans aucun appui: sur
// l'écran de titre, 60 points au bout d'une seconde. Un seuil fixe de 8 points a
// déclenché sur un témoin sans appui à 53 ms (10 septembre 2026). Chaque appui
// est donc précédé d'un témoin: une trame neutre, et deux secondes d'images
// comptées de la même façon. Une image a changé quand son compte dépasse le
// double de ce que les témoins ont atteint au même temps écoulé, et au moins 8.
// Chaque témoin est aussi jugé contre les autres par la même règle: s'il
// déclenche, l'écran varie trop d'un instant à l'autre pour ce critère, et la
// série est refusée plutôt que publiée.
//
// Et chaque appui a son propre témoin, au même moment de l'écran: les 600 ms
// qui le précèdent, comptées de la même façon. Si l'écran bougeait déjà assez
// pour déclencher, l'appui est écarté, compté à part, et n'entre pas dans la
// médiane. Les témoins passent le même contrôle, jugés contre les autres
// témoins: un témoin pris sur un écran qui bougeait déjà est écarté au lieu de
// faire refuser la série. Cette symétrie a été ajoutée après deux séries
// refusées ainsi le 10 septembre 2026, où le témoin fautif partait à 49 et à
// 11 points dès sa première image, pendant que les appuis avaient ce contrôle
// et les témoins pas. Sans ce contrôle, l'amont a donné 6,4 et 19,8 ms au menu le
// 10 septembre, sur une série dont les cinq témoins étaient calmes: le décor du
// menu bougeait encore d'un appui précédent, et aucun jeu ne répond en 6 ms.
//
// L'heure retenue est celle où le paquet est ARRIVÉ, pas celle où ffmpeg l'a
// rendu. ffmpeg rend ses images avec deux secondes de retard sur un flux en
// direct, donc l'analyse se fait à la fin, une fois le décodeur vidé. Et il
// jette le premier groupe d'images entier, jusqu'à la deuxième image clé, sans
// le signaler: associer la k-ième image rendue au k-ième paquet décalait tout
// de deux secondes, et la référence « avant l'appui » montrait déjà le menu.
// Le décalage est mesuré à la fin, et il doit valoir zéro ou exactement la
// position d'une image clé. Toute autre valeur arrête le pilote.
//
// Ce que ce chiffre contient: la prise d'entrée, la traduction en manette
// virtuelle, le jeu, le compositeur, l'enregistreur, le relais, le worker et la
// prise vidéo. Pas le réseau du joueur ni son décodeur. Le worker mesure en
// même temps sa propre part sous « input_to_frame ».
//
// Prend une place: à lancer quand personne ne joue, sur le bon écran.
//
//   node switch-reaction.mjs http://127.0.0.1:8100 5 1 menu
import WebSocket from "ws";
import { spawn } from "node:child_process";
const [url, trials, port, screen] = [process.argv[2], Number(process.argv[3] ?? 5), Number(process.argv[4] ?? 1), process.argv[5] ?? "titre"];
const SCREENS = {
  titre: { press: 0x30, back: 0x02, settle: 3000 },
  menu: { press: 1 << 13, back: 1 << 12, settle: 2500 },
  // Le compteur d'images en haut et la bande du bas changent seuls : quand le
  // compteur passe de 32767 à 32768, ses 16 cases basculent ensemble, 586
  // points dans un témoin le 10 septembre, et la série entière était refusée.
  // Aucun bouton n'y est dessiné, donc l'analyse garde la bande du milieu.
  guest: { press: 0xffff & ~(1 << 9), back: 0, settle: 1000, crop: [1280, 640, 0, 40], size: [320, 160] },
};
const plan = SCREENS[screen];
if (plan === undefined) throw new Error(`écran inconnu: ${screen} (titre ou menu)`);
// Un bouton du programme de test fait 24 points sur 1280: réduit à 64 de large,
// il n'en resterait qu'un. 320 de large lui en laisse 36.
const [W, H] = plan.size ?? [64, 36];
const HOLD_MS = 150, GIVE_UP_MS = 2000, MARGIN = 12, MIN_POINTS = 8, FRAME_MS = 40;
const base = url.replace(/^http/, "ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mono = () => Number(process.hrtime.bigint()) / 1e6;
const key = (b) => { for (let i = 0; i + 3 < b.length; i++) if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1 && (b[i + 3] & 31) === 5) return true; return false; };

const decoder = spawn("ffmpeg", ["-loglevel", "error", "-probesize", "32", "-analyzeduration", "0", "-threads", "1", "-flags", "low_delay", "-fflags", "nobuffer", "-f", "h264", "-i", "pipe:0",
  "-vf", `${plan.crop ? `crop=${plan.crop.join(":")},` : ""}scale=${W}:${H},format=gray`, "-fps_mode", "passthrough", "-f", "rawvideo", "pipe:1"], { stdio: ["pipe", "pipe", "inherit"] });
// La fin du décodeur est guettée dès son lancement. Guettée seulement à la fin,
// un ffmpeg déjà sorti ne l'annonçait plus, et le pilote attendait pour toujours.
const closed = new Promise((resolve) => decoder.on("close", (code, signal) => resolve({ code, signal })));
decoder.stdin.on("error", () => {});
const arrivals = []; const stamps = []; const keys = []; const lumas = []; let pending = Buffer.alloc(0); let started = false; let done = false;
decoder.stdout.on("data", (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= W * H) { lumas.push(Buffer.from(pending.subarray(0, W * H))); pending = pending.subarray(W * H); }
});
const video = new WebSocket(`${base}/video`); video.binaryType = "nodebuffer";
video.on("message", (m) => {
  const annexB = m.subarray(8);
  if (done || decoder.exitCode !== null || (!started && !key(annexB))) return;
  started = true;
  if (key(annexB)) keys.push(arrivals.length);
  arrivals.push(mono()); stamps.push(Number(m.readBigUInt64LE(0)) / 1000); decoder.stdin.write(annexB);
});
// `identity=1` comme la page: la prise annonce alors la place et le format.
const input = new WebSocket(`${base}/input?identity=1&take=${port}`);
// Deux octets, la place et la force: la vibration que le jeu a demandée.
const rumbles = [];
input.on("message", (m, binary) => { if (binary && m.length === 2) rumbles.push({ at: mono(), seat: m[0], level: m[1] }); });
// La place est réécrite par le serveur avec celle de la connexion; le pilote met la sienne.
const frame = (buttons) => { const b = Buffer.alloc(15); b[0] = 0x53; b[1] = 1; b[2] = port; b.writeUInt32LE(buttons, 3); return b; };
const press = async (buttons) => { input.send(frame(buttons)); await sleep(HOLD_MS); input.send(frame(0)); };
const opened = (ws) => new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });

await Promise.all([opened(video), opened(input)]);
// Une trame neutre dès la prise de place, puis le temps que l'écran l'absorbe.
// Sans elle, le premier témoin recevait la toute première trame de la prise :
// le programme de test redessinait alors l'état de la manette, 406 points à
// 25 ms le 10 septembre, et ce témoin relevait le seuil de tous les appuis.
input.send(frame(0));
await sleep(1500);
// Un appui qui tombe dans le groupe d'images perdu n'a pas de référence: on
// attend la deuxième image clé, puis une demi-seconde d'images.
while (keys.length < 2) await sleep(20);
await sleep(600);
const controls = []; const presses = [];
for (let trial = 0; trial < trials; trial++) {
  controls.push(mono()); input.send(frame(0)); await sleep(GIVE_UP_MS);
  presses.push(mono());
  await press(plan.press);
  await sleep(GIVE_UP_MS + plan.settle); await press(plan.back); await sleep(plan.settle);
}
done = true; decoder.stdin.end();
const exit = await closed;
if (exit.code !== 0) throw new Error(`ffmpeg est sorti avec ${exit.code ?? exit.signal}: la série n'est pas décodée entière`);
const lost = arrivals.length - lumas.length;
if (lost !== 0 && !keys.includes(lost)) {
  console.error(JSON.stringify({ arrivals: arrivals.length, decoded: lumas.length, keys: keys.slice(0, 6) }));
  throw new Error(`le décodeur a perdu ${lost} images ailleurs qu'au début: les heures ne se replacent pas`);
}
const frames = lumas.map((luma, k) => ({ at: arrivals[k + lost], pts: stamps[k + lost], luma }));
const outside = (luma, lo, hi) => { let n = 0; for (let i = 0; i < luma.length; i++) if (luma[i] < lo[i] - MARGIN || luma[i] > hi[i] + MARGIN) n++; return n; };
// Le compte de points hors enveloppe, image par image, dans les deux secondes
// qui suivent l'instant `at`. Vide si la demi-seconde d'avant manque.
const series = (at) => {
  const before = frames.filter((f) => f.at > at - 500 && f.at <= at);
  if (before.length < 5) return [];
  const lo = new Uint8Array(W * H).fill(255), hi = new Uint8Array(W * H);
  for (const f of before) for (let i = 0; i < W * H; i++) { if (f.luma[i] < lo[i]) lo[i] = f.luma[i]; if (f.luma[i] > hi[i]) hi[i] = f.luma[i]; }
  return frames.filter((f) => f.at > at && f.at < at + GIVE_UP_MS).map((f) => ({ ms: f.at - at, at: f.at, pts: f.pts, points: outside(f.luma, lo, hi) }));
};
// Ce que l'écran a fait seul au temps `ms`: le plus grand compte des témoins
// jusqu'à ce temps-là, plus une image. Sans cette image de marge, la première
// image d'un témoin se comparait aux autres témoins AVANT leur première image,
// c'est-à-dire à rien, et 8 points de bruit d'encodage suffisaient à le faire
// déclencher: deux séries refusées ainsi le 10 septembre 2026.
const drift = (witnesses, ms) => Math.max(0, ...witnesses.flatMap((w) => w.filter((f) => f.ms <= ms + FRAME_MS).map((f) => f.points)));
const first = (curve, witnesses) => curve.find((f) => f.points >= Math.max(MIN_POINTS, 2 * drift(witnesses, f.ms)));
const calm = (at, witnesses) => { const still = series(at - 600).filter((f) => f.ms < 600); return still.length > 0 && first(still, witnesses) === undefined; };
const all = controls.map((at) => ({ at, curve: series(at) })).filter((w) => w.curve.length > 0);
const kept = all.filter((w, i) => calm(w.at, all.filter((_, j) => j !== i).map((o) => o.curve)));
const witnessed = kept.map((w) => w.curve);
const refused = witnessed.map((w, i) => first(w, witnessed.filter((_, j) => j !== i))).filter((f) => f !== undefined);
// Un trou dans les arrivées est rapporté: une image en retard parce que rien
// n'est arrivé pendant 400 ms n'est pas un jeu lent, c'est un flux arrêté.
const gaps = [];
const restless = []; const details = [];
const results = presses.map((at) => {
  if (!calm(at, witnessed)) { restless.push(Math.round(at)); return null; }
  const curve = series(at);
  for (let i = 1; i < curve.length; i++) if (curve[i].ms - curve[i - 1].ms > 150) gaps.push({ after_ms: Math.round(curve[i - 1].ms), gap_ms: Math.round(curve[i].ms - curve[i - 1].ms) });
  if (process.env.REACTION_TRACE === "1") console.error(`  appui ${curve.slice(0, 24).map((f) => `${Math.round(f.ms)}:${f.points}`).join(" ")}`);
  const changed = curve.length === 0 ? undefined : first(curve, witnessed);
  details.push({ sent: at, arrived: changed?.at ?? null, composed: changed?.pts ?? null });
  return changed === undefined ? null : +changed.ms.toFixed(1);
});
if (process.env.REACTION_TRACE === "1") for (const w of witnessed) console.error(`  témoin ${w.slice(0, 24).map((f) => `${Math.round(f.ms)}:${f.points}`).join(" ")}`);
const measured = results.filter((r) => r !== null).sort((a, b) => a - b);
const missed = results.length - measured.length - restless.length;
// Du compositeur à l'arrivée, sur toutes les images: capture, encodage, relais,
// worker et prise vidéo, sans le jeu.
const transit = frames.map((f) => f.at - f.pts).sort((a, b) => a - b);
const pick = (q) => +(transit[Math.min(transit.length - 1, Math.round((transit.length - 1) * q))] ?? 0).toFixed(1);
if (process.env.REACTION_DUMP) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.env.REACTION_DUMP, JSON.stringify({ screen, presses: details, restless, rumbles, transit: { n: transit.length, p50: pick(0.5), p95: pick(0.95), max: pick(1) } }));
}
console.error(JSON.stringify({ arrivals: arrivals.length, decoded: lumas.length, lost_at_start: lost, witnesses: witnessed.length, restless_witnesses: all.length - kept.length }));
console.log(JSON.stringify({ screen, port, trials: results, median_ms: measured[measured.length >> 1] ?? null, missed, restless: restless.length, refused_witnesses: refused.length, gaps, transit_p50_ms: pick(0.5), transit_p95_ms: pick(0.95), rumbles: rumbles.length }));
video.close(); input.close();
if (witnessed.length < 2) { console.error("moins de deux témoins utilisables: rien à quoi comparer"); process.exit(2); }
if (refused.length > 0) { console.error(`${refused.length} témoin(s) sans appui ont déclenché contre les autres: l'écran varie trop, la série est refusée`); process.exit(2); }
if (measured.length === 0) { console.error("aucune image changée après l'appui: vérifier l'écran de départ"); process.exit(1); }
process.exit(0);
