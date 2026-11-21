// Exécute les fonctions pures du trousseau de la page de dépôt sous Node.
//
// Reçoit une liste JSON de personnes, telle que `/api/importeurs` la rend, et
// rend pour chacune son nom affiché, ses étiquettes, sa couleur de prise
// (calculée deux fois) et son rang.
import { text } from "node:stream/consumers";

import { nomDe, priseDe, pucesDe, rangDe } from "../../nel3ab_control/api/routes/importer.mjs";

const personnes = JSON.parse(await text(process.stdin));
process.stdout.write(
  JSON.stringify(
    personnes.map((p) => ({
      nom: nomDe(p),
      puces: pucesDe(p),
      prise: priseDe(p.login),
      prise_encore: priseDe(p.login),
      rang: rangDe(p),
    })),
  ),
);
