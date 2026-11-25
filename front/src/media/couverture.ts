/**
 * La couverture de l'image : ce qui se montre à la place d'une image qui
 * n'est pas là, et qui se lève à la toute première image peinte.
 *
 * # La règle qu'elle tient
 *
 * Rien ne passe sur une image vivante (ADR D37, D40). Le plein cadre d'une
 * arrivée, la neige d'une connexion coupée et l'image arrêtée assombrie ne
 * sont permis que parce que l'image ne bouge pas. Le jour où elle bouge de
 * nouveau, ils doivent partir DANS LA MÊME IMAGE D'ÉCRAN, sans fondu.
 *
 * React ne peut pas le faire : il lit l'état deux fois par seconde. Le rideau
 * d'avant ce chantier était retiré au relevé suivant, et la proposition du
 * 23 novembre 2026 a mesuré dix images peintes dessous. La levée est donc
 * faite par la boucle de peinture elle-même (`video.ts`, `paint`), juste
 * après chaque image : un appel, une comparaison, et un attribut retiré quand
 * il y a quelque chose à lever.
 *
 * # Les jetons
 *
 * Chaque couverture est un jeton posé sur `:root[data-couverture]`. Les
 * feuilles (`components/etat-salle.css`) ne montrent un plein cadre, une
 * neige ou une image assombrie que sous leur jeton : retirer l'attribut les
 * éteint toutes d'un coup, sans que React ait à rendre quoi que ce soit.
 *
 * - « plein » : l'écran noir de la borne, à l'arrivée et pour une salle
 *   fermée ou qui ne répond pas avant toute image ;
 * - « passee » : l'image ARRÊTÉE, assombrie (décision K20 du propriétaire) ;
 * - « neige » : le signal perdu à la place de l'image, connexion coupée ;
 * - « coupure » : un quart de seconde de neige sur le plein cadre, à
 *   l'entrée dans une salle, au niveau « tout » (`PleinCadre`). Une
 *   transition, pas un état : elle se retire seule, et la première image la
 *   lève comme le reste.
 *
 * # L'invariant
 *
 * Aucune image peinte après l'armement n'est jamais couverte : `lever` la
 * découvre. Et aucune image peinte AVANT l'armement mais après la décision
 * ne l'est non plus : `armer` reçoit le compte d'images que l'état a vu
 * (`vues()` relevé dans l'instantané), et refuse si une image plus neuve est
 * déjà là. Sans ce refus, un état décidé sur un relevé vieux de 500 ms
 * couvrirait une image arrivée entre-temps.
 */

export const JETONS = ["plein", "passee", "neige", "coupure"] as const;
export type Jeton = (typeof JETONS)[number];

/** L'attribut de la racine que les feuilles lisent. */
export const ATTRIBUT = "data-couverture";

/** Les images peintes depuis le chargement de la page, toutes salles
 * confondues : un compteur à elle, parce que celui d'un flux repart de zéro
 * à chaque nouvelle session. */
let peintes = 0;
/** Les jetons posés. Au plus quatre : les parcourir n'est pas un coût. */
const poses = new Set<Jeton>();

function ecrire(): void {
  const racine = document.documentElement;
  if (poses.size === 0) racine.removeAttribute(ATTRIBUT);
  else racine.setAttribute(ATTRIBUT, [...poses].join(" "));
}

/** Combien d'images la couverture a vu peindre. L'instantané le relève au
 * moment où il décide l'état (`session.ts`). */
export const vues = (): number => peintes;

/**
 * Pose un jeton, si aucune image plus neuve que `vu` n'a été peinte.
 *
 * Rend vrai si le jeton est posé (ou l'était déjà), faux s'il est refusé :
 * l'image a bougé depuis la décision, il n'y a rien à couvrir.
 */
export function armer(jeton: Jeton, vu: number): boolean {
  if (peintes > vu) return false;
  if (!poses.has(jeton)) {
    poses.add(jeton);
    ecrire();
  }
  return true;
}

/** Retire un jeton : l'état est parti sans qu'une image ne le lève. */
export function retirer(jeton: Jeton): void {
  if (poses.delete(jeton)) ecrire();
}

const toujours = (): boolean => true;

/**
 * Une image vient d'être peinte. Appelé par la boucle de peinture, juste
 * après `this.painted += 1`, et par elle seule.
 *
 * Sans allocation, et le plus souvent une addition et une comparaison : en
 * partie, il n'y a rien à lever. Rend faux quand une couverture reste
 * posée faute de boîte juste (`decouvrir`).
 */
export function lever(juste: () => boolean = toujours): boolean {
  peintes += 1;
  return decouvrir(juste);
}

/**
 * Lève la couverture si la toile a la boîte de l'image peinte, sans compter
 * d'image. Rend vrai quand plus rien ne couvre l'image.
 *
 * La boucle de peinture l'appelle à chaque tic tant qu'une levée attend sa
 * boîte : une image restée fixe après la première (un menu arrêté) ne doit
 * pas garder la couverture jusqu'à l'image suivante.
 *
 * # Pourquoi attendre la boîte
 *
 * La toile est taillée par React, sur l'instantané. À la première image
 * d'un format qu'il n'a pas encore vu, elle a encore la boîte d'avant : le
 * format attendu de la console, ou l'image du jeu précédent. Levée là, la
 * couverture montrait l'image étirée, 13 images à 1440x900 (relecture
 * finale du 25 novembre 2026). Elle reste donc le temps que la session
 * relise l'instantané (`VideoStream.onFormat`), une image ou deux.
 */
export function decouvrir(juste: () => boolean): boolean {
  if (poses.size === 0) return true;
  if (!juste()) return false;
  poses.clear();
  document.documentElement.removeAttribute(ATTRIBUT);
  return true;
}

/** L'écart de proportions toléré entre la boîte et l'image : 2 %, moins
 * qu'un pixel sur une boîte de 50 px, bien moins que l'écart entre 4:3 et
 * une GameCube en 640x528 (9 %). */
const ECART_PROPORTIONS = 0.02;

/**
 * La toile a-t-elle la boîte de cette image ?
 *
 * `Screen` dit pour quelle image il a taillé la toile : `data-boite`
 * (« 640x480 », ou « 4x3 » sur le format attendu) et `data-proportions`
 * quand la boîte ne dépend que des proportions (« remplir »). Lire deux
 * attributs ne demande aucune mise en page. Une toile sans `data-boite`
 * n'est taillée par personne : elle a la taille de ses pixels.
 */
export function boiteJuste(
  toile: HTMLCanvasElement,
  image: { width: number; height: number },
): boolean {
  const boite = toile.dataset.boite;
  if (boite === undefined) return true;
  const [largeur, hauteur] = boite.split("x").map(Number);
  if (!(largeur > 0 && hauteur > 0)) return false;
  if (toile.dataset.proportions === undefined)
    return largeur === image.width && hauteur === image.height;
  const voulu = image.width / image.height;
  return Math.abs(largeur / hauteur - voulu) <= ECART_PROPORTIONS * voulu;
}

/** Les jetons posés, pour les pilotes (`nel3abTest.couverture()`). */
export const jetons = (): Jeton[] => [...poses];
