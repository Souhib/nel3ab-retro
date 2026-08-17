// Un adaptateur GameCube: quatre manettes annoncées, une seule branchée.
//
// C'est la panne rapportée le 2026-08-17, et elle n'a rien d'exotique. Un
// adaptateur de manettes GameCube présente QUATRE manettes au navigateur, une
// par port, même s'il n'y a qu'un pad dedans. La page ne lisait que la première,
// donc trois personnes sur quatre avaient une manette morte et rien pour
// l'expliquer: pas d'erreur, pas de message, juste un pad qui ne fait rien.
//
// Trois choses sont tenues ici:
//
// 1. le pad du TROISIÈME port conduit le menu, sans que personne ait choisi;
// 2. il joue aussi, ce qui est un autre chemin dans le code;
// 3. le clavier marche EN MÊME TEMPS, sans avoir rien désélectionné.
//
// Manettes simulées: ce qui est vérifié est le câblage, pas un pilote USB.
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";

const url = process.argv[2] ?? "http://localhost:8100/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
  if (!ok) bad += 1;
};

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await seedName(page, "adaptateur");
await page.evaluateOnNewDocument(() => {
  const port = (index) => ({
    id: "Nintendo GameCube Controller Adapter (Vendor: 057e Product: 0337)",
    // Un adaptateur n'a pas la disposition standard, comme le vrai.
    mapping: "",
    index,
    connected: true,
    buttons: Array.from({ length: 12 }, () => ({ pressed: false, touched: false, value: 0 })),
    axes: [0, 0, 0, 0, 0, 0],
  });
  globalThis.__ports = [port(0), port(1), port(2), port(3)];
  navigator.getGamepads = () => globalThis.__ports;
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);
await wait(6000);

/** Le pad est dans le TROISIÈME port de l'adaptateur, comme chez n'importe qui. */
const PLUGGED = 2;
const push = (axis, value) =>
  page.evaluate((p, a, v) => { globalThis.__ports[p].axes[a] = v; }, PLUGGED, axis, value);
const seen = () =>
  page.evaluate(() => globalThis.nel3abTest.pads?.() ?? null);

// La liste montrée: un MODÈLE et pas quatre branchements.
const listed = await page.evaluate(() => globalThis.nel3abTest.padList?.() ?? null);
if (listed !== null) {
  check(listed.length === 1, `un seul modèle listé et non quatre (${listed.length})`);
}

const chosen = () =>
  page.evaluate(() => document.querySelector('#menu [data-selected="true"][id^="item-"]')?.id ?? null);
await page.evaluate(() => document.getElementById("openMenu")?.click());
await wait(900);
const first = await chosen();
check(first !== null, `le menu s'ouvre sur « ${first} »`);

// 1. La manette du troisième port descend la croix.
await push(1, 1);
await wait(260);
await push(1, 0);
await wait(500);
const moved = await chosen();
check(moved !== first, `le pad du port ${PLUGGED + 1} déplace le menu (${first} -> ${moved})`);

// 3. Et le clavier fait avancer d'un cran de plus, sans rien désélectionner.
await page.keyboard.press("ArrowDown");
await wait(500);
const both = await chosen();
check(both !== moved, `le clavier avance encore (${moved} -> ${both})`);

await page.evaluate(() => document.getElementById("closeMenu")?.click());
await wait(700);

// 2. Et dans le JEU: ce que la page envoie doit porter la poussée.
const sentBefore = await page.evaluate(() => globalThis.nel3abTest.counters().attempts);
await push(0, 1);
await wait(700);
const reading = await page.evaluate(() => globalThis.nel3abTest.reading?.() ?? null);
await push(0, 0);
const sentAfter = await page.evaluate(() => globalThis.nel3abTest.counters().attempts);
check(sentAfter > sentBefore, "la page envoie toujours au jeu");
if (reading !== null) {
  check(Math.abs(reading.x) > 0.5, `la poussée du port ${PLUGGED + 1} arrive au jeu (x=${reading.x})`);
}

await browser.close();
console.log(
  bad === 0
    ? "PASS — toutes les manettes de l'adaptateur jouent, et le clavier avec"
    : `ÉCHEC — ${bad} vérification(s)`,
);
process.exit(bad === 0 ? 0 : 1);
