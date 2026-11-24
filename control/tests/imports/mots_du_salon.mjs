// Les mots du salon sous Node, posés comme la page les pose.
//
// `importer.mjs` lit `globalThis.nel3abMots`, que `retro.py` pose dans la
// page avant le module (`retro/mots.js`, la table de `retro/mots.json`
// dedans). Sous Node, il n'y a pas de page: ce module exécute les deux mêmes
// fichiers. Il s'importe AVANT `importer.mjs`: les imports d'un module
// s'évaluent dans l'ordre où ils sont écrits.
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

const RETRO = new URL("../../nel3ab_control/api/routes/retro/", import.meta.url);
const code = readFileSync(new URL("mots.js", RETRO), "utf-8");
const table = readFileSync(new URL("mots.json", RETRO), "utf-8");
runInThisContext(code.replace("/*__MOTS__*/", table));
