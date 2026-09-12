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
await enterRoom(page);
await new Promise((r) => setTimeout(r, 2000));
const start = await page.evaluate(() => globalThis.nel3abTest.counters().attempts);
const seat = await page.evaluate(() => globalThis.nel3abTest.seat());
await new Promise((r) => setTimeout(r, 12000));
const asks = (await page.evaluate(() => globalThis.nel3abTest.counters().attempts)) - start;
await browser.close();
if (!/aucune manette/.test(seat)) {
  console.log(`"${seat}" — la salle n'était pas pleine, rien n'a été testé`);
  process.exit(1);
}
console.log(`"${seat}" · ${asks} demandes en 12 s`);
console.log(asks >= 2 && asks <= 6
  ? "PASS — elle redemande toutes les trois secondes, sans marteler"
  : `FAIL — ${asks} demandes: ${asks < 2 ? "elle a renoncé" : "elle martèle"}`);
process.exit(asks >= 2 && asks <= 6 ? 0 : 1);
