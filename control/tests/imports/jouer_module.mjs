// Exécute `ouJouer` de la page de dépôt sous Node, avec un faux `fetch`.
//
// Reçoit sur son entrée une liste de cas: pour chaque cas, la réponse de
// `GET /api/salles` et celle de `POST /api/salles` (`null` si le cas ne doit
// pas l'appeler). Rend, pour chaque cas, ce que `ouJouer` décide et les
// requêtes qu'il a faites.
import { text } from "node:stream/consumers";

import { ouJouer } from "../../nel3ab_control/api/routes/importer.mjs";

const cas = JSON.parse(await text(process.stdin));
const rendus = [];
for (const { salles, ouvre } of cas) {
  const faites = [];
  const demander = async (adresse, options = {}) => {
    const methode = options.method ?? "GET";
    faites.push(`${methode} ${adresse}`);
    const corps = methode === "POST" ? ouvre : salles;
    return { ok: corps.status < 400, status: corps.status, json: async () => corps.corps };
  };
  rendus.push({ ...(await ouJouer(demander)), faites });
}
process.stdout.write(JSON.stringify(rendus));
