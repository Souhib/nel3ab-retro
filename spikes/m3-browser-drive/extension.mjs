// Changer d'extension depuis la page, sans que le jeu redémarre.
//
// Ce que la CI ne peut pas prouver: qu'un clic dans le menu traverse la socket,
// le worker, le tuyau de contrôle et l'expression de Dolphin — cinq couches
// qu'aucun essai unitaire ne parcourt ensemble.
//
// La salle doit tourner sur un jeu WII, sinon il n'y a pas de Wiimote et rien à
// brancher. Le pilote le dit plutôt que de passer à vide, parce qu'un essai qui
// réussit sans rien vérifier est pire que pas d'essai.
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";

const url = process.argv[2] ?? "http://localhost:8100/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const say = (ok, what) => {
  if (!ok) bad += 1;
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
};

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await seedName(page, "extension");

// La page part en croyant tenir une WIIMOTE.
//
// Son idée de la manette vient de son stockage local et non de la salle: un
// navigateur neuf croit tenir une manette GameCube quoi que la salle présente.
// Sans cette graine, le sélecteur prendrait le chemin du redémarrage — ce qui
// est correct de son point de vue, et ne prouverait rien de ce qu'on vient
// vérifier. Un joueur qui revient a cette valeur; ce pilote en est un.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem("nel3ab:pad", "1");
  } catch {
    // Navigation privée: le pilote n'y tourne pas.
  }
});

// On écoute la socket de manette AVANT qu'elle s'ouvre: c'est là que passe
// l'ordre, et c'est la seule preuve que la page a vraiment parlé.
await page.evaluateOnNewDocument(() => {
  globalThis.__envoyes = [];
  const vrai = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (data instanceof Uint8Array) globalThis.__envoyes.push([...data]);
    return vrai.call(this, data);
  };
});

await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);
await wait(2500);

const press = (css) => page.evaluate((s) => document.querySelector(s)?.click(), css);
const sentSince = async (from) =>
  page.evaluate((at) => globalThis.__envoyes.slice(at), from);

const before = await page.evaluate(() => globalThis.__envoyes.length);

// Le sélecteur de manette, dans la colonne.
await press("#openMenu");
await wait(700);
await press("#ray-reglages");
await wait(500);
await press("#item-pad");
await wait(700);
await press("#pick-2");
await wait(1500);

const sent = await sentSince(before);
const orders = sent.filter((bytes) => bytes.length === 2 && bytes[0] === 4);
say(orders.length > 0, `la page a envoyé l'ordre d'extension (${JSON.stringify(orders)})`);
say(
  orders.some((bytes) => bytes[1] === 1),
  "et c'est la guitare qui est demandée",
);

// Le jumeau: revenir au Nunchuk repart aussi, et par le même chemin.
const middle = await page.evaluate(() => globalThis.__envoyes.length);
await press("#item-pad");
await wait(700);
await press("#pick-1");
await wait(1500);
const back = (await sentSince(middle)).filter((b) => b.length === 2 && b[0] === 4);
say(
  back.some((bytes) => bytes[1] === 0),
  `le retour au Nunchuk part aussi (${JSON.stringify(back)})`,
);

await browser.close();
console.log(bad ? `\n  ÉCHEC (${bad})` : "\n  PASS");
process.exit(bad ? 1 : 0);
