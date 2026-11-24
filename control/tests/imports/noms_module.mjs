// Exécute le lecteur des noms de consoles de la page de dépôt sous Node.
//
// Reçoit sur son entrée une liste: pour chaque cas, le texte de l'élément
// `#noms-consoles` de la page, ou `null` quand la page n'en a pas. Rend ce que
// `nomsConsoles` en lit. L'essai Python lui donne le texte de la VRAIE page
// servie, et ses jumeaux cassés.
import { text } from "node:stream/consumers";

import "./mots_du_salon.mjs";
import { nomsConsoles } from "../../nel3ab_control/api/routes/importer.mjs";

const cas = JSON.parse(await text(process.stdin));
const rendus = cas.map((contenu) =>
  nomsConsoles({
    getElementById: (id) => (id === "noms-consoles" && contenu !== null ? { textContent: contenu } : null),
  }),
);
process.stdout.write(JSON.stringify(rendus));
