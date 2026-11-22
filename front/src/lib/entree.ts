/**
 * Entrer, inviter, sortir: ce que l'adresse dit de la salle.
 *
 * # L'état « entré » dans l'adresse (audit P9, 22 novembre 2026)
 *
 * L'état « entré pour jouer » ou « pour regarder » ne vivait qu'en mémoire.
 * La page propose elle-même « Recharger la page » quand l'image n'arrive pas,
 * et un rechargement ramenait à l'avant-salle: il rendait la place et
 * redemandait d'entrer. `?entrer=jouer` et `?entrer=regarder` portent cet état:
 * un rechargement revient dans la salle, en joueur ou en spectateur.
 *
 * L'adresse SUIT la session, pas la porte d'entrée (`entreeDeLaSession`): la
 * première version écrivait l'entrée une fois, et un spectateur qui prenait
 * une place la perdait au rechargement (relecture du 22 novembre 2026). Elle
 * ne garantit pas la MÊME place: le worker donne la première libre.
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

/** L'entrée qui correspond à ce que fait la session: regarder, ou jouer.
 *
 * `watching` est l'intention de la session (`InputStream`): vraie après
 * « Rendre ma place » ou un lancement solo d'un autre, fausse après « Prendre
 * une place ». Une place qu'on attend encore compte comme jouer: c'est ce
 * qu'un rechargement doit redemander. */
export const entreeDeLaSession = (watching: boolean): Entree => (watching ? "watch" : "play");

/** Ce que `retenirEntree` lit et réécrit, passé pour être remplacé dans un essai. */
export type Adresse = { readonly href: string };
export type Historique = {
  readonly state: unknown;
  replaceState: (etat: unknown, titre: string, url: string) => void;
};

/** Écrit l'entrée dans l'adresse, sans étape d'historique, si elle change.
 *
 * Une adresse qu'on ne peut pas réécrire (un cadre bac à sable) laisse l'état
 * en mémoire: la salle marche, seul le rechargement l'oublie. */
export function retenirEntree(
  entree: Entree | null,
  adresse: Adresse = location,
  historique: Historique = history,
): void {
  if (entreeDeLAdresse(new URL(adresse.href).search) === entree) return;
  try {
    historique.replaceState(historique.state, "", adresseAvec(adresse.href, entree));
  } catch {
    // Voir plus haut: l'état reste en mémoire.
  }
}
