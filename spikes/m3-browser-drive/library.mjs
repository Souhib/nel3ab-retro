// What the page shows in its library, with the names a person reads.
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";

// L'adresse en ARGUMENT: le port 8100 n'existe plus depuis que les salles
// ont pris les leurs (8110, 8120, 8130). Un pilote qui l'écrit en dur se
// connecte à rien et meurt sur ECONNREFUSED sans que sa recette le dise.
const url = process.argv[2] ?? process.env.NEL3AB_URL ?? "http://localhost:8110/";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await seedName(page);
await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);
await new Promise((r) => setTimeout(r, 4000));

// Il faut OUVRIR l'étagère avant de lire.
//
// Ce pilote lisait le texte de la page au premier niveau du menu. Depuis que
// les jeux sont rangés par console, ce niveau ne montre que les étagères, et
// les quatre titres GameCube attendus ici vivent derrière `#item-shelf-gc`.
// Le pilote annonçait donc quatre absences qui n'en étaient pas: sa recette
// visait un port mort, personne ne le lançait, et son attente est restée
// derrière le rangement du menu.
const dors = (ms) => new Promise((r) => setTimeout(r, ms));
const menuOuvert = () => page.evaluate(() => document.getElementById("menu") !== null);
if (!(await menuOuvert())) {
  await page.keyboard.press("Escape");
  await dors(1200);
}
if (!(await menuOuvert())) throw new Error("le menu ne s'ouvre pas: rien à lire");
await page.evaluate(() => document.querySelector("#ray-jeux")?.click());
await dors(500);
if (await page.$("#item-shelf-gc")) {
  await page.$eval("#item-shelf-gc", (e) => e.click());
  await dors(700);
}
const text = await page.evaluate(() => document.body.innerText);
let bad = 0;
// La parenthèse de Mario Kart EST le nom du hack: elle doit survivre au nettoyage
// qui retire « (Europe) », « (En,Fr,De,Es,It) » et « (Rev 2) ».
for (const wanted of [
  "Super Smash Bros Melee",
  "Mario Kart Double Dash (Retro Track Grand Prix)",
  "Mario Party 4",
  "Super Mario Strikers",
]) {
  const ok = text.includes(wanted);
  if (!ok) bad += 1;
  console.log(`  ${ok ? "ok    " : "ABSENT"} ${wanted}`);
}
for (const gone of ["v2.1", "melee-ntsc", "melee.rvz", "(Europe)", "En,Fr,De,Es,It", "(Rev 2)", "(USA)"]) {
  const ok = !text.includes(gone);
  if (!ok) bad += 1;
  console.log(`  ${ok ? "ok    " : "ENCORE"} plus de « ${gone} »`);
}
console.log(bad === 0 ? "PASS — la bibliothèque dit ce qu'il faut" : `FAIL — ${bad} écart(s)`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
