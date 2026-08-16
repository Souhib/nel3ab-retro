// Regarder sans jouer: rendre sa manette, et entrer sans en prendre.
//
// Ce que ce pilote existe pour attraper tient en une phrase: la page se
// RECONNECTE toute seule. Une socket de manette qui se ferme est rouverte une
// demi-seconde plus tard, et la place est reprise. « Rendre sa manette » sans
// drapeau durerait donc une demi-seconde, et le pilote qui vérifierait juste
// après verrait bien une place rendue.
//
// D'où la forme des deux assertions qui comptent: elles attendent PLUS LONGTEMPS
// que la reconnexion polie avant de regarder.
import puppeteer from "puppeteer";
import { enterRoom, openRoom, seatOf, watchRoom } from "./open.mjs";

const url = process.argv[2] ?? "http://localhost:8100/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Plus long que la reconnexion polie de la page, qui est d'une demi-seconde. */
const LONGER_THAN_A_RECONNECT = 2500;
let bad = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
  if (!ok) bad += 1;
};

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });

// ── Une page qui entre pour JOUER, puis rend sa place.
const player = await openRoom(browser, url, "joueur");
await enterRoom(player);
await wait(2500);
const took = await seatOf(player);
if (took === null) {
  console.log("RIEN TESTÉ — la salle est pleine, cette page n'a pas eu de manette");
  await browser.close();
  process.exit(0);
}
check(true, `une page qui entre pour jouer prend une manette (P${took})`);

await player.evaluate(() => document.getElementById("watchOnly")?.click());
await wait(LONGER_THAN_A_RECONNECT);
check(
  (await seatOf(player)) === null,
  `la place est rendue et NON reprise ${LONGER_THAN_A_RECONNECT} ms plus tard`,
);

// Et l'image continue: rendre sa manette n'est pas quitter.
const painting = await player.evaluate(() => globalThis.nel3abTest.counters().painted);
await wait(1200);
check(
  (await player.evaluate(() => globalThis.nel3abTest.counters().painted)) > painting,
  "l'image continue d'arriver pendant qu'on regarde",
);

// ── Reprendre une manette.
await player.evaluate(() => document.getElementById("takePad")?.click());
await wait(2500);
check((await seatOf(player)) !== null, "reprendre une manette rebranche la page");

// ── Une page qui entre DIRECTEMENT pour regarder.
const guest = await openRoom(browser, url, "curieux");
await watchRoom(guest);
await wait(LONGER_THAN_A_RECONNECT);
check(
  (await seatOf(guest)) === null,
  "une page entrée par « regarder » n'a jamais pris de place",
);
check(
  (await guest.evaluate(() => globalThis.nel3abTest.counters().painted)) > 0,
  "et elle voit quand même l'image",
);

await browser.close();
console.log(
  bad === 0
    ? "PASS — on peut regarder sans jouer, et rejouer ensuite"
    : `ÉCHEC — ${bad} vérification(s)`,
);
process.exit(bad === 0 ? 0 : 1);
