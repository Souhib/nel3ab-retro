// Tout ce que la page CALCULE doit être quelque part à l'écran.
//
// # Pourquoi ce garde existe
//
// Trois pannes de cette semaine ont coûté une soirée chacune, et les trois se
// sont résolues sur un chiffre que la page calculait déjà sans l'afficher:
//
// - les images JETÉES avant leur tour, qui expliquaient 58 % de peintes;
// - les PLACES dans la file, qui à côté du chiffre précédent donnaient la
//   réponse en une seconde;
// - le NOMBRE de manettes vues, qui aurait dit tout de suite qu'un adaptateur en
//   présente quatre.
//
// Un compteur qu'on tient sans le montrer ne sert à personne le jour où il faut
// chercher. Ce fichier échoue quand un champ d'instantané n'apparaît nulle part
// dans les composants.
//
// # Ce qu'il ne prétend pas faire
//
// C'est une lecture de TEXTE, pas une analyse. Un champ affiché sous un autre
// nom lui échapperait, et un nom qui traîne dans un commentaire le tromperait.
// D'où la liste d'exceptions plus bas, où chaque entrée porte sa raison: c'est
// moins fin qu'un vrai contrôle et ça a déjà attrapé sept chiffres cachés.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Les instantanés que la page publie, et où ils sont écrits. */
const SNAPSHOTS = [
  ["src/media/video.ts", "VideoStats"],
  ["src/media/sound.ts", "SoundStats"],
  ["src/media/input.ts", "InputState"],
];

/**
 * Ce qui n'a pas à être affiché, et pourquoi.
 *
 * Chaque entrée est une décision, pas une commodité: un champ qu'on dispense
 * d'affichage doit dire ce qu'il est, sinon la liste devient l'endroit où on
 * range ce qu'on ne veut pas expliquer.
 */
const EXCUSED = new Map([
  // Le coût de la sonde de luminosité, en millisecondes.
  //
  // Pas affiché parce qu'il vaut ZÉRO pendant une partie, par construction: la
  // sonde ne tourne que dans les quinze secondes qui suivent un changement de
  // jeu, donc une ligne « sonde 0,0 ms » occuperait le relevé en permanence pour
  // ne rien dire. Mais le chiffre existe et se lit — c'est un pilote qui l'a lu,
  // et c'est comme ça qu'on a su qu'une première version coûtait 15,1 ms au p95
  // et faisait tomber le débit de 60 à 50 images par seconde.
  //
  // La règle du fichier reste la bonne: un compteur qu'on tient sans le montrer
  // ne sert à personne. Celui-ci se montre à la demande, dans
  // `just browser-loading`, et c'est ce qui justifie l'exception.
  ["probeMs", "nul pendant une partie; lu par les pilotes, mesuré le 2026-08-31"],
]);

const root = new URL(".", import.meta.url).pathname;
const components = readdirSync(join(root, "src/components"))
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(root, "src/components", name), "utf8"))
  .join("\n");
const page = readFileSync(join(root, "src/App.tsx"), "utf8");
const shown = components + page;

let missing = 0;
for (const [file, name] of SNAPSHOTS) {
  const source = readFileSync(join(root, file), "utf8");
  const block = new RegExp(`export type ${name} = \\{(.*?)\\n\\};`, "s").exec(source);
  if (!block) {
    console.log(`AUDIT — ${name} introuvable dans ${file}`);
    missing += 1;
    continue;
  }
  const fields = [...block[1].matchAll(/^ {2}(\w+)\??:/gm)].map((found) => found[1]);
  for (const field of fields) {
    if (EXCUSED.has(field)) continue;
    if (shown.includes(field)) continue;
    console.log(`AUDIT — ${name}.${field} est calculé et n'apparaît nulle part`);
    missing += 1;
  }
}

if (missing > 0) {
  console.log(
    "\nAfficher le chiffre, ou l'inscrire dans EXCUSED avec sa raison.\n" +
      "Un compteur qu'on tient sans le montrer ne sert à personne le jour où il faut chercher.",
  );
  process.exit(1);
}
console.log("tout ce que la page calcule est affiché quelque part");
