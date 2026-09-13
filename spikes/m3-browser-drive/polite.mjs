// Une page qui tient une manette réannonce-t-elle sa place, sans marteler ?
//
// # Ce que ce pilote mesurait avant, et pourquoi c'était faux
//
// Il affirmait qu'une page REFUSÉE continue de demander une place, « poliment,
// et pas trop souvent », en comptant `nel3abTest.counters().attempts`. Deux
// erreurs, trouvées le 13 septembre 2026.
//
// La première: `attempts` vaut `shot.input.sent` (`media/session.ts`), c'est-à-
// dire les TRAMES D'ENTRÉE envoyées. Une page qui tient une manette en envoie
// des centaines — `padmenu` en compte 154 en quelques secondes — et une page
// sans manette en envoie zéro. La fourchette « 2 à 6 en 12 s » ne pouvait être
// satisfaite que par accident.
//
// La seconde: le scénario n'existe pas. `media/input.ts` définit `refused`
// comme « vrai quand cette page regarde sans manette, PAR CHOIX ». Sur une
// salle pleine la porte joueur est désactivée et `#screen` n'arrive jamais;
// entrer par « regarder » donne `seat = null` et zéro demande en douze
// secondes. Aucune page ne redemande après un rejet, parce que rien ne rejette.
//
// # Ce qu'il mesure maintenant
//
// L'invariant voisin, réel et utile: une page qui TIENT une place la réannonce
// au salon environ une fois par seconde (`lib/room.ts`, `setInterval(announce,
// 1000)` émettant `seat`). C'est ce qui garde la carte des places fraîche quand
// une page part sans prévenir. Trop rare, le salon garde un fantôme; trop
// fréquent, on martèle. L'intention d'origine est préservée, l'observable est
// changé pour celui qui existe.
//
// Les trames sont lues À LA SOURCE, en instrumentant `WebSocket.prototype.send`
// avant le chargement: le journal du salon ne distingue pas mes annonces de
// celles des autres pages.
//
// Il faut le PROXY: `seat` part vers le salon, que le worker ne porte pas.
//
//   NEL3AB_URL=https://<domaine>/r/<N>/ node polite.mjs
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";

const url = process.argv[2] ?? process.env.NEL3AB_URL ?? "http://localhost:8110/";
const FENETRE = 12;
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await seedName(page, "polite");
await page.evaluateOnNewDocument(() => {
  globalThis.__places = 0;
  const brut = WebSocket.prototype.send;
  WebSocket.prototype.send = function (donnee) {
    try {
      if (typeof donnee === "string" && donnee.includes('"seat"')) globalThis.__places += 1;
    } catch { /* une trame binaire n'est pas la nôtre */ }
    return brut.call(this, donnee);
  };
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);
await attendre(3000);

// La précondition est AFFIRMÉE, pas contournée: sans place tenue, il n'y a rien
// à réannoncer et le pilote ne prouverait rien.
const place = await page.evaluate(() => globalThis.nel3abTest?.seat?.() ?? null);
if (place === null) {
  console.log("RIEN TESTÉ — cette page n'a pas obtenu de manette, il n'y a pas de place à réannoncer.");
  await browser.close();
  process.exit(1);
}
// Le salon doit être joignable, sinon aucune trame ne part et le compte serait
// nul pour une raison qui n'est pas celle qu'on croit mesurer.
const salon = await page.evaluate(() => Boolean(globalThis.nel3abTest?.room?.()));
if (!salon) {
  console.log("RIEN TESTÉ — la page n'est pas reliée au salon: viser le PROXY, pas le worker.");
  await browser.close();
  process.exit(1);
}

const avant = await page.evaluate(() => globalThis.__places);
await attendre(FENETRE * 1000);
const apres = await page.evaluate(() => globalThis.__places);
await browser.close();

const annonces = apres - avant;
const cadence = annonces / FENETRE;
console.log(`  place ${place} · ${annonces} annonces en ${FENETRE} s (${cadence.toFixed(2)}/s)`);
// Une par seconde, avec de la marge pour l'ordonnancement du navigateur.
const ok = annonces >= FENETRE * 0.5 && annonces <= FENETRE * 2;
console.log(ok
  ? "PASS — elle réannonce sa place environ une fois par seconde"
  : `FAIL — ${annonces} annonces: ${annonces < FENETRE * 0.5 ? "trop rare, le salon gardera un fantôme" : "elle martèle"}`);
process.exit(ok ? 0 : 1);
