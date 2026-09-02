// Screenshot of the pad-map preview page, for iterating on the diagrams.
import puppeteer from "puppeteer";

const URL = process.env.PADMAP_URL ?? "http://localhost:5199/padmap-preview.html";
const OUT = process.argv[2] ?? "/tmp/padmap-preview.png";

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1480, height: 1200, deviceScaleFactor: 1.5 });
await page.goto(URL, { waitUntil: "networkidle0" });
await page.waitForSelector("svg[data-padmap]", { timeout: 10000 });
await page.evaluate(() => { document.getElementById("padmap-sim")?.click(); });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: OUT, fullPage: true });
console.log(`écrit ${OUT}`);
await browser.close();