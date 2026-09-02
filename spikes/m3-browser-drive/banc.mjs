// L'écran des deux manettes, photographié avec une manette simulée.
//
// Ce que ça donne à voir et qu'aucun essai ne peut dire: si un chiffre déborde
// de sa case, si une jauge est trop fine pour se voir, si le banc tient à côté
// du schéma. La largeur d'un mot dépend de la police, et la géométrie ne la
// connaît pas.
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";

const url = process.argv[2] ?? "http://localhost:8100/";
const out = process.argv[3] ?? "/tmp/banc.png";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.setViewport({ width: 1500, height: 1150, deviceScaleFactor: 2 });
await seedName(page, "banc");

// Une DualSense, poussée: de quoi voir des jauges pleines, des jauges à moitié
// et des cadrans qui ne pointent pas au même endroit.
await page.evaluateOnNewDocument(() => {
  globalThis.__pad = {
    id: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)",
    mapping: "standard",
    index: 0,
    connected: true,
    get timestamp() { return performance.now(); },
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: i === 0 || i === 12,
      touched: false,
      value: i === 6 ? 0.65 : i === 7 ? 0.28 : i === 0 || i === 12 ? 1 : 0,
    })),
    axes: [0.55, -0.35, -0.2, 0.4],
  };
  navigator.getGamepads = () => [globalThis.__pad];
});

const press = (css) => page.evaluate((s) => document.querySelector(s)?.click(), css);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);
await wait(2500);
await press("#openMenu");
await wait(700);
await press("#ray-reglages");
await wait(500);
await press("#item-bindings");
await wait(700);
await press("#view-schema");
await wait(900);
await page.evaluate(() => document.fonts.ready);
await wait(600);

const panel = await page.$("#bindingsPanel");
await panel.screenshot({ path: out });
console.log(`écrit ${out}`);
await browser.close();
