// Une soirée laisse-t-elle une trace lisible ?
//
// # Pourquoi celui-ci passe par le PROXY et pas par localhost
//
// Tous les autres pilotes ouvrent `http://localhost:8110/`, qui est le worker.
// Ça marche pour l'image, le son et les manettes, qui sont à lui. Le SALON n'est
// pas à lui: il écoute sur 8200, et c'est le proxy Tailscale qui aiguille
// `/socket.io` et `/api` vers lui.
//
// Donc un pilote qui vise le worker ne touche jamais le salon, et un pilote qui
// vérifierait le journal depuis là verrait un fichier vide en concluant que le
// journal ne marche pas. C'est exactement ce qui s'est produit en écrivant ce
// fichier: le premier jet visait 8100, n'a rien trouvé, et la panne était la
// mienne.
//
// D'où l'adresse par défaut ci-dessous. Elle est la SEULE de tous les pilotes à
// être celle d'une vraie personne, ce qui en fait aussi le seul endroit où le
// chemin complet, identité du proxy comprise, est exercé.
//
//   node journal.mjs [url]
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";
import { enterRoom, openRoom, seatOf, ROOM_URL } from "./open.mjs";

const url = process.argv[2] ?? ROOM_URL;
const FOLDER = join(homedir(), ".local/state/nel3ab/sessions");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Combien de temps l'onglet reste derrière une autre page, en millisecondes. */
const HIDDEN_MS = 6000;
let bad = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
  if (!ok) bad += 1;
};

