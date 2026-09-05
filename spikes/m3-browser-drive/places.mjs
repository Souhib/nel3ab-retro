// Après un rechargement, la personne occupe-t-elle encore UNE seule place ?
//
// # La panne
//
// Rapportée le 5 septembre 2026: en quittant la salle et en revenant, le nom
// s'affiche sous le mauvais numéro. « Mon nom apparaît sous joueur 1 alors que
// je suis 2. »
//
// # Ce qui se passe vraiment
//
// Il y a deux sources de vérité. Le worker attribue les ports et ne compte que
// les tuyaux vivants; le plan de contrôle porte les noms et apprend la place par
// une annonce de la page. Un rechargement ouvre la nouvelle socket AVANT que
// l'ancienne soit déclarée partie: le worker a déjà rendu le port, le plan de
// contrôle le croit encore tenu par le fantôme. La personne apparaît alors sous
// deux numéros, dont un qu'elle ne tient pas.
//
// # Pourquoi une seule page suffit
//
// Le plan de contrôle nomme par IDENTITÉ, pas par pseudo: deux onglets de la
// même personne portent le même nom. Le désaccord se voit donc avec une seule
// personne qui recharge, et c'est exactement le geste rapporté.
import puppeteer from "puppeteer";
import { enterRoom, seatOf, seedName } from "./open.mjs";

const url = process.argv[2] ?? process.env.NEL3AB_URL ?? "https://nel3ab.app/";
const api = new URL("/api/room", url).toString();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const say = (ok, what) => {
  if (!ok) bad += 1;
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
};

/** Ce que le plan de contrôle croit: port -> nom. */
const believed = async () => {
  const room = await (await fetch(api)).json();
  return Object.fromEntries((room.seats ?? []).map((s) => [s.port, s.player]));
};

/** La place que le WORKER a donnée à cette page. Réessayée: après un
 * rechargement la boucle média met un instant à reprendre une manette. */
const mine = async (page, tries = 20) => {
  for (let i = 0; i < tries; i += 1) {
    const at = await page.evaluate(() => globalThis.nel3abTest?.seat() ?? null);
    if (at !== null) return at;
    await wait(500);
  }
  return null;
};

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox"],
  // Le défaut de trente secondes expirait pendant que la page rouvrait ses
  // sockets après le rechargement.
  protocolTimeout: 120_000,
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await seedName(page, "places");
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
await enterRoom(page);
await wait(3000);

const before = await mine(page);
say(before !== null, `le worker donne la place ${before}`);
const first = await believed();
say(first[before] !== null && first[before] !== undefined, `et la salle y met un nom (${JSON.stringify(first)})`);
const me = first[before];

// Le geste qui casse.
await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
await enterRoom(page);
await wait(5000);

const after = await mine(page);
const seats = await believed();
say(after !== null, `après le rechargement, le worker donne la place ${after}`);

// Le contrôle qui porte la panne: la même personne ne doit occuper qu'UNE place.
const held = Object.entries(seats)
  .filter(([, who]) => who === me)
  .map(([at]) => Number(at));
say(
  held.length === 1,
  `${me} n'occupe qu'une place (${JSON.stringify(held)}) — salle: ${JSON.stringify(seats)}`,
);

// Et c'est bien CELLE que le worker lui a donnée. Sans ce second contrôle, une
// salle qui n'afficherait qu'une place mais la mauvaise passerait le premier.
say(
  held.length === 1 && held[0] === after,
  `et c'est celle du worker (${after})`,
);

await browser.close();
console.log(bad ? `\n  ÉCHEC (${bad})` : "\n  PASS");
process.exit(bad ? 1 : 0);
