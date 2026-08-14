// One socket taken by us, one by somebody else, two free: every state at once.
import puppeteer from "puppeteer";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const other = await browser.newPage();
await other.goto("http://localhost:8100/", { waitUntil: "domcontentloaded" });
await wait(2000);
const mine = await browser.newPage();
await mine.setViewport({ width: 1400, height: 820 });
mine.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await mine.goto("http://localhost:8100/", { waitUntil: "domcontentloaded" });
await wait(2500);
console.log(`  l'autre page : ${await other.evaluate(() => document.getElementById("seat").textContent)}`);
console.log(`  cette page   : ${await mine.evaluate(() => document.getElementById("seat").textContent)}`);
console.log(`  panneau      : ${await mine.evaluate(() =>
  [...document.querySelectorAll(".port")].map((b) => b.title.split(" — ")[0]).join(" | "))}`);
await (await mine.$("#ports")).screenshot({ path: "/tmp/claude-1000/-home-souhib-nel3ab-retro/0d1d7749-e76b-413d-af12-878c112fd66e/scratchpad/panel.png" });
await browser.close();
