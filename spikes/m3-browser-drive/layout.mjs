// Are the numbers beside the picture, or under it, at the widths people use?
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";
// L'adresse en ARGUMENT, comme chez ses pairs.
//
// Elle était écrite en dur dans l'appel de navigation, donc ni un argument ni
// `NEL3AB_URL` ne pouvait la changer. Le port 8100 n'existe plus depuis que
// les salles ont pris les leurs (8110, 8120, 8130): le pilote se connectait à
// rien, mourait sur `ERR_CONNECTION_REFUSED`, et la recette n'en disait rien.
const url = process.argv[2] ?? process.env.NEL3AB_URL ?? "http://localhost:8110/";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await seedName(page);
let bad = 0;
for (const [width, height] of [[1920, 1080], [1512, 945], [1280, 800], [1100, 800]]) {
  await page.setViewport({ width, height });
  await page.goto(url, { waitUntil: "domcontentloaded" });
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
