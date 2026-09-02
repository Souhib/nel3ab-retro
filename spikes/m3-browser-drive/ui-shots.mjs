// Des captures de chaque écran, pour pouvoir en parler sur pièces.
import puppeteer from "puppeteer";
import { enterRoom } from "./open.mjs";

const url = process.env.NEL3AB_URL ?? "http://localhost:8100/";
const out = process.env.NEL3AB_SHOTS ?? "/tmp";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });

const press = (page, css) => page.evaluate((s) => document.querySelector(s)?.click(), css);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

for (const shell of ["ps3", "wii", "switch"]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((chosen) => {
    localStorage.setItem("nel3ab:name", "banc");
    localStorage.setItem("nel3ab:banc", "1");
    localStorage.setItem("nel3ab:shell", chosen);
  }, shell);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await enterRoom(page);
  await wait(3500);
  await page.screenshot({ path: `${out}/ui-${shell}-salle.png` });
  await press(page, "#openMenu");
  await wait(1200);
  await page.screenshot({ path: `${out}/ui-${shell}-menu.png` });
  // Le rayon des réglages, quel qu'il soit: on descend la liste des catégories.
  const rays = await page.evaluate(() =>
    [...document.querySelectorAll("[id^='ray-']")].map((n) => n.id),
  );
  console.log(`  ${shell}: rayons ${rays.join(", ") || "(aucun id ray-*)"}`);
  await page.close();
}

// Et les écrans qui ne sont pas le menu, en PS3.
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem("nel3ab:name", "banc");
    localStorage.setItem("nel3ab:banc", "1");
  localStorage.setItem("nel3ab:shell", "ps3");
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);
await wait(3500);
await press(page, "#openMenu");
await wait(1000);
await press(page, "#item-bindings");
await wait(1200);
await page.screenshot({ path: `${out}/ui-touches.png` });
console.log("  captures écrites dans", out);
await browser.close();
