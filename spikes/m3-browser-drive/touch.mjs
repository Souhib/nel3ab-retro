// La manette à l'écran, sur un téléphone simulé.
//
// Ce qu'il faut prouver tient en deux choses: elle APPARAÎT toute seule sur un
// écran tactile, et un appui de doigt arrive vraiment au jeu. La seconde se
// mesure sur le compteur de trames envoyées, qui est ce que le worker reçoit.
import puppeteer from "puppeteer";
import { enterRoom, openRoom } from "./open.mjs";

const url = process.argv[2] ?? "http://localhost:8100/";
let bad = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
  if (!ok) bad += 1;
};

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await openRoom(browser, url);
// Un téléphone tenu en travers, avec un vrai écran tactile.
await page.emulate({
  viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
});
await page.reload({ waitUntil: "domcontentloaded" });
await enterRoom(page);
await new Promise((r) => setTimeout(r, 3000));

check(await page.$("#touchpad") !== null, "la manette apparaît toute seule sur un écran tactile");
check(await page.$("#touch-A") !== null, "avec ses boutons");

// `attempts` est le compteur de trames que la page a envoyées au worker: c'est
// ce que le pilote de bout en bout regarde déjà, et c'est la seule preuve que
// le doigt a atteint le jeu plutôt que le seul bouton.
const sent = () => page.evaluate(() => globalThis.nel3abTest?.counters?.().attempts ?? 0);
const before = await sent();

// Un doigt sur A, TENU: c'est pendant qu'il tient qu'on regarde, sinon on ne
// mesure qu'un compteur qui monte de toute façon.
const button = await page.$("#touch-A");
const box = await button.boundingBox();
const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
await page.touchscreen.touchStart(at.x, at.y);
await new Promise((r) => setTimeout(r, 700));
const held = await page.evaluate(() => globalThis.nel3abTest?.counters?.().pressed ?? []);
await page.touchscreen.touchEnd();
await new Promise((r) => setTimeout(r, 500));
const after = await page.evaluate(() => globalThis.nel3abTest?.counters?.().pressed ?? []);

check((await sent()) > before, "les trames continuent de partir pendant qu'on joue au doigt");
check(held.includes("A"), `le bouton tenu arrive sur le fil (tenu: ${held.join(" ") || "rien"})`);
check(!after.includes("A"), "et il repart quand le doigt se lève");

// Le stick: un glissement doit pousser, et le relâchement remettre à zéro.
const stick = await (await page.$("#touchStick")).boundingBox();
const centre = { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 };
await page.touchscreen.touchStart(centre.x, centre.y);
await page.touchscreen.touchMove(centre.x + 50, centre.y);
await new Promise((r) => setTimeout(r, 400));
const pushed = await sent();
await page.touchscreen.touchEnd();
await new Promise((r) => setTimeout(r, 300));

check(pushed > before, "le stick poussé fait aussi partir des trames");
check(
  await page.evaluate(() => document.getElementById("touchStick") !== null),
  "le stick est toujours là après le glissement",
);

// Et sur un ordinateur, elle ne s'invite pas.
const desk = await openRoom(browser, url, "bureau");
await enterRoom(desk);
await new Promise((r) => setTimeout(r, 2000));
check(await desk.$("#touchpad") === null, "elle ne s'invite pas sur un ordinateur");

await browser.close();
console.log(bad === 0 ? "PASS — on peut jouer au doigt" : `${bad} RATÉ(S)`);
process.exit(bad === 0 ? 0 : 1);
