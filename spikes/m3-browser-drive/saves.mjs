// Deux sauvegardes par jeu, et le choix qui décide sur laquelle on joue.
//
// Ce que la CI ne peut pas prouver: qu'un jeu écrit bien dans l'emplacement
// choisi. Le worker fait pointer le dossier de carte de Dolphin vers cet
// emplacement, et une erreur là ne donne pas une erreur: elle donne une partie
// qui écrase la mauvaise sauvegarde, ce qui ne se voit qu'une fois trop tard.
import { execFileSync } from "node:child_process";
import { existsSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";

import { enterRoom, openRoom, ROOM_URL } from "./open.mjs";

let bad = 0;
const say = (ok, what) => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
};

const SESSION = join(homedir(), ".local/state/nel3ab/session");
const card = (region) => join(SESSION, "GC", region, "Card A");
const pointedAt = (region) => (existsSync(card(region)) ? readlinkSync(card(region)) : null);

/** Ce que le worker a retenu, lu sur le disque plutôt que déduit. */
const kept = (name) => {
  try {
    return execFileSync("cat", [join(SESSION, name)]).toString().trim();
  } catch {
    return null;
  }
};

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await openRoom(browser, ROOM_URL);
await enterRoom(page);
await new Promise((r) => setTimeout(r, 5000));

// Un DEUXIÈME navigateur, qui ne touche à rien. Il est là pour le défaut le
// plus visible de tous: pendant un changement de jeu, seul celui qui cliquait
// voyait l'écran de chargement. Les autres regardaient dix secondes de noir.
const watcher = await openRoom(browser, ROOM_URL);
await enterRoom(watcher);
await new Promise((r) => setTimeout(r, 3000));

const before = pointedAt("USA");
say(before !== null, `le dossier de carte pointe quelque part (${before})`);
say(
  ["USA", "EUR", "JAP"].every((r) => pointedAt(r) === before),
  "et les trois régions pointent au même endroit",
);

// Le jeu qui tourne, pour en demander un autre.
const room = JSON.parse(
  await page.evaluate(async () => (await fetch("/api/room")).text()),
);
// Ce pilote CHANGE le jeu de la salle, donc il lui faut le droit de décider.
//
// Quand quelqu'un est déjà là et tient la salle, le worker refuse le changement,
// et le pilote enchaînait cinq lignes rouges qui ne décrivaient aucun défaut. Un
// essai qui rate parce qu'il ne pouvait pas tourner doit le DIRE: sinon c'est un
// essai qu'on apprend à ignorer, et il en existe déjà un dans ce projet.
// La règle du WORKER est celle qui compte, et elle est par PLACE, pas par
// personne: c'est lui qui accepte ou refuse le changement de jeu. Comparer les
// identités, comme le fait la page, dirait « tu peux » à un deuxième onglet de
// la même personne, et le pilote enchaînerait des lignes rouges qui ne
// décriraient aucun défaut.
const mySeat = await page.evaluate(() => window.nel3abTest?.counters?.().port ?? null);
if (room.owner?.seat && room.owner.seat !== mySeat) {
  console.log(
    `  IGNORÉ — la place ${room.owner.seat} décide dans cette salle, le pilote tient la ${mySeat ?? "aucune"}`,
  );
  await browser.close();
  process.exit(0);
}

// Un autre jeu QUI A des emplacements de sauvegarde. « le premier autre » ne
// suffit plus depuis que la bibliothèque mêle GameCube et Wii: un jeu Wii écrit
// dans la NAND et n'ouvre donc pas de panneau, et le pilote se plantait sur sa
// propre hypothèse plutôt que sur un défaut.
const other = room.library.find((g) => g.index !== room.game?.index && g.console === "gc");
say(Boolean(other), `un autre jeu à demander (${other?.name})`);

