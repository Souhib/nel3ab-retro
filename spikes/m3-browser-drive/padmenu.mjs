// La manette conduit-elle le menu ?
//
// Manette SIMULÉE: ce qui est vérifié est le câblage entre la boucle d'entrée et
// la croix, pas un pilote USB. Et surtout: ce qu'on pousse dans le menu ne doit
// pas descendre au jeu.
import puppeteer from "puppeteer";
import { enterRoom, ROOM_URL } from "./open.mjs";

const url = ROOM_URL;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const say = (ok, line) => { if (!ok) bad += 1; console.log(`  ${ok ? "ok    " : "FAUX  "} ${line}`); };

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"], acceptInsecureCerts: true, protocolTimeout: 30000 });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  globalThis.__pad = {
    id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)",
    mapping: "standard", index: 0, connected: true,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
  navigator.getGamepads = () => [globalThis.__pad];
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);
await wait(9000);

const chosen = () => page.evaluate(() =>
  document.querySelector('#menu [data-selected="true"][id^="item-"]')?.id ?? null);
const push = (axis, value) => page.evaluate((a, v) => { globalThis.__pad.axes[a] = v; }, axis, value);
const tap = (index) => page.evaluate((i) => {
  globalThis.__pad.buttons[i] = { pressed: true, touched: true, value: 1 };
  setTimeout(() => { globalThis.__pad.buttons[i] = { pressed: false, touched: false, value: 0 }; }, 80);
}, index);

await page.evaluate(() => document.getElementById("openMenu")?.click());
await wait(800);
const first = await chosen();
say(first !== null, `le menu s'ouvre sur « ${first} »`);

// Bas sur le stick gauche: l'axe 1 est vers le bas quand il est positif.
await push(1, 1);
await wait(250);
await push(1, 0);
await wait(400);
const second = await chosen();
say(second !== first, `un cran vers le bas: « ${first} » → « ${second} »`);

// Tenu, ça répète — mais pas vingt fois pour une poussée.
await push(1, 1);
await wait(900);
await push(1, 0);
await wait(400);
const third = await chosen();
say(third !== second, `tenu, ça répète (« ${third} »)`);

// Ce qu'on pousse dans le menu ne descend pas au jeu.
const before = await page.evaluate(() => globalThis.nel3abTest.counters().attempts);
await push(1, 1);
await tap(0);
await wait(600);
await push(1, 0);
const after = await page.evaluate(() => globalThis.nel3abTest.counters().attempts);
say(after > before, `la page continue d'envoyer pendant le menu (${after - before} trames, en neutre)`);

// B revient en arrière, donc referme le menu.
await tap(1);
await wait(700);
say(await page.evaluate(() => document.getElementById("menu") === null), "B referme le menu");

// ── Le clavier, sur une page SANS manette ────────────────────────────────
//
// C'est la moitié qui compte, et elle demande une autre page: tant qu'une
// manette est branchée, la boucle d'entrée lit la manette et jamais le clavier.
// Le doublon n'existait donc QUE sans manette, et un essai avec une manette
// simulée passait à côté en donnant l'air de vérifier.
//
// Il y a eu deux chemins pour une touche — le gestionnaire du menu et la boucle
// d'entrée — et une flèche bas avançait de deux crans. Compter les crans est le
// seul moyen de voir une addition: « ça bouge » passait très bien.
const clavier = await browser.newPage();
await clavier.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(clavier);
await wait(6000);
await clavier.evaluate(() => document.getElementById("openMenu")?.click());
await wait(800);

const seen = () => clavier.evaluate(() => {
  const ids = [...document.querySelectorAll('#menu [id^="item-"]')].map((el) => el.id);
  const here = document.querySelector('#menu [data-selected="true"][id^="item-"]')?.id ?? "";
  return ids.indexOf(here);
});

await clavier.keyboard.press("ArrowDown");
await wait(500);
const oneDown = await seen();
say(oneDown === 1, `une flèche bas avance d'exactement un cran (0 → ${oneDown})`);

await clavier.keyboard.press("ArrowDown");
await wait(500);
const twoDown = await seen();
say(twoDown === 2, `la suivante aussi (${oneDown} → ${twoDown})`);

await clavier.keyboard.press("ArrowUp");
await wait(500);
const backUp = await seen();
say(backUp === 1, `et la flèche haut revient d'un cran (${twoDown} → ${backUp})`);

// ── Changer de console depuis N'IMPORTE quelle console ───────────────────
//
// Le défaut: en mode rangée, gauche et droite parcourent la file, donc pousser à
// droite sur « menu » changeait de page au lieu de changer de menu. Un réglage
// doit se régler pareil partout, et « A » est partout.
for (const from of ["switch", "wii", "taverne"]) {
  await clavier.evaluate((id) => localStorage.setItem("nel3ab:shell", id), from);
  await clavier.reload({ waitUntil: "domcontentloaded" });
  await enterRoom(clavier);
  await wait(5000);
  await clavier.evaluate(() => document.getElementById("openMenu")?.click());
  await wait(700);
  await clavier.evaluate(() => document.getElementById("ray-reglages")?.click());
  await wait(500);
  // « A » ouvre le sélecteur des consoles, et on désigne une console PRÉCISE.
  //
  // Précise et non « la suivante »: une liste ne boucle pas, donc partir de la
  // dernière et pousser vers le bas ne va nulle part. Un pilote qui suppose le
  // contraire échoue sur une seule des quatre, ce qui ressemble à un défaut et
  // n'en est pas un.
  const wanted = from === "ps3" ? "wii" : "ps3";
  await clavier.evaluate(() => document.getElementById("item-shell")?.click());
  await wait(600);
  await clavier.evaluate((id) => document.getElementById(`pick-${id}`)?.click(), wanted);
  await wait(700);
  const now = await clavier.evaluate(() => localStorage.getItem("nel3ab:shell"));
  say(now === wanted, `depuis ${from}, le sélecteur mène à ${wanted} (→ ${now})`);
}

console.log(bad === 0 ? "PASS — la manette conduit le menu, et une touche vaut un cran" : `FAIL — ${bad} écart(s)`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
