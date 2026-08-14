// Does the checkbox move the picture, and how fast?
import puppeteer from "puppeteer";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(process.argv[2] ?? "http://localhost:8100/", { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 3000));
await page.click("#sound");
await new Promise((r) => setTimeout(r, 12000));

// Assert the precondition rather than let it produce a confusing failure: the
// box computes its delay from the measured sound/picture gap, so with no sound
// yet measured it correctly does nothing, and the assertion below would blame
// the box for it. Seen once, right after a restart.
const measured = await page.evaluate(
  () => document.getElementById("stats").innerText.includes("écart son/image      —") === false,
);
if (!measured) {
  console.log("FAIL — aucun écart mesuré encore, la case n'avait rien à appliquer");
  await browser.close();
  process.exit(1);
}

const held = () => page.evaluate(() => globalThis.nel3abTest.pacing().offset);
const before = await held();
await page.click("#lipsync");
await new Promise((r) => setTimeout(r, 1500));
const after = await held();
const line = await page.evaluate(() => document.getElementById("stats").innerText.match(/écart son\/image\s+(.+)/)?.[1]);
await page.click("#lipsync");
await new Promise((r) => setTimeout(r, 1500));
const back = await held();

const applied = after - before;
const returned = after - back;
console.log(`  décalage appliqué en 1,5 s : ${applied.toFixed(1)} ms · rendu en 1,5 s : ${returned.toFixed(1)} ms`);
console.log(`  ${line}`);
// Both directions must act within a second and a half, which is the point: the
// steering that follows the network moves 5 ms per two seconds, and answering a
// click at that speed reads as a dead control. The two numbers are not equal
// because that steering keeps working during the measurement — asserting that
// they match would be asserting that the rest of the page stood still.
const ok = applied > 20 && returned > 20;
console.log(ok ? "PASS — la case déplace l'image tout de suite, et la remet" : "FAIL — la case ne fait rien d'immédiat");
await browser.close();
process.exit(ok ? 0 : 1);
