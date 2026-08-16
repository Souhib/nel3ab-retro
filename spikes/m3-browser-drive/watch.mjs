// Ce que la page rend, sur une minute, sans rien redémarrer.
//
// Un spectateur de plus, comme celui du banc, mais qui ne touche ni au service
// ni à la session : il peut donc tourner pendant que quelqu'un joue. Ce qu'il
// mesure est le côté navigateur — tenue de l'image, marge d'affichage, reprises —
// c'est-à-dire exactement la moitié que le passage de React pouvait dégrader.
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";

const url = process.argv[2] ?? "http://localhost:8100/";
const seconds = Number(process.argv[3] ?? 60);

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await seedName(page, "banc-mesure");
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);

// Chauffe : l'horaire d'affichage se pose en une vingtaine de secondes.
await new Promise((r) => setTimeout(r, 20000));
const before = await page.evaluate(() => globalThis.nel3abTest.counters());
const startedAt = Date.now();
await new Promise((r) => setTimeout(r, seconds * 1000));
const after = await page.evaluate(() => globalThis.nel3abTest.counters());
const pacing = await page.evaluate(() => globalThis.nel3abTest.pacing());
const elapsed = (Date.now() - startedAt) / 1000;
await browser.close();

const painted = after.painted - before.painted;
const shown = after.shown - before.shown;
console.log(`  fenêtre            : ${elapsed.toFixed(1)} s`);
console.log(`  images arrivées    : ${shown} (${(shown / elapsed).toFixed(1)}/s)`);
console.log(`  images peintes     : ${painted} (${(painted / elapsed).toFixed(1)}/s)`);
console.log(`  tenue médiane      : ${pacing.holds[0]} rafraîchissement(s)`);
console.log(`  marge d'affichage  : ${pacing.slackMs.toFixed(1)} ms`);
console.log(`  file d'attente     : ${pacing.queue}`);
console.log(`  socket muette      : ${after.stalls - before.stalls}`);
console.log(`  décodeur relancé   : ${after.restarts - before.restarts}`);
console.log(`  non décodé         : ${after.undecoded - before.undecoded}`);
