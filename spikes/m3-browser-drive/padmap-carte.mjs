// Capture une seule manette de l'aperçu, en grand. usage: padmap-carte.mjs <id> <sortie> [query], avec Vite sur 5297 (`npx vite --port 5297` dans front)
import puppeteer from "puppeteer";
const [id, out, query = ""] = process.argv.slice(2);
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1480, height: 1600, deviceScaleFactor: 2.5 });
await page.goto(`http://localhost:5297/padmap-preview.html${query}`, { waitUntil: "networkidle0" });
await page.waitForSelector(`svg[data-padmap="${id}"]`);
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 400));
const el = await page.$(`svg[data-padmap="${id}"]`);
await (await el.evaluateHandle((n) => n.closest("figure"))).screenshot({ path: out });
await browser.close();
