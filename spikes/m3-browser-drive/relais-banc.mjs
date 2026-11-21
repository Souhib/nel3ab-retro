// Deux relais sans aucune limite, pour que le banc passe par la paire virtuelle.
//
// Le navigateur reste dans l'espace réseau de la machine et vise l'adresse de
// l'espace du banc. Là, un premier relais reçoit la connexion et la passe par une
// socket Unix, que les deux espaces partagent puisqu'elle vit sur le disque. Le
// second relais, côté machine, la reprend vers la salle sur 127.0.0.1.
//
// Pourquoi ce détour plutôt qu'un relais unique côté machine: le pare-feu de la
// machine refuse ce qui ENTRE, et le navigateur placé dans l'espace du banc
// entrait. Ici il sort, et les réponses reviennent sur une connexion établie, que
// le pare-feu accepte déjà. Aucune règle n'est ajoutée au pare-feu.
//
// Aucun des deux ne limite rien: toute la dégradation vient de `tc netem` sur la
// paire virtuelle. Ils ajoutent des tampons, comme le proxy en service.
//
//   node relais-banc.mjs <écoute> <cible>
//   <écoute> et <cible>: `adresse:port` ou `unix:/chemin`
import fs from "node:fs";
import net from "node:net";

const [ecoute, cible] = process.argv.slice(2);
if (!ecoute || !cible) throw new Error("usage: relais-banc.mjs <écoute> <cible>");

const adresse = (texte) => {
  if (texte.startsWith("unix:")) return { path: texte.slice(5) };
  const [host, port] = texte.split(/:(?=\d+$)/);
  return { host, port: Number(port) };
};

const serveur = net.createServer((client) => {
  const autre = net.connect(adresse(cible));
  client.setNoDelay?.(true);
  autre.setNoDelay?.(true);
  client.pipe(autre);
  autre.pipe(client);
  // `pipe` termine l'autre bout quand un bout finit, APRÈS avoir écrit ce qui
  // restait. La première version détruisait les deux bouts dès qu'un se fermait:
  // les octets encore en route étaient jetés, et sous gigue la page arrivait
  // tronquée de 33 Ko, sans son bouton d'entrée. Détruire reste réservé à l'erreur.
  const fin = () => {
    client.destroy();
    autre.destroy();
  };
  for (const bout of [client, autre]) bout.on("error", fin);
});
const lieu = adresse(ecoute);
if (lieu.path) fs.rmSync(lieu.path, { force: true });
serveur.listen(lieu, () => {
  if (lieu.path) fs.chmodSync(lieu.path, 0o666);
  console.error(`relais ${ecoute} -> ${cible}`);
});
