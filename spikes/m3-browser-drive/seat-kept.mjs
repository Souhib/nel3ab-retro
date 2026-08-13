// Does a real browser answer a ping while its tab is in the background?
//
// The seat design rests on that answer. If Chrome only pongs while the page is
// being scheduled, asking is no better than a read deadline: a player who
// switches tab loses their controller, which is the bug this replaced.
import { execSync } from "node:child_process";
import puppeteer from "puppeteer";

const url = process.argv[2] ?? "http://localhost:8100/";
const away = Number(process.argv[3] ?? 25) * 1000;
const since = new Date().toISOString();

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const seatOf = (p) => p.evaluate(() => document.getElementById("seat").textContent);

await wait(3000);
const mine = await seatOf(page);
console.log(`took: "${mine}"`);
const port = (mine.match(/joueur (\d)/) ?? [])[1];
if (!port) {
  console.log("FAIL — no controller was free, so nothing was tested");
  await browser.close();
  process.exit(1);
}

const other = await browser.newPage();
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
  `journalctl -u nel3ab-worker --since '${since}' -o cat | grep -c 'stopped answering' || true`,
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
  await next.goto(url, { waitUntil: "domcontentloaded" });
  await wait(1200);
  const seat = await seatOf(next);
  await next.close();
  if (seat.includes(`joueur ${port}`)) {
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
