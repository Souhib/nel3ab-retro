// Taking somebody's socket: it must take two clicks, and the person it was taken
// from must be told and left unplugged.
//
// The defect this pins was found by the player. His page was displaced, quietly
// picked up the next free socket three seconds later, and he carried on driving
// a different character with nothing on screen to say so.
import puppeteer from "puppeteer";
import { displacedOn, enterRoom, seatOf, seedName } from "./open.mjs";
const url = process.argv[2] ?? "http://localhost:8100/";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** La prise est-elle armée ? Un attribut de données, pas un libellé: une prise
 * qu'on reformule ne doit pas casser un essai sur la confirmation. */
const armedOn = (p, slot) =>
  p.evaluate((s) => document.getElementById(`port${s}`)?.dataset.armed === "true", slot);

const first = await browser.newPage();

await seedName(first);
await first.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(first);
await wait(2500);
const held = await seatOf(first);
// Whichever socket it was given, not port 1: this scenario needs ONE free port,
// not an empty room, and asking for more than it needs is how a test ends up
// declining to run while somebody is playing next door.
const slot = held;
if (!slot) {
  console.log(`RIEN TESTÉ — aucun port libre, page 1 a eu "${held}"`);
  await browser.close();
  process.exit(2);
}

const thief = await browser.newPage();

await seedName(thief);
await thief.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(thief);
await wait(2500);
console.log(`  page 1 tient le port ${slot} · page 2 : "${await seatOf(thief)}"`);

// One click on an occupied socket must arm it and take nothing.
await thief.click(`#port${slot}`);
await wait(1200);
const armed = await armedOn(thief, slot);
const stillFirst = await seatOf(first);
console.log(`  après un clic : prise armée ${armed}, page 1 tient toujours ${stillFirst}`);
const armedOk =
  armed && stillFirst === slot;

// The second click takes it.
await thief.click(`#port${slot}`);
await wait(2500);
const took = await seatOf(thief);
// La page délogée doit le DIRE, pas seulement perdre sa place en silence.
let lost = false;
for (let i = 0; i < 20; i++) {
  lost = await displacedOn(first);
  if (lost) break;
  await wait(500);
}
console.log(`  après deux clics : page 2 tient ${took}, page 1 prévenue: ${lost}`);

// And the displaced page must NOT have quietly plugged itself in elsewhere.
await wait(6000);
const after = await seatOf(first);
const stayedOut = after === null;
console.log(`  page 1 six secondes plus tard : "${after}"`);

const ok = armedOk && took === slot && lost && stayedOut;
console.log(
  ok
    ? "PASS — deux clics pour prendre, et le joueur délogé est prévenu et reste débranché"
    : `FAIL — ${!armedOk ? "un seul clic a suffi" : !stayedOut ? "la page délogée s'est rebranchée toute seule" : "la prise n'a pas changé de main"}`,
);
await browser.close();
process.exit(ok ? 0 : 1);
