// La page et la salle sont-elles d'accord sur ce qui peut être transporté ?
//
// Ce que la CI ne peut pas prouver: le demi-format n'existe pas pour toutes les
// tailles d'image, et ça ne se voit qu'avec un vrai encodeur devant un vrai jeu.
// L'encodeur veut un nombre entier de macroblocs de seize, et la moitié de 912
// n'en est pas un. Une salle sans petit flux démarre quand même — c'est le bon
// choix — mais une page restée sur ce réglage recevait ZÉRO image en gardant le
// son. Un écran noir que ni le rechargement ni le vidage du cache ne réparaient,
// puisque le réglage vit dans le navigateur.
import { execFileSync, execSync } from "node:child_process";
import puppeteer from "puppeteer";

import { enterRoom, openRoom, ROOM_URL } from "./open.mjs";

let bad = 0;
const say = (ok, what) => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
};

/** Le NOM DE FICHIER d'un jeu, que le catalogue ne donne pas: il ne montre que
 * le nom nettoyé. On le retrouve sur le disque, dans les dossiers de la salle. */
const wiiFile = (name) => {
  const first = name.split(" (")[0];
  const found = execSync(
    `ls ~/roms/*/ | grep -F ${JSON.stringify(first)} | head -1`,
  )
    .toString()
    .trim();
  if (!found) throw new Error(`aucun fichier pour « ${name} »`);
  return found;
};

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await openRoom(browser, ROOM_URL);

// Le cas du défaut: une page qui ARRIVE avec le format réduit retenu.
await page.evaluateOnNewDocument(() => localStorage.setItem("nel3ab:half", "1"));
await page.reload({ waitUntil: "domcontentloaded" });
await enterRoom(page);

const said = await page.evaluate(async () => {
  const answer = await fetch("/formats", { cache: "no-store" });
  return answer.ok ? await answer.json() : { status: answer.status };
});
say(typeof said.half === "boolean", `la salle dit ce qu'elle sait produire (${JSON.stringify(said)})`);

await new Promise((r) => setTimeout(r, 15000));
const seen = await page.evaluate(() => ({
  painted: window.nel3abTest?.counters?.().painted ?? 0,
  width: window.nel3abTest?.pacing?.().pictureW ?? 0,
  kept: localStorage.getItem("nel3ab:half"),
}));

// Le point qui compte, et il vaut dans les DEUX cas: une page qui a demandé le
// petit flux doit voir des images. Que ce soit parce que la salle le produit, ou
// parce qu'elle a dit non et que la page est retombée sur le grand.
say(seen.painted > 100, `l'image arrive (${seen.painted} images peintes)`);

if (said.half === false) {
  say(seen.kept === "0", "et la page a lâché un format que la salle ne produit pas");
  say(
    await page.evaluate(() => window.nel3abTest?.counters?.().padOnly === false),
    "sans devenir une page-manette au passage",
  );
} else {
  // Le jumeau, sur un jeu dont la moitié tombe juste: la page GARDE son choix.
  // Sans cette moitié, une page qui basculerait toujours en plein format
  // passerait le test au-dessus et retirerait le réglage à tout le monde.
  say(seen.kept === "1", "et sur un jeu qui s'y prête, la page garde son choix");
  say(seen.width > 0 && seen.width < 800, `sur le petit flux (${seen.width} px de large)`);
}

// Et le scénario qui a coûté une soirée: une page RESTÉE OUVERTE pendant que la
// salle change pour un jeu dont l'image ne se divise pas.
//
// Elle redemandait à l'infini un flux que la salle ne produit plus, gardait le
// son — qui passe par une autre socket — et restait sur son écran de chargement.
// Seul un rechargement la réparait, parce que la question n'était posée qu'au
// démarrage. Mesuré avant le correctif: 699 images peintes, puis 702, puis plus
// rien.
//
// Le pilote CHANGE le jeu de la salle par le fichier de choix, pas par
// l'interface: ce qu'on éprouve ici est la traversée d'un redémarrage, pas le
// droit de décider.
const roms = JSON.parse(execFileSync("curl", ["-s", "http://127.0.0.1:8100/roms"]).toString());
const wii = roms.roms.find((r) => r.console === "wii");
const was = roms.roms[roms.current];
if (wii && said.half === true) {
  const before = await page.evaluate(() => window.nel3abTest?.counters?.().painted ?? 0);
  execFileSync("bash", [
    "-c",
    `printf '%s' ${JSON.stringify(wiiFile(wii.name))} > ~/.local/state/nel3ab/session/chosen-rom`,
  ]);
  execFileSync("sudo", ["-n", "systemctl", "restart", "nel3ab-worker"]);
  // Attendre la CONDITION, pas une durée: le temps de démarrage d'un jeu Wii
  // varie de trente à quarante-cinq secondes selon ce que le pilote graphique a
  // déjà compilé. Une pause fixe passe ou rate au hasard, et un essai qui rate
  // au hasard est un essai qu'on apprend à ignorer.
  let after = { painted: before, width: 0 };
  for (let tries = 0; tries < 90 && after.painted < before + 300; tries++) {
    await new Promise((r) => setTimeout(r, 1000));
    after = await page.evaluate(() => ({
      painted: window.nel3abTest?.counters?.().painted ?? 0,
      width: window.nel3abTest?.pacing?.().pictureW ?? 0,
    }));
  }
  say(
    after.painted >= before + 300,
    `la page survit à un changement de jeu qui retire son format (${before} → ${after.painted})`,
  );
  say(after.width > 800, `et elle est passée à la pleine taille (${after.width} px)`);
  // La salle est rendue comme on l'a trouvée.
  execFileSync("bash", [
    "-c",
    `printf '%s' ${JSON.stringify(wiiFile(was.name))} > ~/.local/state/nel3ab/session/chosen-rom`,
  ]);
  execFileSync("sudo", ["-n", "systemctl", "restart", "nel3ab-worker"]);
} else {
  console.log("  (pas de jeu Wii, ou pas de demi-format ici: rien à traverser)");
}

await browser.close();
console.log(bad === 0 ? "PASS — la page et la salle sont d'accord sur le format" : `ÉCHEC — ${bad}`);
process.exit(bad === 0 ? 0 : 1);
