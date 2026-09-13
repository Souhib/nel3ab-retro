// Does a real browser answer a ping while its tab is in the background?
//
// The seat design rests on that answer. If Chrome only pongs while the page is
// being scheduled, asking is no better than a read deadline: a player who
// switches tab loses their controller, which is the bug this replaced.
import { execSync } from "node:child_process";
import puppeteer from "puppeteer";
import { enterRoom, salleDe, seatOf, seedName } from "./open.mjs";

const url = process.argv[2] ?? "http://localhost:8110/";
const away = Number(process.argv[3] ?? 25) * 1000;

/** Le numéro de la salle, lu dans l'adresse, pour viser la BONNE unité.
 *
 * `journalctl -u nel3ab-worker` visait l'unité d'avant la bascule multi-salles,
 * qui est « loaded inactive dead » depuis que les salles sont trois: ce pilote
 * lisait donc un journal vide et comptait zéro plainte, quoi qu'il arrive.
 * `[1-9]` et non `\d`: le port mort `8100` donnerait la salle zéro.
 */
const numero = salleDe(url);
if (numero === null) {
  console.log(`RIEN MESURÉ — impossible de déduire le numéro de salle de « ${url} ».`);
  process.exit(1);
}
const UNITE = `nel3ab-worker@${numero}`;
const since = new Date().toISOString();

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await seedName(page);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
await enterRoom(page);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await wait(3000);
const mine = await seatOf(page);
console.log(`took: "${mine}"`);
const port = mine;
if (!port) {
  // Abstention, pas échec: cet essai demande une manette libre, et quelqu'un qui
  // joue à côté n'est pas un défaut. Rapporter un échec ici apprend à ignorer
  // les échecs de ce fichier.
  console.log("RIEN TESTÉ — aucune manette libre, la salle n'était pas vide");
  await browser.close();
  process.exit(2);
}

const other = await browser.newPage();

await seedName(other);
await other.goto("about:blank");
await other.bringToFront();
console.log(`hidden: ${await page.evaluate(() => document.hidden)} — staying away ${away / 1000}s`);
await wait(away);

await page.bringToFront();
await wait(1500);
const afterwards = await seatOf(page);

// The server's own account of it: a page that had been declared dead would have
// been logged as such, and would have come back on a different port.
const log = execSync(
  `journalctl -u ${UNITE} --since '${since}' -o cat | grep -c 'stopped answering' || true`,
).toString().trim();

console.log(`after coming back: "${afterwards}" · server declared ${log} controller(s) gone`);
const kept = afterwards === mine && log === "0";
console.log(
  kept
    ? `PASS — a backgrounded browser answers pings and keeps port ${port}`
    : `FAIL — the port was taken from a player who had merely switched away`,
);

// The other half, and the one the player asked for by name: leaving the tab
// keeps the controller, CLOSING it must give it back. Not after fifteen
// seconds — a closed tab closes its socket, and that is immediate.
await page.close();
let regained = null;
const deadline = Date.now() + 5000;
while (Date.now() < deadline) {
  const next = await browser.newPage();
  await seedName(next);
  await next.goto(url, { waitUntil: "domcontentloaded" });
  await enterRoom(next);
  await wait(1200);
  const seat = await seatOf(next);
  await next.close();
  if (seat === port) {
    regained = seat;
    break;
  }
}
const freed = regained !== null;
console.log(
  freed
    ? `PASS — a closed tab gave port ${port} straight back ("${regained}")`
    : `FAIL — port ${port} was still held after its tab was closed`,
);
await browser.close();
process.exit(kept && freed ? 0 : 1);
