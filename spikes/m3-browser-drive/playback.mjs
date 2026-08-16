// Does the PAGE play what it receives, on its own schedule?
//
// Chrome will not start an AudioContext without a gesture, which is the right
// behaviour and makes the page untestable without a flag. The flag is the only
// thing this test fakes; everything below it is the page's own code.
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";
const url = process.argv[2] ?? "http://localhost:8100/";
const seconds = Number(process.argv[3] ?? 12);

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
await seedName(page);
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);
await new Promise((r) => setTimeout(r, 3000));
await page.click("#sound");
await new Promise((r) => setTimeout(r, 1500));

const read = () => page.evaluate(() => globalThis.nel3abTest.counters());
const before = await read();
const startedAt = Date.now();
await new Promise((r) => setTimeout(r, seconds * 1000));
const after = await read();
const elapsed = (Date.now() - startedAt) / 1000;

// Seconds of sound against seconds of clock. Counting CHUNKS is what the first
// version did, and it broke the day the chunk was halved while the behaviour it
// meant to check was untouched.
const played = after.soundPlayed - before.soundPlayed;
const gaps = after.soundGaps - before.soundGaps;
const state = await page.evaluate(() => globalThis.nel3abTest.audio().state);
console.log(
  `  contexte ${state} · ${played.toFixed(2)} s de son joués en ${elapsed.toFixed(2)} s · ${gaps} coupures`,
);
const paced = Math.abs(played - elapsed) < elapsed * 0.05;
const smooth = gaps <= 1;
console.log(paced && smooth ? "PASS — le son joue à la vitesse du temps" : `FAIL — ${!paced ? "mauvaise vitesse" : `${gaps} coupures`}`);
await browser.close();
process.exit(paced && smooth ? 0 : 1);
