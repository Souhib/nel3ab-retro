/**
 * À qui va une touche du clavier: au jeu, ou à la page ?
 *
 * # Pourquoi une seule règle
 *
 * La boucle d'entrée écoutait le clavier sur toute la fenêtre et prenait chaque
 * touche liée à la manette. Entrée est START: sur un bouton de la colonne, elle
 * partait au jeu et le bouton ne s'activait jamais (audit A11Y-01, mesuré le
 * 22 novembre 2026 sur « détails » et sur « menu »). Le menu, lui, prenait
 * Entrée et Espace pour l'entrée sous son curseur, même quand le focus était sur
 * un autre bouton (A11Y-02). Deux écouteurs, deux idées différentes de qui
 * possède le clavier.
 *
 * La règle tient maintenant en une phrase: le clavier du jeu vit dans la zone de
 * jeu. Partout ailleurs, Tab, Entrée, Espace et les flèches font ce que fait le
 * navigateur.
 *
 * # Et quand personne n'a le focus ?
 *
 * Le document lui-même reçoit alors les touches (`body`). On les donne au jeu:
 * aucune commande de la page ne les réclame, et un clic sur un texte de la
 * colonne, qui laisse le focus au document, ne doit pas couper la partie. C'est
 * aussi l'état d'une page qui vient de s'ouvrir.
 */

/** L'attribut posé sur la zone de jeu. Un attribut et pas un `id`: un pilote
 * ou un essai peut le poser sur son propre élément. */
export const ZONE_JEU = "data-zone-jeu";

/** Vrai quand une touche reçue par `cible` doit aller au jeu. */
export function clavierAuJeu(cible: EventTarget | null): boolean {
  // Personne n'a le focus: la fenêtre, le document, ou rien du tout.
  // Les deux tests de la fenêtre, parce que jsdom les sépare: la fenêtre
  // globale n'y est pas une instance de `Window`, et la cible d'un événement
  // envoyé à la fenêtre n'y est pas la fenêtre globale. Un navigateur répond oui
  // aux deux.
  if (
    cible === null ||
    cible === globalThis ||
    (typeof Window !== "undefined" && cible instanceof Window) ||
    cible instanceof Document
  )
    return true;
  if (!(cible instanceof Element)) return false;
  if (cible === cible.ownerDocument.body || cible === cible.ownerDocument.documentElement)
    return true;
  return cible.closest(`[${ZONE_JEU}]`) !== null;
}

/**
 * Faut-il dire que le clavier ne joue plus ?
 *
 * Le prix de la règle du dessus: après un clic sur un bouton de la colonne, les
 * flèches restent à la colonne. Sans le dire, ça ressemble à un jeu qui ne
 * répond plus. On ne le dit qu'à qui joue au clavier en ce moment: une partie
 * en cours, une place tenue, ni téléphone ni manette, aucun menu ouvert.
 */
export function clavierEnPause({
  partie,
  place,
  appareil,
  menu,
  auJeu,
}: {
  /** Un jeu tourne. */
  partie: boolean;
  /** Cette page tient une manette. */
  place: boolean;
  appareil: "clavier" | "manette" | "tactile";
  /** Un menu ou un dialogue a la main: il a ses propres touches. */
  menu: boolean;
  /** Ce que `clavierAuJeu` dit de l'élément qui a le focus. */
  auJeu: boolean;
}): boolean {
  return partie && place && appareil === "clavier" && !menu && !auJeu;
}

/**
 * L'anneau de focus de la zone reste-t-il après cette touche ?
 *
 * L'anneau dit où Tab vient d'arriver. Pendant une partie, il longeait l'image
 * d'un trait de 3 px, alors que ce projet protège justement l'image de ce qui
 * tire l'oeil (relecture du 22 novembre 2026). Il se pose donc à l'arrivée par
 * Tab (`Screen`) et s'efface à la première touche qui joue. Tab et les touches
 * qui ne jouent pas seules (Maj, Ctrl, Alt, Cmd) le gardent: elles annoncent un
 * déplacement du focus, pas une partie.
 */
export function anneauApresTouche(code: string): boolean {
  return code === "Tab" || /^(Shift|Control|Alt|Meta)(Left|Right)?$/.test(code);
}

/**
 * Rendre le clavier au jeu après ce clic ?
 *
 * Le prix de la règle d'un seul focus: un clic de souris sur une prise ou sur
 * un mode de la colonne y laissait le focus (Chrome et Firefox le donnent au
 * bouton cliqué, Safari non), et les flèches ne poussaient plus le stick jusqu'à
 * un clic sur l'image. Après un geste PONCTUEL fait au pointeur pendant une
 * partie, le focus revient donc à la zone. Une activation au clavier garde son
 * focus: la personne a choisi ce bouton. Un bouton qui OUVRE quelque chose (le
 * menu, les touches) n'est pas ponctuel: l'écran ouvert prend le focus.
 */
export function rendreAuJeuApresClic({
  pointeur,
  partie,
  ponctuel,
}: {
  /** Le clic vient d'un pointeur (`MouseEvent.detail > 0`), pas d'Entrée. */
  pointeur: boolean;
  /** Un jeu tourne, hors chargement. */
  partie: boolean;
  /** Le bouton porte `data-rend-le-jeu`. */
  ponctuel: boolean;
}): boolean {
  return pointeur && partie && ponctuel;
}

/** L'attribut des boutons ponctuels de la colonne (`rendreAuJeuApresClic`). */
export const REND_LE_JEU = "data-rend-le-jeu";
