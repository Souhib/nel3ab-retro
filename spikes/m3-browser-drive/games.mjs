// Changer de jeu depuis la page, et ce que ça demande avant de le faire.
//
// RESTARTS THE SESSION on purpose — that is the feature. Must not be run while
// somebody is playing something they care about.
//
// What it pins is the sequence rather than the outcome: a single click must NOT
// boot anything, because the thing being confirmed is the end of everybody
// else's game. A test that only checked "the game changed" would pass just as
// well on a page that switched on the first click.
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";

const url = process.argv[2] ?? "http://localhost:8100/";
const roms = async () => (await fetch(new URL("/roms", url))).json();

const before = await roms();
if (before.roms.length < 2) {
  console.log(`RIEN TESTÉ — il faut au moins deux jeux, la salle en a ${before.roms.length}`);
  process.exit(0);
}
const target = before.roms.findIndex((_, index) => index !== before.current);

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await seedName(page);
page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);
await new Promise((r) => setTimeout(r, 3000));

const held = await page.evaluate(() => globalThis.nel3abTest.room?.() ?? null);
if (held === null || held.mine === 0) {
  console.log("RIEN TESTÉ — la page n'a pas obtenu de manette, la salle est pleine");
  await browser.close();
  process.exit(0);
}

// Changer de jeu appartient au propriétaire de la salle, et le worker applique
// la règle lui-même. Si quelqu'un d'autre est déjà là, ce pilote ne peut rien
// prouver: il faut le DIRE, parce qu'un rouge dû à une salle occupée apprend à
// l'oeil à ignorer ce fichier. Le plan de contrôle est ce qui sait qui décide;
// absent, personne ne décide et la règle d'avant s'applique.
const boss = await fetch("http://localhost:8200/api/room")
  .then((answer) => answer.json())
  .then((room) => room.owner)
  .catch(() => null);
if (boss && boss.seat !== held.mine) {
  console.log(
    `RIEN TESTÉ — la salle appartient à ${boss.name} (manette ${boss.seat}), nous tenons la ${held.mine}`,
  );
  await browser.close();
  process.exit(0);
}

// Les jeux vivent dans le menu depuis qu'il y en a un: il faut l'ouvrir avant
// de pouvoir en désigner un. Et on clique par `evaluate` plutôt qu'avec
// `page.click`, qui demande plusieurs allers-retours au navigateur et expire
// quand la page décode soixante images par seconde à côté.
const press = (css) => page.evaluate((s) => document.querySelector(s)?.click(), css);
await press("#openMenu");
await new Promise((r) => setTimeout(r, 1200));

// Premier clic : il doit ARMER et rien de plus.
await press(`#item-game${target}`);
await new Promise((r) => setTimeout(r, 1500));
const armed = await page.evaluate(
  (i) => document.getElementById(`item-game${i}`)?.textContent?.includes("confirmer") ?? false,
  target,
);
const afterOneClick = await roms();
console.log(`  après un clic : ${armed ? "armé" : "PAS armé"}, jeu courant ${afterOneClick.current}`);
if (!armed || afterOneClick.current !== before.current) {
  console.log("FAIL — un seul clic a suffi, ou n'a pas armé");
  await browser.close();
  process.exit(1);
}

// Deuxième clic : cette fois ça part.
await press(`#item-game${target}`);
await new Promise((r) => setTimeout(r, 1500));
await browser.close();

// systemd relance le worker; la bibliothèque est rescannée au démarrage.
let after = before;
for (let attempt = 0; attempt < 40; attempt++) {
  await new Promise((r) => setTimeout(r, 1500));
  try {
    after = await roms();
    if (after.current === target) break;
  } catch {
    // La salle redémarre, le port ne répond pas encore.
  }
}
const named = (list, at) => list[at]?.name ?? list[at] ?? "?";
console.log(
  `  après confirmation : ${named(before.roms, before.current)} -> ${named(after.roms, after.current)}`,
);
console.log(
  after.current === target
    ? "PASS — un clic arme, le second change de jeu"
    : `FAIL — le jeu n'a pas changé (toujours ${after.current})`,
);
process.exit(after.current === target ? 0 : 1);
