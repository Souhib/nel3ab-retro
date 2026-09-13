// La sieste, et le seul défaut qu'elle peut encore produire.
//
// Une salle vide gèle son émulateur. Le worker attend alors son image prochaine
// aussi longtemps que dure la pause, et cette attente n'est PAS un hoquet de
// l'émulateur: la confondre faisait annoncer « l'émulateur a fait attendre
// 203 860 121 ms » pour une salle qui dormait deux jours.
//
// Le worker retranche donc la pause de l'attente. C'est une course entre deux
// fils, celui qui dégèle et celui qui encode, et aucun test unitaire ne peut la
// voir: elle se joue entre `docker unpause` et la première image, soit quelques
// millisecondes. Ce pilote la joue en vrai.
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer";

import { enterRoom, openRoom, ROOM_URL, salleDe } from "./open.mjs";

// L'adresse en ARGUMENT, comme les autres pilotes. Elle était prise à
// `ROOM_URL` sans qu'aucun argument ne puisse la changer, et la recette ne lui
// en passait aucun: viser une autre salle demandait d'éditer le fichier.
const url = process.argv[2] ?? ROOM_URL;

/** Le numéro de la salle, lu dans l'adresse.
 *
 * Le conteneur et l'unité portent ce numéro depuis la bascule multi-salles:
 * l'unité installée pose `NEL3AB_CONTAINER=nel3ab-dolphin-%i`, et le worker ne
 * retombe sur `nel3ab-dolphin` que si cette variable manque. Ce pilote cherchait
 * l'ancien nom, et `journalctl -u nel3ab-worker` l'ancienne unité, qui est
 * « loaded inactive dead » depuis que les salles sont trois. Le 13 septembre
 * 2026, `docker inspect nel3ab-dolphin` rendait « no such object » pendant que
 * `nel3ab-dolphin-1` tournait.
 *
 * Déduit de l'adresse, comme le salon déduit l'adresse du numéro: `8110` donne
 * 1, et le proxy `/r/1/` aussi. On REFUSE si on n'y arrive pas, plutôt que de
 * viser une salle au hasard.
 */
const numero = salleDe(url);
if (numero === null) {
  console.log(`RIEN MESURÉ — impossible de déduire le numéro de salle de « ${url} ».`);
  console.log("  Attendu: un port en 81N0, ou un chemin en /r/N/.");
  process.exit(1);
}
const CONTENEUR = `nel3ab-dolphin-${numero}`;
const UNITE = `nel3ab-worker@${numero}`;
console.log(`  salle ${numero} · conteneur ${CONTENEUR} · unité ${UNITE}`);

let bad = 0;
const say = (ok, what) => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
};

const paused = () =>
  execFileSync("docker", ["inspect", CONTENEUR, "--format", "{{.State.Paused}}"])
    .toString()
    .trim() === "true";

/** Les tranches de dix secondes écrites depuis `depuis`. */
function tranches(depuis) {
  const raw = execFileSync("journalctl", [
    "-u", UNITE, "--since", depuis, "-o", "json", "--no-pager",
  ]).toString();
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(JSON.parse(line).MESSAGE);
      } catch {
        return null;
      }
    })
    .filter((m) => m?.fields);
}

// 1. Attendre que la salle s'endorme. Le délai de grâce est d'une minute.
process.stdout.write("  on attend que la salle s'endorme");
for (let i = 0; i < 60 && !paused(); i++) {
  process.stdout.write(".");
  await new Promise((done) => setTimeout(done, 3000));
}
console.log();
say(paused(), "la salle vide finit par geler son émulateur");

const depuis = new Date(Date.now() - 5000).toISOString().slice(11, 19);

// 2. La réveiller en la regardant.
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await openRoom(browser, url);
await enterRoom(page);
await new Promise((done) => setTimeout(done, 25000));
const peintes = await page.evaluate(() => globalThis.nel3abTest?.counters?.().painted ?? 0);
// La PAGE et non le navigateur. L'intention est de vider la salle pour qu'elle
// regèle, pas de tuer l'instance: `stillAwakeWith` ouvre ensuite ses propres
// pages avec `browser.newPage()`, et sur un navigateur fermé cela lève
// `ConnectionClosedError`. Ce défaut était invisible tant que le pilote mourait
// plus tôt sur un nom de conteneur périmé; corriger le nom l'a révélé.
await page.close();

say(peintes > 300, `elle se réveille et peint (${peintes} images)`);
say(!paused(), "et elle reste éveillée tant qu'on regarde");

// 2 bis. Ce qui doit AUSSI tenir la salle éveillée.
//
// Trois façons d'être dans une salle sans ouvrir le grand format, et la sieste
// les ignorait toutes les trois le 30 août 2026: le format réduit, la manette
// seule, et un jeu demandé pendant que personne ne regarde. La salle gelait
// alors sous des gens qui étaient là, et le jeu qu'ils demandaient n'arrivait
// jamais, parce que la boucle d'images qui lit la demande est bloquée sur un
// émulateur en pause.
async function stillAwakeWith(what, open) {
  process.stdout.write(`  on attend le gel avant d'essayer « ${what} »`);
  for (let i = 0; i < 40 && !paused(); i++) {
    process.stdout.write(".");
    await new Promise((done) => setTimeout(done, 3000));
  }
  console.log();
  if (!paused()) {
    say(false, `la salle ne s'est pas endormie, « ${what} » n'a pas pu être testé`);
    return;
  }
  const seen = await open();
  say(!paused(), `« ${what} » réveille la salle`);
  say(seen > 0, `et elle produit des images (${seen})`);
}

await stillAwakeWith("format réduit", async () => {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const seen = await page.evaluate(
    () =>
      new Promise((done) => {
        // Sous le préfixe de la salle, comme `flood.mjs`: l'origine seule vise le
        // salon, qui n'envoie aucune image. NON exercé: ce pilote demande une
        // salle qui s'endort, ce qui prend plusieurs minutes.
        const socket = new WebSocket(
          new URL("video?half=1", location.href).href.replace(/^http/, "ws"),
        );
        socket.binaryType = "arraybuffer";
        let frames = 0;
        socket.onmessage = (event) => {
          if (event.data.byteLength > 8) frames++;
        };
        setTimeout(() => done(frames), 12000);
      }),
  );
  await page.close();
  return seen;
});

// 3. Ce que le worker a écrit du réveil.
const vues = tranches(depuis).filter((m) => m.fields.message === "streaming");
const dormi = vues.filter((m) => Number(m.fields.slept_ms ?? 0) > 0);
const attentes = vues.map((m) => Number(m.fields.waiting_max_ms ?? 0));

say(dormi.length > 0, `une tranche porte la sieste (${dormi.map((m) => m.fields.slept_ms)} ms)`);
say(
  Math.max(0, ...attentes) < 1000,
  `aucune tranche ne prend la sieste pour un hoquet (attente max ${Math.max(0, ...attentes).toFixed(0)} ms)`,
);

const cris = tranches(depuis).filter((m) => m.fields.message === "the emulator went quiet");
say(cris.length === 0, `aucun cri au secours (${cris.map((m) => Math.round(m.fields.waited_ms))})`);

await browser.close();
console.log(bad === 0 ? "PASS — la sieste ne se fait plus passer pour une panne" : `ÉCHEC — ${bad}`);
process.exit(bad === 0 ? 0 : 1);
