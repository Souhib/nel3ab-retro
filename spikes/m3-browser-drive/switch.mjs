// Démarre le jeu à cette position. REDÉMARRE la session, comme le ferait un clic.
import puppeteer from "puppeteer";
import { enterRoom, seatOf, seedName } from "./open.mjs";
const url = process.argv[2] ?? "http://localhost:8100/";
const target = Number(process.argv[3]);
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await seedName(page, "bascule");
await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);
await new Promise((r) => setTimeout(r, 3000));
if ((await seatOf(page)) === null) {
  console.log("RIEN FAIT — pas de manette, donc pas le droit de changer de jeu");
  await browser.close();
  process.exit(2);
}
await page.click(`#game${target}`);
await new Promise((r) => setTimeout(r, 800));
await page.click(`#game${target}`);
await new Promise((r) => setTimeout(r, 1500));
await browser.close();
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  try {
    const found = await (await fetch(new URL("/roms", url))).json();
    if (found.current === target) {
      console.log(`démarré : ${found.roms[target]}`);
      process.exit(0);
    }
  } catch { /* la salle redémarre */ }
}
console.log("le jeu n'a pas démarré");
process.exit(1);
