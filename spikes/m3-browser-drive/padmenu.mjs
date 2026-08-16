// La manette conduit-elle le menu ?
//
// Manette SIMULÉE: ce qui est vérifié est le câblage entre la boucle d'entrée et
// la croix, pas un pilote USB. Et surtout: ce qu'on pousse dans le menu ne doit
// pas descendre au jeu.
import puppeteer from "puppeteer";
import { enterRoom } from "./open.mjs";

const url = "https://lgf.tail3bd01c.ts.net:8443/";
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

console.log(bad === 0 ? "PASS — la manette conduit le menu, et rien ne descend au jeu" : `FAIL — ${bad} écart(s)`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
