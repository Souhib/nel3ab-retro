// Exécute les phrases de la page de dépôt sous Node.
//
// Reçoit `{ personnes, envois }` et rend, pour chaque personne, ce que sa
// ligne du trousseau montre (nom, phrase, bouton, rang), et pour chaque envoi
// pas fini, la phrase de sa carte.
import { text } from "node:stream/consumers";

import { boutonDe, nomDe, phraseDe, phraseEnvoi, rangDe } from "../../nel3ab_control/api/routes/importer.mjs";

const { personnes = [], envois = [] } = JSON.parse(await text(process.stdin));
process.stdout.write(
  JSON.stringify({
    personnes: personnes.map((p) => ({
      nom: nomDe(p),
      phrase: phraseDe(p),
      bouton: boutonDe(p),
      rang: rangDe(p),
    })),
    envois: envois.map(phraseEnvoi),
  }),
);