// On demande ce jeu sur l'emplacement « tout débloqué », par l'INTERFACE et pas
// par un raccourci: ce qu'on vérifie est justement que le choix de la page
// arrive jusqu'au disque.
const press = (css) => page.evaluate((s) => document.querySelector(s)?.click(), css);
/** Attend qu'une condition soit vraie dans la page, jusqu'à trois secondes. */
const until = async (check) => {
  for (let tries = 0; tries < 30; tries++) {
    if (await page.evaluate(check)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};
await press("#openMenu");
await new Promise((r) => setTimeout(r, 1200));
// Le jeu d'abord: une pression ouvre le sélecteur de sauvegarde, elle ne lance
// rien. C'est le panneau qui confirme, et il DIT sur quoi on part.
await press(`#item-game${other.index}`);
await new Promise((r) => setTimeout(r, 1200));
say(
  await page.evaluate(() => document.getElementById("picker") !== null),
  "choisir un jeu ouvre le choix de la sauvegarde au lieu de lancer",
);
say(
  (await page.evaluate(() => document.getElementById("picker")?.textContent ?? "")).includes(
    other.name.split(" ")[0] ?? "?",
  ),
  "et le panneau nomme le jeu qu'on est en train de lancer",
);

// Les choix portent le code de l'emplacement: « 1 » est celui où tout est
// débloqué, et ce nombre vient de `saves::Slot` côté worker.
await press("#pick-1");
// Attendre la CONDITION plutôt qu'une durée. L'écran de chargement s'efface dès
// que le jeu peint, donc une pause fixe passe ou rate selon la vitesse du
// démarrage, et un test qui rate au hasard est un test qu'on apprend à ignorer.
say(
  await until(() => (document.getElementById("booting")?.textContent ?? "").includes("débloqué")),
  "l'écran de chargement rappelle la sauvegarde choisie",
);
// Et chez l'autre, qui n'a rien demandé. Le nom du jeu qu'il lit vient de la
// bibliothèque du SALON, pas de la page qui a cliqué.
const seen = await watcher.evaluate(async (wanted) => {
  for (let tries = 0; tries < 40; tries++) {
    const said = document.getElementById("booting")?.textContent ?? "";
    if (said.includes(wanted)) return said;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}, other.name.split(" ")[0] ?? "?");
say(seen !== null, "l'autre navigateur voit aussi le chargement, avec le nom du jeu");
say(seen?.includes("débloqué") ?? false, `et la sauvegarde annoncée (${seen?.slice(0, 60)})`);
await new Promise((r) => setTimeout(r, 22000));

// Le jumeau du témoin, et c'est le pire défaut possible: un écran de chargement
// posé chez les autres et jamais retiré laisserait toute la salle devant du noir
// pendant que le jeu tourne derrière. Il doit partir quand l'image revient.
say(
  await watcher.evaluate(async () => {
    for (let tries = 0; tries < 60; tries++) {
      if (document.getElementById("booting") === null) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }),
  "et cet écran s'en va chez lui quand la salle repeint",
);

say(kept("chosen-save") === "1", `l'emplacement retenu est « tout débloqué » (${kept("chosen-save")})`);
const after = pointedAt("USA");
say(after !== before, "le dossier de carte a changé d'emplacement");
say(
  after?.endsWith("/debloquee") ?? false,
  `et il pointe vers l'emplacement débloqué (${after})`,
);
say(
  after?.includes(other.name.toLowerCase().split(" ")[0] ?? "?") ?? false,
  "sous le dossier du jeu demandé",
);

// Le jumeau, et il n'est pas décoratif: les trois vérifications au-dessus
// passeraient toutes si la page envoyait TOUJOURS « tout débloqué », ou si le
// worker avait gardé la valeur d'un essai précédent. Relancer le premier jeu sur
// « partie neuve » est la seule chose qui prouve que le choix voyage vraiment.
await press("#openMenu");
await new Promise((r) => setTimeout(r, 1200));
// Et pour revenir: un jeu à cartes lui aussi, pour la même raison.
const back =
  room.game?.console === "gc"
    ? room.game.index
    : (room.library.find((g) => g.console === "gc" && g.index !== other.index)?.index ?? 0);
await press(`#item-game${back}`);
await new Promise((r) => setTimeout(r, 1200));
await press("#pick-0");
say(
  await until(() => (document.getElementById("booting")?.textContent ?? "").includes("neuve")),
  "l'écran de chargement annonce la partie neuve",
);
await new Promise((r) => setTimeout(r, 22000));
say(kept("chosen-save") === "0", `puis l'emplacement retenu redevient neuf (${kept("chosen-save")})`);
say(
  pointedAt("USA")?.endsWith("/neuve") ?? false,
  `et le dossier de carte suit (${pointedAt("USA")})`,
);

// Et le jeu Wii, qui range sa partie AILLEURS mais en a bien deux.
//
// Une GameCube écrit dans une carte mémoire, une Wii dans sa propre mémoire sous
// l'identifiant du titre. Deux chemins, un seul choix à l'écran. La console est
// lue sur le disque par `dolphin-tool`, pas déduite du nom du dossier.
const wii = room.library.find((g) => g.console === "wii");
if (wii) {
  await press("#openMenu");
  await new Promise((r) => setTimeout(r, 1200));
  // Les jeux sont rangés par console: il faut ouvrir l'étagère avant.
  await press("#item-shelf-wii");
  await new Promise((r) => setTimeout(r, 1000));
  await press(`#item-game${wii.index}`);
  await new Promise((r) => setTimeout(r, 1200));
  const panel = await page.evaluate(() => document.getElementById("picker")?.textContent ?? "");
  say(panel.includes("tout débloqué"), `un jeu Wii a lui aussi ses deux emplacements (${wii.name})`);
  // Et sa MANETTE, dans le même panneau. Une seule des deux, jamais les deux:
  // elles lisent le même tuyau, et un jeu qui voit les deux compte deux manettes
  // pour une personne. À deux joueurs, le premier occupe deux places et le
  // second n'entre jamais — mesuré sur Mario Kart Wii le 31 août 2026.
  say(
    panel.includes("manette GameCube") && panel.includes("Wiimote"),
    "et le choix de la manette, au même endroit",
  );
  const lignes = await page.evaluate(
    () => document.querySelectorAll('#picker [id^="pick-"]').length,
  );
  say(lignes === 4, `quatre combinaisons proposées (${lignes})`);
  await page.keyboard.press("Escape");
} else {
  console.log("  (aucun jeu Wii dans la bibliothèque: rien à vérifier de ce côté)");
}

await browser.close();
console.log(bad === 0 ? "PASS — chaque jeu a ses deux sauvegardes" : `ÉCHEC — ${bad}`);
process.exit(bad === 0 ? 0 : 1);
