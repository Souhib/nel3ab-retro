import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
await seedName(page);
await page.goto(process.argv[2] ?? "http://localhost:8100/", { waitUntil: "domcontentloaded" });
await enterRoom(page);
await new Promise((r) => setTimeout(r, 3000));
await page.click("#sound");
await new Promise((r) => setTimeout(r, 20000));
const out = await page.evaluate(() => {
  const p = globalThis.nel3abTest.pacing();
  const audio = globalThis.nel3abTest.audio();
  return {
    fastestVideo: p.fastest,
    ecartSonImage: globalThis.nel3abTest.soundGap(),
    sonEtat: audio.state,
    frequence: audio.sampleRate,
    avancePage: audio.soundLead,
    sortieNavigateur: audio.outputLatency,
    latenceAjoutee: p.slackMs,
    decalageTotal: p.offset,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
