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

/**
 * Une image vient d'être peinte. Appelé par la boucle de peinture, juste
 * après `this.painted += 1`, et par elle seule.
 *
 * Sans allocation, et le plus souvent une addition et une comparaison : en
 * partie, il n'y a rien à lever.
 */
export function lever(): void {
  peintes += 1;
  if (poses.size === 0) return;
  poses.clear();
  document.documentElement.removeAttribute(ATTRIBUT);
}

/** Les jetons posés, pour les pilotes (`nel3abTest.couverture()`). */
export const jetons = (): Jeton[] => [...poses];
