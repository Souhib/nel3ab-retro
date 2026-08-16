// The two arrangements, one after the other, on the same stream.
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
await seedName(page);
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(process.argv[2] ?? "http://localhost:8100/", { waitUntil: "domcontentloaded" });
await enterRoom(page);
await new Promise((r) => setTimeout(r, 2500));
await page.click("#sound");

const look = async (label) => {
  await new Promise((r) => setTimeout(r, 12000));
  const out = await page.evaluate(() => {
    const audio = globalThis.nel3abTest.audio();
    const gap = globalThis.nel3abTest.soundGap();
    return {
      gap: gap === null ? "écart son/image —" : `écart son/image ${gap.toFixed(0)} ms`,
      son: `${audio.state} · ${audio.sampleRate} Hz · sortie ${(audio.outputLatency * 1000).toFixed(0)} ms · ${audio.gaps} coupures`,
      played: globalThis.nel3abTest.counters().soundPlayed,
    };
  });
  console.log(`  ${label}\n    ${out.gap}\n    ${out.son}`);
  return out;
};
await look("48 kHz imposés");
await page.click("#deviceRate");
await look("fréquence du matériel");
await browser.close();
