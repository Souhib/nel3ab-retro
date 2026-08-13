// A page holds the only controller; another takes it with the button.
//
// A page that is merely OPEN holds its port — it sends the neutral pad state on
// every refresh — so a tab forgotten on another machine can keep the only
// controller of the room. Only a person pressing the button may displace it.
import puppeteer from "puppeteer";
const url = process.argv[2] ?? "http://localhost:8100/";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const seatOf = (p) => p.evaluate(() => document.getElementById("seat").textContent);

const first = await browser.newPage();
await first.goto(url, { waitUntil: "domcontentloaded" });
await wait(3000);
const held = await seatOf(first);
console.log(`page 1 : "${held}"`);
// Assert the precondition rather than branch on it: if something else in the
// room already holds the port, page 1 never had one to lose and the check below
// would pass while proving nothing.
if (!/joueur 1/.test(held)) {
  console.log("FAIL — page 1 n'a pas eu la manette, rien n'a été testé");
  await browser.close();
  process.exit(1);
}

const second = await browser.newPage();
await second.goto(url, { waitUntil: "domcontentloaded" });
await wait(3000);
console.log(`page 2 : "${await seatOf(second)}"`);
console.log(`bouton proposé : ${await second.evaluate(() => !document.getElementById("claim").hidden)}`);

await second.click("#claim");
await wait(2500);
const took = await seatOf(second);
console.log(`page 2 après le bouton : "${took}"`);
let lost = "";
for (let i = 0; i < 20; i++) { lost = await seatOf(first); if (/aucune manette/.test(lost)) break; await wait(500); }
console.log(`page 1 ensuite : "${lost}"`);
const ok = /joueur 1/.test(took) && /aucune manette/.test(lost);
console.log(ok ? "PASS — la manette a changé de page, et l'ancienne le sait" : "FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
