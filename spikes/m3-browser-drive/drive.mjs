// Drives the worker's page in a real browser, ON the server, so `localhost` is
// a secure context and WebCodecs exists. Reports what the page says about
// itself and leaves a screenshot to look at.
import puppeteer from "puppeteer";

const url = process.argv[2] ?? "http://localhost:8100/";
const seconds = Number(process.argv[3] ?? 12);

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--enable-features=SharedArrayBuffer"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 700 });

page.on("console", (m) => console.log(`[console.${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) =>
  console.log(`[requestfailed] ${r.url()} — ${r.failure()?.errorText}`),
);

console.log(`opening ${url}`);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
console.log("WebCodecs present:", await page.evaluate(() => "VideoDecoder" in window));

// Press some keys, so the input path is exercised rather than only the video.
await new Promise((r) => setTimeout(r, (seconds * 1000) / 2));
const keys = process.env.NO_INPUT ? [] : ["ArrowRight", "KeyX", "Enter"];
for (const key of keys) {
  await page.keyboard.down(key);
  await new Promise((r) => setTimeout(r, 400));
  await page.keyboard.up(key);
}
await new Promise((r) => setTimeout(r, (seconds * 1000) / 2));

console.log("--- what the page reports ---");
console.log(await page.evaluate(() => document.getElementById("stats")?.innerText ?? "(no stats)"));
console.log("--- canvas ---");
console.log(
  await page.evaluate(() => {
    const canvas = document.getElementById("screen");
    if (!canvas) return "no canvas";
    const ctx = canvas.getContext("2d");
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4 * 97) {
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return `${canvas.width}x${canvas.height}, ${seen.size} distinct sampled colours`;
  }),
);
await page.screenshot({ path: process.env.SHOT ?? "shot.png" });
console.log("screenshot:", process.env.SHOT ?? "shot.png");
await browser.close();
