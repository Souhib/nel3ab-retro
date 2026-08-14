// The two arrangements, one after the other, on the same stream.
import puppeteer from "puppeteer";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(process.argv[2] ?? "http://localhost:8100/", { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 2500));
await page.click("#sound");

const look = async (label) => {
  await new Promise((r) => setTimeout(r, 12000));
  const out = await page.evaluate(() => {
    const text = document.getElementById("stats").innerText;
    const counters = globalThis.nel3abTest.counters();
    return {
      gap: (text.match(/écart son\/image\s+(.+)/) ?? [])[1],
      son: (text.match(/son\s+(.+)/) ?? [])[1],
      played: counters.soundPlayed,
    };
  });
  console.log(`  ${label}\n    ${out.gap}\n    ${out.son}`);
  return out;
};
await look("48 kHz imposés");
await page.click("#deviceRate");
await look("fréquence du matériel");
await browser.close();
