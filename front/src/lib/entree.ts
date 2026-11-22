/**
 * Entrer, inviter, sortir: ce que l'adresse dit de la salle.
 *
 * # L'état « entré » dans l'adresse (audit P9, 22 novembre 2026)
 *
 * L'état « entré pour jouer » ou « pour regarder » ne vivait qu'en mémoire.
 * La page propose elle-même « Recharger la page » quand l'image n'arrive pas,
 * et un rechargement ramenait à l'avant-salle: il rendait la place et
 * redemandait d'entrer. `?entrer=jouer` et `?entrer=regarder` portent cet état:
 * un rechargement revient dans la salle, comme on l'avait quittée.
 *
 * Les mêmes adresses servent l'accueil du salon (« Rejoindre », « Regarder »)
 * et l'invitation: un lien copié entre directement.
 *
 * # Une seule sortie (audit P8)
 *
 * « quitter », « les salles », et « quitter la salle » avec l'aide « retour à
 * l'accueil » menaient à deux pages différentes, et « accueil » désignait les
 * deux. Quitter la salle mène maintenant aux autres salles, quand un salon
 * existe au-dessus; servie seule, la page revient à son avant-salle.
 */

/** Comment on est entré: pour jouer, ou pour regarder. */
export type Entree = "play" | "watch";

/** Le nom du paramètre, et ses deux mots: ceux qu'un humain lit dans un lien. */
export const PARAM = "entrer";
const MOTS: Record<Entree, string> = { play: "jouer", watch: "regarder" };

/** L'entrée que l'adresse demande, ou rien. Un mot inconnu ne vaut rien: une
 * faute de frappe ne doit pas faire prendre une place à qui voulait regarder. */
export function entreeDeLAdresse(search: string): Entree | null {
  const dit = new URLSearchParams(search).get(PARAM);
  if (dit === MOTS.play) return "play";
  if (dit === MOTS.watch) return "watch";
  return null;
}

/** La même adresse, avec ou sans l'entrée. Le reste de l'adresse est gardé. */
export function adresseAvec(href: string, entree: Entree | null): string {
  const url = new URL(href);
  if (entree === null) url.searchParams.delete(PARAM);
  else url.searchParams.set(PARAM, MOTS[entree]);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Le salon est-il au-dessus de cette page ?
 *
 * Derrière le proxy, une salle est servie sous `/r/N/` et la racine porte la
 * liste des salles. Servie EN DIRECT par le worker, la même page est déjà la
 * racine: un retour y rechargerait la salle qu'on voulait quitter. On ne montre
 * donc le retour que lorsqu'il mène quelque part, plutôt que d'afficher un
 * bouton qui ment.
 */
export const salonAuDessus = (chemin: string): boolean => /^\/r\/[1-9]\d*\//.test(chemin);

/** Où mène « Quitter la salle »: la liste des salles, ou `null` pour revenir à
 * l'avant-salle quand il n'y a pas de liste au-dessus. */
export function sortieVers(chemin: string): string | null {
  return salonAuDessus(chemin) ? "/" : null;
}

/** Le lien d'invitation: cette salle, pour jouer.
 *
 * `chemin` est le préfixe de la salle (`lib/base`), `origine` celle de la page.
 * Le lien ne marche que pour qui est déjà sur le réseau privé: l'invitation le
 * dit en une ligne, elle n'ouvre rien d'elle-même. */
export function lienDInvitation(origine: string, chemin: string): string {
  const prefixe = chemin.endsWith("/") ? chemin : `${chemin}/`;
  return `${origine}${prefixe}?${PARAM}=${MOTS.play}`;
}
