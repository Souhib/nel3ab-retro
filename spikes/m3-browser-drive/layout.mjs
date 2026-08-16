// Are the numbers beside the picture, or under it, at the widths people use?
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await seedName(page);
let bad = 0;
for (const [width, height] of [[1920, 1080], [1512, 945], [1280, 800], [1100, 800]]) {
  await page.setViewport({ width, height });
  await page.goto("http://localhost:8100/", { waitUntil: "domcontentloaded" });
  await enterRoom(page);
  await new Promise((r) => setTimeout(r, 1200));
  const out = await page.evaluate(() => {
    const screen = document.getElementById("screen").getBoundingClientRect();
    const side = document.getElementById("side").getBoundingClientRect();
    return { beside: side.left >= screen.right - 1, bottom: side.bottom, height: window.innerHeight };
  });
  const ok = out.beside && out.bottom <= out.height;
  if (!ok) bad += 1;
  console.log(`  ${width}×${height} : ${out.beside ? "à droite" : "EN DESSOUS"}, ` +
    `${out.bottom <= out.height ? "sans défilement" : `il faut défiler de ${Math.round(out.bottom - out.height)} px`}`);
}
console.log(bad === 0 ? "PASS — les chiffres restent à droite et visibles" : `FAIL — ${bad} largeur(s) obligent à défiler`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
