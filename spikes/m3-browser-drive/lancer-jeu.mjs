// Lance un jeu dans une salle ouverte et vide, comme une personne le ferait.
//
// Pour les bancs qui ont besoin d'un jeu qui tourne et de PERSONNE dans la salle,
// comme `just banc-liaison`: la page entre, prend la manette que la salle vide
// lui donne, passe par le menu et la préparation, puis s'en va. Le jeu continue.
//
// Le chemin est celui de `games.mjs`, sans ses assertions: ici on veut un jeu qui
// tourne, pas la preuve qu'un clic ne suffit pas.
import puppeteer from "puppeteer";
import { enterRoom, launchPrepared, seedName } from "./open.mjs";

const url = process.argv[2] ?? "http://localhost:8110/";
const wanted = process.argv[3] ?? "Mario Power Tennis";
const roms = async () => (await fetch(new URL("roms", url))).json();

const before = await roms();
const index = before.roms.findIndex((rom) => (rom.name ?? rom) === wanted);
if (index < 0) throw new Error(`« ${wanted} » n'est pas dans la bibliothèque`);
if (before.current === index) {
  console.log(`déjà lancé: ${wanted}`);
  process.exit(0);
}

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await seedName(page, "banc-lanceur");
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await enterRoom(page);
  await new Promise((r) => setTimeout(r, 3000));
  const press = (css) => page.evaluate((s) => document.querySelector(s)?.click(), css);
  await press("#openMenu");
  await new Promise((r) => setTimeout(r, 1500));
  // L'étagère d'abord: les jeux ne sont désignables qu'à l'intérieur.
  const shelves = await page.evaluate(() =>
    [...document.querySelectorAll("[id^='item-shelf-']")].map((n) => n.id),
  );
  let found = false;
  for (const shelf of shelves) {
    await press(`#${shelf}`);
    await new Promise((r) => setTimeout(r, 900));
    if (await page.evaluate((i) => document.getElementById(`item-game${i}`) !== null, index)) {
      found = true;
      break;
    }
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 600));
  }
  if (!found) throw new Error(`aucune étagère ne montre « ${wanted} » (vu ${shelves.join(", ")})`);
  await press(`#item-game${index}`);
  await new Promise((r) => setTimeout(r, 1500));
  await launchPrepared(page, () => press(`#item-game${index}`));
  await new Promise((r) => setTimeout(r, 1500));
} finally {
  await browser.close();
}

for (let attempt = 0; attempt < 40; attempt++) {
  await new Promise((r) => setTimeout(r, 1500));
  try {
    if ((await roms()).current === index) {
      console.log(`lancé: ${wanted}`);
      process.exit(0);
    }
  } catch {
    // La salle redémarre, le port ne répond pas encore.
  }
}
console.log(`ÉCHEC: « ${wanted} » ne tourne pas après une minute`);
process.exit(1);
