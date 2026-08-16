// A page holds the only controller; another takes it with the button.
//
// A page that is merely OPEN holds its port — it sends the neutral pad state on
// every refresh — so a tab forgotten on another machine can keep the only
// controller of the room. Only a person pressing the button may displace it.
import puppeteer from "puppeteer";
import { displacedOn, enterRoom, seatOf, seedName } from "./open.mjs";
const url = process.argv[2] ?? "http://localhost:8100/";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const first = await browser.newPage();

await seedName(first);
await first.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(first);
await wait(3000);
const held = await seatOf(first);
console.log(`page 1 : "${held}"`);
// Assert the precondition rather than branch on it: if something else in the
// room already holds the port, page 1 never had one to lose and the check below
// would pass while proving nothing.
if (held !== 1) {
  console.log("RIEN TESTÉ — la salle n'était pas vide, page 1 n'a pas eu le port 1");
  await browser.close();
  process.exit(2);
}

const second = await browser.newPage();

await seedName(second);
await second.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(second);
await wait(3000);
console.log(`page 2 : "${await seatOf(second)}"`);
console.log(`ports proposés : ${await second.evaluate(() =>
  document.querySelectorAll("#ports [data-state]").length)}`);

// Prendre une prise tenue demande deux clics: le premier arme, le second agit.
// C'est `steal.mjs` qui pin cette séquence; ici on la suit pour arriver au fait
// que cet essai vérifie, à savoir qu'une page OUVERTE garde son port jusqu'à ce
// qu'une personne le lui prenne.
await second.click("#port1");
await wait(800);
await second.click("#port1");
await wait(2500);
const took = await seatOf(second);
console.log(`page 2 après les deux clics : "${took}"`);
let lost = false;
for (let i = 0; i < 20; i++) { lost = await displacedOn(first); if (lost) break; await wait(500); }
console.log(`page 1 prévenue : ${lost} · sa place : "${await seatOf(first)}"`);
const ok = took === 1 && lost;
console.log(ok ? "PASS — la manette a changé de page, et l'ancienne le sait" : "FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
