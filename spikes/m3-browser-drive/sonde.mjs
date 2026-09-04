import puppeteer from "puppeteer";
import { enterRoom } from "./open.mjs";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem("nel3ab:name", "banc"); localStorage.setItem("nel3ab:banc", "1");
  localStorage.setItem("nel3ab:shell", "ps3");
});
await page.goto("http://localhost:8100/", { waitUntil: "domcontentloaded" });
await enterRoom(page); await wait(3500);

const look = () => page.evaluate(() => {
  const c = globalThis.nel3abTest?.counters?.() ?? {};
  const p = globalThis.nel3abTest?.pacing?.() ?? {};
  const canvas = document.getElementById("screen");
  let lit = 0;
  if (canvas instanceof HTMLCanvasElement) {
    const ink = canvas.getContext("2d", { willReadFrequently: true });
    if (ink) {
      const d = ink.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let at = 0; at < d.length; at += 4 * 977) lit += d[at] + d[at + 1] + d[at + 2];
    }
  }
  return { t: Math.round(performance.now()), booting: document.getElementById("booting") !== null,
           painted: c.painted ?? 0, restarts: c.restarts ?? 0, undecoded: c.undecoded ?? 0,
           queue: p.queue ?? 0, lit };
});

// On lance, puis on regarde toutes les 500 ms pendant une minute.
await page.evaluate(() => document.querySelector("#openMenu")?.click());
await wait(1200);
await page.evaluate(() => document.querySelector("#item-shelf-gc")?.click());
await wait(900);
const target = await page.evaluate(() =>
  [...document.querySelectorAll("[id^='item-game']")].map((n) => Number(n.id.slice(9)))[0]);
await page.evaluate((i) => document.getElementById(`item-game${i}`)?.click(), target);
await wait(1200);
await page.evaluate(() => document.querySelector('[id^="pick-"]')?.click());
const zero = Date.now();
console.log(`  demandé le jeu ${target}\n`);
console.log("   t(s)  chargement  peintes  relances  non-déc  file  luminosité");
let last = null;
for (let n = 0; n < 120; n++) {
  await wait(500);
  let s; try { s = await look(); } catch { console.log("   page absente"); continue; }
  const dt = ((Date.now() - zero) / 1000).toFixed(1);
  const key = `${s.booting}|${s.restarts}|${s.painted > (last?.painted ?? -1)}|${s.lit > 40000}`;
  if (!last || key !== last.key || n % 20 === 0) {
    console.log(`  ${dt.padStart(5)}  ${(s.booting ? "OUI" : "non").padStart(10)}  ${String(s.painted).padStart(7)}  ${String(s.restarts).padStart(8)}  ${String(s.undecoded).padStart(7)}  ${String(s.queue).padStart(4)}  ${s.lit}`);
  }
  last = { ...s, key };
}
await browser.close();
