// Exécute le module de la page de dépôt sous Node, comme le navigateur le ferait.
//
// Reçoit sur son entrée une liste JSON de chemins de fichiers, les ouvre en
// `Blob` adossé au fichier (comme un `File` de la page), et rend pour chacun
// l'estimation et l'empreinte rapide. L'essai Python compare au serveur.
import { openAsBlob } from "node:fs";
import { text } from "node:stream/consumers";

import { LU, empreinteRapide, estimer } from "../../nel3ab_control/api/routes/importer.mjs";

const chemins = JSON.parse(await text(process.stdin));
const rendus = [];
for (const chemin of chemins) {
  const fichier = await openAsBlob(chemin);
  const debut = new Uint8Array(await fichier.slice(0, LU).arrayBuffer());
  const trouve = estimer(debut);
  rendus.push({
    chemin,
    console: trouve.console,
    format: trouve.format,
    empreinte: await empreinteRapide(fichier),
  });
}
process.stdout.write(JSON.stringify(rendus));
