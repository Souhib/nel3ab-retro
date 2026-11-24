// Exécute `rayonDe`, `pileDe` et `phrasePile` de la page de dépôt sous Node.
//
// Reçoit `{ jeux, noms, envois, piles }` et rend la rangée, la pile comptée
// et la phrase de chaque nombre de `piles`.
import { text } from "node:stream/consumers";

import { phrasePile, pileDe, rayonDe } from "../../nel3ab_control/api/routes/importer.mjs";

const entree = JSON.parse(await text(process.stdin));
process.stdout.write(
  JSON.stringify({
    rayon: rayonDe(entree.jeux, entree.noms),
    pile: pileDe(entree.envois),
    phrases: (entree.piles ?? []).map(phrasePile),
  }),
);
