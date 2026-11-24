// Exécute `changerImage` de la page de dépôt sous Node, contre un faux salon.
//
// Reçoit une liste de cas `{ octets: [..] | null, statut, detail }`: ce que la
// page envoie, et ce que le salon répond. Rend, pour chacun, la demande vue par
// le faux salon et l'issue que la page en tire.
import { text } from "node:stream/consumers";

import { changerImage } from "../../nel3ab_control/api/routes/importer.mjs";

const cas = JSON.parse(await text(process.stdin));
const rendus = [];
for (const un of cas) {
  let vue = null;
  const demander = async (adresse, options) => {
    vue = {
      adresse,
      methode: options.method,
      type: options.headers?.["Content-Type"] ?? null,
      octets: options.body ? [...new Uint8Array(options.body)] : null,
    };
    if (un.statut === 0) throw new Error("réseau coupé");
    return {
      ok: un.statut >= 200 && un.statut < 300,
      status: un.statut,
      json: async () => (un.detail === undefined ? {} : { detail: un.detail }),
    };
  };
  const octets = un.octets === null ? null : new Uint8Array(un.octets).buffer;
  rendus.push({ vue, issue: await changerImage("Zelda: Wind Waker.iso", octets, demander) });
  rendus[rendus.length - 1].vue = vue;
}
process.stdout.write(JSON.stringify(rendus));
