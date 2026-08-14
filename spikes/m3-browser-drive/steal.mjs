// Taking somebody's socket: it must take two clicks, and the person it was taken
// from must be told and left unplugged.
//
// The defect this pins was found by the player. His page was displaced, quietly
// picked up the next free socket three seconds later, and he carried on driving
// a different character with nothing on screen to say so.
import puppeteer from "puppeteer";
const url = process.argv[2] ?? "http://localhost:8100/";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const seatOf = (p) => p.evaluate(() => document.getElementById("seat").textContent);
const labelOf = (p, slot) =>
  p.evaluate((s) => document.querySelector(`#port${s} text`).textContent, slot);

const first = await browser.newPage();
await first.goto(url, { waitUntil: "domcontentloaded" });
await wait(2500);
const held = await seatOf(first);
// Whichever socket it was given, not port 1: this scenario needs ONE free port,
// not an empty room, and asking for more than it needs is how a test ends up
// declining to run while somebody is playing next door.
const slot = Number((held.match(/joueur (\d)/) ?? [])[1]);
if (!slot) {
  console.log(`RIEN TESTÉ — aucun port libre, page 1 a eu "${held}"`);
  await browser.close();
  process.exit(2);
}

const thief = await browser.newPage();
await thief.goto(url, { waitUntil: "domcontentloaded" });
await wait(2500);
console.log(`  page 1 tient le port ${slot} · page 2 : "${await seatOf(thief)}"`);

// One click on an occupied socket must arm it and take nothing.
await thief.click(`#port${slot}`);
await wait(1200);
const armed = await labelOf(thief, slot);
const stillFirst = await seatOf(first);
console.log(`  après un clic : la prise dit "${armed}", page 1 dit "${stillFirst}"`);
const armedOk =
  armed.includes("PRENDRE") && new RegExp(`joueur ${slot}`).test(stillFirst);

// The second click takes it.
await thief.click(`#port${slot}`);
await wait(2500);
const took = await seatOf(thief);
let lost = "";
for (let i = 0; i < 20; i++) {
  lost = await seatOf(first);
  if (/a pris ton port/.test(lost)) break;
  await wait(500);
}
console.log(`  après deux clics : page 2 dit "${took}"\n  page 1 dit "${lost}"`);

// And the displaced page must NOT have quietly plugged itself in elsewhere.
await wait(6000);
const after = await seatOf(first);
const stayedOut = !/joueur \d/.test(after);
console.log(`  page 1 six secondes plus tard : "${after}"`);

const ok = armedOk && new RegExp(`joueur ${slot}`).test(took) && /a pris ton port/.test(lost) && stayedOut;
console.log(
  ok
    ? "PASS — deux clics pour prendre, et le joueur délogé est prévenu et reste débranché"
    : `FAIL — ${!armedOk ? "un seul clic a suffi" : !stayedOut ? "la page délogée s'est rebranchée toute seule" : "la prise n'a pas changé de main"}`,
);
await browser.close();
process.exit(ok ? 0 : 1);
