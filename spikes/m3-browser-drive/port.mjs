// Le port d'un pilote navigateur, et de son banc.
//
// Jusqu'au 24 novembre 2026, chaque pilote avait un port fixe : 5473 pour
// `etats.mjs`, 5477 pour `parcours.mjs`, 5478 pour `cadre.mjs`, 5481 pour
// `focus.mjs`, et ainsi de suite. Plusieurs chantiers lancent leurs portes en
// même temps sur cette machine, et deux pilotes du même nom se heurtaient :
// pendant la vague B2, `etats-navigateur-rouge` n'a pas pu prendre 5473, qu'un
// autre chantier tenait, et il a fallu relancer ses commandes à la main sur
// un autre port. Les recettes `-rouge` n'acceptaient pas de port du tout.
//
// Sans `--port`, le banc écoute sur le port 0 : le système lui donne un port
// libre (de 32768 à 60999 sur cette machine), qu'aucun autre processus ne
// tient au moment où il le prend. `--port N` en impose un, de 5400 à 5999 :
// une plage loin des ports vivants (8100, 8101, 8110, 8111, 8200) et des
// services de la machine (Jellyfin, 8096), pour qu'une faute de frappe ne
// prenne pas l'un d'eux. La liste des ports que Chrome refuse d'ouvrir
// (`net/base/port_util.cc` de Chromium) saute de 5061 à 6000 et s'arrête à
// 10080 : aucun des deux domaines n'y tombe.
import { createServer } from "node:net";

export const PLAGE = Object.freeze([5400, 5999]);

/** Le port 0 (le système choisit), ou un port de la plage ; sinon une erreur. */
export function verifierPort(port, quoi = "port") {
  if (port === 0) return 0;
  if (Number.isInteger(port) && port >= PLAGE[0] && port <= PLAGE[1]) return port;
  throw new Error(`${quoi} ${port} : un port de ${PLAGE[0]} à ${PLAGE[1]}, ou rien pour un port libre`);
}

/** Le port demandé par `--<nom> N` dans `args`, ou 0 sans l'option. */
export function portDemande(args, nom = "port") {
  const i = args.indexOf(`--${nom}`);
  if (i < 0) return 0;
  const valeur = args[i + 1];
  // `Number("")` et `Number(undefined)` ne doivent pas passer pour 0 : une
  // option sans valeur est une faute, pas une demande de port libre.
  if (valeur === undefined || !/^\d+$/.test(valeur)) throw new Error(`--${nom} attend un nombre, reçu « ${valeur ?? ""} »`);
  return verifierPort(Number(valeur), `--${nom}`);
}

/** Fait écouter `serveur` sur 127.0.0.1 et rend le port obtenu. Un port
 * déjà pris rejette la promesse : il ne lève pas un événement que personne
 * n'écoute, et le pilote s'arrête en le disant. */
export function ecouter(serveur, port) {
  verifierPort(port);
  return new Promise((ok, refus) => {
    serveur.once("error", refus);
    serveur.listen(port, "127.0.0.1", () => {
      serveur.off("error", refus);
      ok(serveur.address().port);
    });
  });
}

/** Un port libre pour un processus qu'on lance soi-même (Vite en
 * sous-processus, avec `--strictPort`). Entre la fermeture de la sonde et
 * l'écoute du processus, un autre peut le prendre : le processus refuse alors
 * de démarrer, il ne partage rien. */
export async function portLibre() {
  const sonde = createServer();
  const port = await ecouter(sonde, 0);
  await new Promise((ok) => sonde.close(ok));
  return port;
}
