// Fait bouger le jeu, pour qu'il y ait quelque chose à mesurer.
//
// Un encodeur ne se règle pas sur un écran fixe. Le flux de cette salle tient
// dans 0,4 Mbit/s sur un écran de titre et en demande treize en course: un
// réglage choisi sur le premier ne dit rien du second. Ce pilote sert donc à
// amener le jeu là où les chiffres comptent, pendant que `capture.mjs`
// enregistre à côté.
//
//   node stir.mjs Enter Enter x x x x    presse une suite de touches
//   node stir.mjs --race 60              accélère et braque pendant 60 s
//
// Les touches sont celles du clavier par défaut de la page: `x` vaut A, `Enter`
// vaut START, les flèches valent le stick.
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const racing = args[0] === "--race";
const seconds = racing ? Number(args[1] ?? 60) : 0;

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await seedName(page, "mesure");
await page.goto("http://localhost:8100/", { waitUntil: "domcontentloaded" });
await enterRoom(page);
await wait(2500);

const seat = await page.evaluate(() => globalThis.nel3abTest.seat());
if (seat === null) {
  console.log("RIEN FAIT — pas de manette libre, quelqu'un joue");
  await browser.close();
  process.exit(0);
}
console.log(`manette ${seat}`);

if (racing) {
  // Accélérateur tenu, direction au hasard: on ne cherche pas à bien jouer, on
  // cherche une image qui change beaucoup, ce qui est ce que l'encodeur subit.
  await page.keyboard.down("x");
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const key = Math.random() < 0.5 ? "ArrowLeft" : "ArrowRight";
    await page.keyboard.down(key);
    await wait(300 + Math.random() * 400);
    await page.keyboard.up(key);
    await wait(200 + Math.random() * 500);
  }
  await page.keyboard.up("x");
} else {
  for (const key of args) {
    await page.keyboard.down(key);
    await wait(120);
    await page.keyboard.up(key);
    await wait(900);
  }
}
await browser.close();
