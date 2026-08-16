// Ce que voit quelqu'un dont la liaison est moyenne.
//
// Le projet dépend du réseau et personne ne prétend le contraire. La question
// que ce pilote tranche est plus étroite: sur un lien étroit, la page perd-elle
// des images qu'elle a POURTANT REÇUES ? Ça, ce n'est pas la faute du réseau.
//
// Il mesure les deux chiffres qui le disent:
//
// - « arrivées contre peintes »: une image décodée puis jetée est du travail
//   fait et perdu, et c'est de l'horaire d'affichage que ça dépend;
// - « famines »: le nombre de fois où le tic d'affichage n'avait rien à montrer
//   alors que la source, elle, produisait bien.
//
// Le lien lent vient de `throttle.mjs`, pas de l'étranglement de Chrome, qui ne
// touche pas les WebSockets.
//
// # Ce que ce fichier ne prouve pas, et il faut le savoir avant de lire ses
// # chiffres
//
// C'est un INSTRUMENT, pas un test: il n'échoue jamais, il mesure. Deux choses
// le rendent bruyant et aucune n'est réparable ici.
//
// - **Le débit du flux dépend de l'image.** Un jeu arrêté sur un menu tient dans
//   0,37 Mbit/s, une partie en mouvement demande dix à vingt fois plus. Un
//   plafond choisi pour l'un ne serre rien chez l'autre, donc il faut le régler
//   sur ce que le worker journalise au moment où on mesure.
// - **Chrome sans écran ne rafraîchit pas toujours à 60 Hz.** Quand la machine
//   peine, sa boucle d'affichage tombe à 15 Hz, et « peintes » perd alors tout
//   son sens. La ligne « écran » est là pour qu'on s'en aperçoive: si elle ne
//   dit pas 60, le reste ne se compare à rien.
//
// Ce qu'il a réellement servi à trouver, en revanche, ce sont deux défauts de la
// page elle-même, tous les deux introduits en croyant l'améliorer. Voir 7.29.
import puppeteer from "puppeteer";
import { enterRoom, openRoom } from "./open.mjs";
import { throttled } from "./throttle.mjs";

const megabits = Number(process.argv[2] ?? 6);
const seconds = Number(process.argv[3] ?? 45);
/** De combien le débit oscille autour de sa moyenne, en fraction. */
const swing = Number(process.argv[4] ?? 0.9);
const PORT = 8199;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const link = await throttled({ port: PORT, megabits: 1000, swing });
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await openRoom(browser, `http://localhost:${PORT}/`, "lien-lent");
await enterRoom(page, 30000);
await wait(4000);

// Le goulot se referme maintenant, une fois la page chargée et la partie en
// route: c'est la situation qu'on veut mesurer, et pas un téléchargement.
link.squeeze(megabits);
// Le temps que l'horaire se cale avant de compter quoi que ce soit.
await wait(12000);
const read = () => page.evaluate(() => globalThis.nel3abTest.pacing());
const before = await read();
await wait(seconds * 1000);
const after = await read();

const arrived = after.arrived - before.arrived;
const painted = after.painted - before.painted;
const starved = after.starved - before.starved;
const undecoded = after.undecoded - before.undecoded;

console.log(`  lien           ${megabits} Mbit/s ±${(swing * 100).toFixed(0)} % pendant ${seconds} s`);
console.log(`  source         ${after.sourceHz.toFixed(0)} Hz`);
console.log(`  arrivées       ${arrived}`);
console.log(
  `  peintes        ${painted}  (${((100 * painted) / Math.max(1, arrived)).toFixed(1)} % de ce qui est arrivé)`,
);
console.log(`  jetées         ${arrived - painted}`);
console.log(`  famines        ${starved}`);
console.log(`  non décodées   ${undecoded}`);
console.log(`  marge          ${after.slackMs.toFixed(0)} ms`);
console.log(`  gigue          ${after.jitter.toFixed(0)} ms`);
console.log(`  écarts         ${after.gapP50.toFixed(1)} / ${after.gapP95.toFixed(1)} ms p50/p95`);
console.log(`  tenue p95      ${after.heldP95} rafraîchissements`);
console.log(`  écran          ${(1000 / after.refresh).toFixed(0)} Hz`);
console.log(`  horaire        ${after.offset.toFixed(0)} ms  (file ${after.queue})`);

await browser.close();
link.close();
process.exit(0);
