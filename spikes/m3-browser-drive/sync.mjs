import puppeteer from "puppeteer";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
await page.goto(process.argv[2] ?? "http://localhost:8100/", { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 3000));
await page.click("#sound");
await new Promise((r) => setTimeout(r, 20000));
const out = await page.evaluate(() => {
  const p = globalThis.nel3abTest.pacing();
  const text = document.getElementById("stats").innerText;
  return {
    fastestVideo: p.fastest,
    line: (text.match(/écart son\/image\s+(.+)/) ?? [])[1],
    sound: (text.match(/son\s+(.+)/) ?? [])[1],
    latence: (text.match(/latence ajoutée\s+(.+)/) ?? [])[1],
    lissage: (text.match(/lissage des rafales\s+(.+)/) ?? [])[1],
    outputLatency: (() => 0)(),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
