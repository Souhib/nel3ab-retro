// Le propriétaire décide du jeu, et la place passe quand il part.
//
// À travers le VRAI proxy: sans lui personne n'a d'identité et il n'y a pas de
// propriétaire du tout, ce qui est le comportement de repli et non celui-ci.
import puppeteer from "puppeteer";
import { enterRoom } from "./open.mjs";

const url = "https://lgf.tail3bd01c.ts.net:8443/";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"], acceptInsecureCerts: true });
let bad = 0;
const say = (ok, line) => { if (!ok) bad += 1; console.log(`  ${ok ? "ok    " : "FAUX  "} ${line}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Une salle occupée n'est pas un défaut: quelqu'un joue peut-être à côté. Cet
// essai demande une salle VIDE pour pouvoir dire qui est arrivé en premier, donc
// il s'abstient plutôt que d'accuser.
const before = await (await fetch("http://127.0.0.1:8200/api/room")).json();
if (before.people.length > 0) {
  console.log(`RIEN TESTÉ — la salle n'était pas vide (${before.people.map((p) => p.name).join(", ")})`);
  await browser.close();
  process.exit(2);
}

const boss = await browser.newPage();
await boss.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(boss);
await wait(3500);

const room = await boss.evaluate(async () => (await (await fetch("/api/room")).json()));
say(room.owner !== null, `la salle a un propriétaire: ${room.owner?.name ?? "aucun"}`);
say(room.owner?.login === "souhib.t@hotmail.fr", "c'est le premier arrivé");

// Le propriétaire peut choisir; la note ne doit pas dire le contraire.
const note = await boss.evaluate(() => document.body.innerText);
say(!/décide du jeu dans cette salle/.test(note), "aucun refus affiché au propriétaire");

// Toutes les pages de ce navigateur partagent la même identité, donc pour voir
// un NON-propriétaire il faut une salle où quelqu'un d'autre est arrivé avant.
// Ce que ce pilote peut vérifier ici, c'est que la règle est bien celle du
// service et pas une invention de la page.
say(room.people.length >= 1, `${room.people.length} personne(s) dans la salle`);

await boss.close();
// Combien de temps la salle met à l'oublier, mesuré plutôt que supposé: la
// fermeture traverse le navigateur, le proxy, puis le salon.
const started = Date.now();
let after = null;
for (let i = 0; i < 60; i++) {
  await wait(500);
  after = await (await fetch("http://127.0.0.1:8200/api/room")).json();
  if (after.owner === null) break;
}
const took = ((Date.now() - started) / 1000).toFixed(1);
say(after.owner === null, `quand tout le monde part, la salle l'oublie (en ${took} s)`);

console.log(bad === 0 ? "PASS — le propriétaire est le premier arrivé, et la salle le sait" : `FAIL — ${bad} écart(s)`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
