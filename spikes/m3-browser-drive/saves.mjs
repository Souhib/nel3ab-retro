// Deux sauvegardes par jeu, et le choix qui décide sur laquelle on joue.
//
// Ce que la CI ne peut pas prouver: qu'un jeu écrit bien dans l'emplacement
// choisi. Le worker fait pointer le dossier de carte de Dolphin vers cet
// emplacement, et une erreur là ne donne pas une erreur: elle donne une partie
// qui écrase la mauvaise sauvegarde, ce qui ne se voit qu'une fois trop tard.
import { execFileSync } from "node:child_process";
import { existsSync, readlinkSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";

import { enterRoom, launchPrepared, openRoom, ROOM_URL, salleDe, watchRoom } from "./open.mjs";

let bad = 0;
const say = (ok, what) => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
};

// L'adresse en argument, et le répertoire d'état SOUS la salle: ce pilote
// lisait les cartes mémoire dans `session/`, l'ancien répertoire unique, que
// plus aucun worker n'alimente depuis la bascule multi-salles.
const url = process.argv[2] ?? ROOM_URL;
const numero = salleDe(url);
if (numero === null) {
  console.log(`RIEN TESTÉ — impossible de déduire le numéro de salle de « ${url} ».`);
  process.exit(1);
}
const SESSION = join(homedir(), `.local/state/nel3ab/salles/${numero}`);
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

/** « Cette place a-t-elle le droit de changer de jeu ? », demandé au WORKER.
 *
 * Le port de contrôle d'une salle est le second de sa paire, `81N1`, et le
 * proxy ne le relaie pas: seul un programme de cette machine l'atteint. C'est
 * ce qui fait la différence entre une règle et une convention d'affichage.
 *
 * `null` quand il ne répond pas, et ce n'est PAS « non ». Un worker muet est un
 * worker qui redémarre, ce qu'il fait à chaque changement de jeu; confondre les
 * deux ferait passer une salle absente pour une salle qui refuse.
 */
const peutDecider = (salle, place) =>
  new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port: 8100 + salle * 10 + 1 }, () =>
      socket.write(`decides ${place}\n`),
    );
    const fin = (valeur) => {
      socket.destroy();
      resolve(valeur);
    };
    socket.setTimeout(2000);
    socket.on("data", (bloc) => {
      const dit = bloc.toString().trim();
      fin(dit === "yes" ? true : dit === "no" ? false : null);
    });
    socket.on("timeout", () => fin(null));
    socket.on("error", () => fin(null));
  });

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await openRoom(browser, url);
await enterRoom(page);
await new Promise((r) => setTimeout(r, 5000));

