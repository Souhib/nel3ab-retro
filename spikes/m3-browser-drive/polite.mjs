// A refused page must keep asking — politely, and not too often. Counted in the
// page itself: the server's log cannot tell my attempts from anybody else's.
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

// La porte du JOUEUR, et son état, AVANT de la pousser.
//
// Sur une salle pleine, `#enter` porte « salle pleine » et il est DÉSACTIVÉ:
// le clic est absorbé, `#screen` n'arrive jamais, et `enterRoom` expirait au
// bout de quinze secondes dans une aide, sans dire un mot de la salle. Un
// pilote qui meurt dans un helper n'apprend rien à personne.
await page.waitForSelector("#enter", { timeout: 15000 });
const porte = await page.evaluate(() => {
  const node = document.getElementById("enter");
  return { texte: node.textContent.trim(), fermee: node.disabled };
});
if (porte.fermee) {
  console.log(`RIEN TESTÉ — la porte joueur est fermée (« ${porte.texte} »).`);
  console.log("  Ce pilote veut une page REFUSÉE qui continue de demander une place.");
  console.log("  Mesuré le 13 septembre 2026 sur une salle pleine: entrer par");
  console.log("  « regarder » donne seat=null et 0 demande en 12 s, parce qu'un");
  console.log("  spectateur n'ouvre pas la socket d'entrée. Le scénario d'origine");
  console.log("  n'est donc pas reproductible par cette porte-ci.");
  await browser.close();
  process.exit(1);
}
await enterRoom(page);
await new Promise((r) => setTimeout(r, 2000));
const start = await page.evaluate(() => globalThis.nel3abTest.counters().attempts);
const seat = await page.evaluate(() => globalThis.nel3abTest.seat());
await new Promise((r) => setTimeout(r, 12000));
const asks = (await page.evaluate(() => globalThis.nel3abTest.counters().attempts)) - start;
await browser.close();
// `seat()` rend un NUMÉRO de place, ou `null`. « aucune manette » est une
// chaîne d'AFFICHAGE (`Bench.tsx`, et la traduction du port 0 épinglée par
// `media/input.test.ts`), que cette fonction n'a jamais rendue. Le test la
// cherchait dans une valeur numérique, donc il refusait toujours.
if (seat !== null) {
  console.log(`place ${seat} obtenue — la salle n'était pas pleine, rien n'a été testé`);
  process.exit(1);
}
console.log(`"${seat}" · ${asks} demandes en 12 s`);
console.log(asks >= 2 && asks <= 6
  ? "PASS — elle redemande toutes les trois secondes, sans marteler"
  : `FAIL — ${asks} demandes: ${asks < 2 ? "elle a renoncé" : "elle martèle"}`);
process.exit(asks >= 2 && asks <= 6 ? 0 : 1);