/** Ce que le salon a écrit aujourd'hui. */
function written() {
  const days = readdirSync(FOLDER).filter((name) => name.endsWith(".jsonl")).sort();
  const last = days.at(-1);
  if (!last) return [];
  return readFileSync(join(FOLDER, last), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const before = (() => {
  try {
    return written().length;
  } catch {
    return 0;
  }
})();

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await openRoom(browser, url, "pilote du journal");
await enterRoom(page);
await wait(3000);
const took = await seatOf(page);
// Le numéro de visite, lu SUR LA PAGE, là où une personne le lit pour me le
// donner en signalant un problème. Le comparer à ce qui est écrit prouve le
// trajet entier plutôt que l'existence d'une ligne quelconque.
// Le panneau des chiffres est replié par défaut: qui joue veut l'image. Il faut
// donc l'ouvrir, comme une personne le fait avant de me lire un numéro.
await page.click("#mode-details");
await wait(600);
const visit = await page.evaluate(() => document.getElementById("visit")?.textContent ?? null);
// Et on revient à la salle, où vit le bouton de signalement. Une personne qui
// joue est de ce côté-là; le panneau des chiffres est ce qu'elle ouvre pour me
// lire un numéro, pas ce qu'elle regarde en jouant.
await page.click("#mode-normal");
await wait(400);
// Plus long qu'une fenêtre de relevé, sinon il n'y en a aucun à vérifier. Un
// pilote qui regarde trop tôt trouve un journal correct et une moitié vide.
await wait(12_000);
// ── L'onglet caché, comme une personne le cache: une seconde page passe devant.
// C'est le câblage que les essais unitaires ne voient pas: l'écoute de
// `visibilitychange` dans la page, et le relevé qui remet le temps caché à zéro.
const other = await browser.newPage();
await other.goto("about:blank");
await other.bringToFront();
await wait(1000);
const hiddenNow = await page.evaluate(() => document.hidden);
const hiddenAt = Date.now();
await wait(HIDDEN_MS);
await page.bringToFront();
const hiddenFor = Date.now() - hiddenAt + 1000;
await wait(500);
const shownAgain = await page.evaluate(() => !document.hidden);
await other.close();
// Plus d'une fenêtre encore, pour que celle qui contient le retour soit écrite.
await wait(12_000);
await page.click("#complain");
await wait(1000);
const said = await page.$eval("#complain", (button) => button.textContent);
await page.close();
await wait(1500);

const lines = written().slice(before);
// Par la VISITE et pas par le pseudo. Le premier jet filtrait sur le nom semé
// par le pilote, que le proxy remplace par le vrai: la liste sortait vide, et
// `every` sur une liste vide répond oui. Trois vérifications passaient donc en
// ne regardant rien, ce qui est exactement le genre de test que ce dépôt
// considère pire que pas de test.
const mine = visit ? lines.filter((line) => line.visite === visit) : [];

check(lines.length > 0, `la soirée a laissé ${lines.length} lignes`);
check(mine.length > 0, `et ${mine.length} sont celles de cette visite`);
check(
  mine.some((line) => line.quoi === "arrivée"),
  "l'arrivée est écrite",
);
check(
  mine.some((line) => line.quoi === "départ" && typeof line.secondes === "number"),
  "le départ l'est aussi, avec la durée de la séance",
);
if (took !== null) {
  check(
    mine.some((line) => line.quoi === "place" && line.place === took),
    `la manette prise est écrite (P${took})`,
  );
}
check(
  mine.length > 0 && mine.every((line) => line.banc === true),
  "un pilote se déclare de banc, donc `just sessions` ne le montre pas",
);
check(
  new Set(mine.map((line) => line.visite)).size === 1,
  "toutes ses lignes portent la MÊME visite, donc elles se recollent",
);
check(
  mine.some((line) => line.salle && typeof line.salle.présents === "number"),
  "chaque ligne dit à quoi ressemblait la salle",
);

// ── Ce que le NAVIGATEUR mesure, qui mourait avec l'onglet.
const measured = mine.filter((line) => line.quoi === "mesures");
check(measured.length > 0, `le navigateur a rendu ${measured.length} relevés`);
check(
  measured.every((line) => line.vu?.vues > 0 && line.vu?.peintes > 0),
  "et chacun compte des images sur SA fenêtre",
);
check(
  measured.every((line) => Math.abs(line.vu?.horaire ?? 9e9) < 1000),
  `le retard ajouté est un retard (${measured[0]?.vu?.horaire} ms)`,
);

// ── Ce que chaque relevé ajoute depuis le 14 septembre 2026.
check(
  measured.length > 0 &&
    measured.every(
      (line) =>
        Array.isArray(line.vu?.arrivées) &&
        line.vu.arrivées.length === 3 &&
        line.vu.arrivées[0] > 0 &&
        line.vu.arrivées[2] >= line.vu.arrivées[0],
    ),
  `chaque relevé dit l'écart entre images reçues (${JSON.stringify(measured[0]?.vu?.arrivées)} ms)`,
);
check(
  measured.length > 0 &&
    measured.every(
      (line) =>
        line.vu?.manette &&
        (line.vu.manette.allerRetour === null || typeof line.vu.manette.allerRetour === "number") &&
        "modèle" in line.vu.manette,
    ),
  `et l'aller-retour et le nom de la manette, nuls sans mesure ni manette (${measured
    .map((line) => line.vu?.manette?.allerRetour)
    .join(", ")} ms; « ${measured[0]?.vu?.manette?.modèle} »)`,
);
check(hiddenNow, "la seconde page cache bien la salle (précondition)");
check(shownAgain, "et la salle redevient visible au retour (précondition)");
const hiddenWritten = measured.reduce((sum, line) => sum + (line.vu?.page?.cachéeMs ?? 0), 0);
check(
  measured.every((line) => typeof line.vu?.page?.visible === "boolean"),
  "chaque relevé dit si l'onglet était visible",
);
check(
  measured[0]?.vu?.page?.cachéeMs === 0,
  `le relevé d'AVANT la seconde page ne compte aucun temps caché (${measured[0]?.vu?.page?.cachéeMs} ms)`,
);
check(
  Math.abs(hiddenWritten - hiddenFor) < 1500,
  `les relevés comptent le temps caché une fois, ni plus ni moins (${hiddenWritten} ms écrits pour ${hiddenFor} ms)`,
);
const arrived = mine.find((line) => line.quoi === "arrivée");
check(
  /^\d+x\d+$/.test(arrived?.appareil?.écran ?? "") &&
    arrived?.appareil?.cœurs > 0 &&
    /Chrome/.test(arrived?.appareil?.navigateur ?? ""),
  `l'arrivée dit l'appareil (${JSON.stringify(arrived?.appareil)})`,
);
check(
  mine.filter((line) => "appareil" in line).length === 1,
  "et lui seul le dit: ni les relevés ni le départ ne le répètent",
);

const complained = mine.filter((line) => line.quoi === "plainte");
check(complained.length === 1, "le bouton pose exactement un repère");
const fine = complained[0]?.vu?.fin;
check(
  (fine?.lignes?.length ?? 0) > 0,
  `et le repère emporte les secondes qui précèdent (${fine?.lignes?.length ?? 0})`,
);
check(
  (fine?.colonnes?.length ?? 0) === (fine?.lignes?.[0]?.length ?? -1),
  "la légende des colonnes va avec, sinon la trace est illisible",
);
check(
  (fine?.lignes ?? []).every((row) => row[0] <= 0 && row[0] >= -120),
  "chaque seconde est datée AVANT le signalement, et pas au-delà de deux minutes",
);
// « signalement enregistré » depuis le 9 septembre 2026 (`Sidebar.tsx`): le bouton
// ne dit plus « noté » avant que le salon ait répondu. Ce pilote attendait encore
// l'ancien mot et rougissait depuis, sans que personne ne l'ait relancé.
check(said?.includes("enregistré"), `le bouton dit qu'il a compris (« ${said} »)`);
// L'identité du proxy: c'est ce qui manquait le jour où on m'a demandé de
// retrouver quelqu'un. Un `null` ici veut dire qu'on est passé à côté du proxy.
check(
  mine.length > 0 && mine.every((line) => line.login),
  `le proxy dit qui c'est (${mine[0]?.login ?? "personne"})`,
);
// Sans `if`: un pilote qui saute une vérification quand la page ne dit rien est
// un pilote qui annonce une couverture qu'il n'a pas.
check(Boolean(visit), "le numéro de séance est lisible sur la page");

await browser.close();
console.log(bad === 0 ? "PASS — une séance se relit du début à la fin" : `${bad} RATÉ(S)`);
process.exit(bad === 0 ? 0 : 1);