// Un DEUXIÈME navigateur, qui ne touche à rien. Il est là pour le défaut le
// plus visible de tous: pendant un changement de jeu, seul celui qui cliquait
// voyait l'écran de chargement. Les autres regardaient dix secondes de noir.
//
// Par la porte SPECTATEUR, et c'est une correction du 13 septembre 2026. Il
// entrait par la porte joueur et prenait donc une manette, ce qui en faisait un
// PARTICIPANT de la préparation. « Lancer le jeu » ne s'active que lorsque tout
// le monde s'est dit prêt; ce témoin ne se déclarait jamais, et le pilote
// bloquait donc son propre lancement pendant vingt secondes avant d'expirer.
// Un spectateur voit l'écran de chargement, qui est tout ce qu'on lui demande.
const watcher = await openRoom(browser, url);
await watchRoom(watcher);
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
// personne: c'est lui qui accepte ou refuse le changement de jeu. Elle se
// DEMANDE à lui, comme le salon le fait, et ne se relit pas dans la page.
//
// Ce bloc lisait `room.owner.seat`, qui répond à une AUTRE question. Le salon y
// publie la place de la DERNIÈRE session d'une personne, et ce pilote ouvre
// lui-même un second onglet, sous la même identité, pour regarder l'écran de
// chargement. Cet onglet prenait la place 2, le salon publiait donc 2, et le
// pilote se refusait l'accès à lui-même. Le 13 septembre 2026 il s'arrêtait
// ainsi avant sa première assertion utile, en annonçant qu'une autre place
// décidait: le worker, lui, répondait « yes » aux deux places.
const mySeat = await page.evaluate(() => window.nel3abTest?.counters?.().port ?? null);
const verdict = mySeat === null ? false : await peutDecider(numero, mySeat);
if (verdict !== true) {
  console.log(
    `  IGNORÉ — la salle ${numero} ne laisse pas la place ${mySeat ?? "aucune"} changer de jeu` +
      ` (${verdict === null ? "worker muet" : "refus"})`,
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
// Les jeux sont rangés par CONSOLE: `#item-gameN` n'existe pas au premier
// niveau du menu, il faut ouvrir l'étagère avant. Ce pilote le faisait déjà
// pour la Wii, plus bas dans ce fichier, et l'oubliait ici. Le 13 septembre
// 2026, ses onze vérifications suivantes échouaient donc toutes en aval d'un
// jeu qui n'avait jamais été lancé, et aucune ne décrivait un défaut.
await press("#item-shelf-gc");
await new Promise((r) => setTimeout(r, 1000));
// Le jeu d'abord: une pression ouvre le sélecteur de sauvegarde, elle ne lance
// rien, et le panneau DIT sur quoi on part.
//
// Ce commentaire annonçait « c'est le panneau qui confirme », ce que la mesure
// du 13 septembre 2026 dément: presser un emplacement ouvre la préparation à
// lui seul, sans passer par un bouton de confirmation. C'est la préparation qui
// confirme désormais, et elle a son propre écran.
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
// Le temps que la page RÉAGISSE, comme après chaque autre pression de ce
// fichier. Sans cette pause, l'aide démarrait dans le même souffle que le clic:
// `#pickerConfirm` était encore dans le DOM, elle le pressait une seconde fois,
// et redemandait une préparation déjà ouverte. Mesuré le 13 septembre 2026 en
// rejouant la séquence pas à pas: deux secondes après `#pick-1`, le panneau a
// disparu et `#launchPrepared` est là, et il y est encore cinq secondes plus
// tard. C'est une course que l'insertion de l'aide avait créée, pas un défaut
// de la page.
await new Promise((r) => setTimeout(r, 2000));
// Et jusqu'au BOUT: choisir un emplacement n'allume rien non plus, ça ouvre une
// préparation. Le jeu ne part qu'après « Je suis prêt » puis « Lancer le jeu »,
// et cette séquence vit dans `open.mjs` pour n'être oubliée nulle part.
await launchPrepared(page);
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
await press("#item-shelf-gc");
await new Promise((r) => setTimeout(r, 1000));
// Et pour revenir: un jeu à cartes lui aussi, pour la même raison.
const back =
  room.game?.console === "gc"
    ? room.game.index
    : (room.library.find((g) => g.console === "gc" && g.index !== other.index)?.index ?? 0);
await press(`#item-game${back}`);
await new Promise((r) => setTimeout(r, 1200));
await press("#pick-0");
await new Promise((r) => setTimeout(r, 2000));
await launchPrepared(page);
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
  say(panel.includes("tout débloqué"), `un jeu Wii a lui aussi ses emplacements (${wii.name})`);
  // Et sa manette n'est PLUS ici, ce qui est le sens de l'assertion et non son
  // contraire. Ce bloc exigeait « manette GameCube » ET « Wiimote » dans le même
  // panneau, du temps où choisir une partie voulait dire choisir aussi son
  // appareil. La manette est devenue un RÉGLAGE de personne, qui vit sur l'écran
  // des touches et suit son propriétaire de salle en salle; `front/src/lib/
  // saves.test.ts` épingle l'invariant à l'envers de l'ancienne attente, en
  // refusant que le panneau prononce « manette », « Wiimote » ou « Nunchuk ».
  // Le pilote contredisait donc un choix délibéré, et le 13 septembre 2026 il
  // criait au défaut devant une page correcte.
  say(
    !/manette|Wiimote|Nunchuk/i.test(panel),
    "et le panneau ne mêle plus la manette au choix de la partie",
  );
  const lignes = await page.evaluate(
    () => document.querySelectorAll('#picker [id^="pick-"]').length,
  );
  // TROIS, et le nombre vient de `Slot` côté worker: partie neuve, tout
  // débloqué, et celle de la personne. Le quatrième choix qu'attendait ce
  // pilote était une COMBINAISON sauvegarde × manette, qui n'existe plus.
  //
  // Le troisième n'apparaît que si le salon sait qui demande, et c'est pour ça
  // que ce pilote exige le proxy: sans identité la page n'en propose que deux,
  // et l'assertion dirait « défaut » là où il n'y a qu'une absence d'identité.
  say(lignes === 3, `les trois emplacements sont proposés (${lignes})`);
  await page.keyboard.press("Escape");
} else {
  console.log("  (aucun jeu Wii dans la bibliothèque: rien à vérifier de ce côté)");
}

await browser.close();
console.log(bad === 0 ? "PASS — le choix de sauvegarde voyage jusqu'au disque" : `ÉCHEC — ${bad}`);
process.exit(bad === 0 ? 0 : 1);
