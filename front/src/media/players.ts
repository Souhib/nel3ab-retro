/**
 * Les quatre couleurs de joueur, et pourquoi elles ne suivent pas le thème.
 *
 * Rien dans le matériel n'est coloré: les prises d'une GameCube sont toutes du
 * même plastique noir. Mais tous les jeux qui ont demandé « lequel es-tu ? » ont
 * répondu dans ces couleurs-là, alors ce sont celles qu'un joueur reconnaît. Les
 * faire changer avec l'ambiance reviendrait à repeindre le joueur 1 en vert.
 */
export const PLAYER_COLOURS = ["#d9534f", "#4a86d9", "#d9b64a", "#4aab5c"] as const;

/** Les mêmes joueurs, pour ÉCRIRE: « P1 » à « P4 ».
 *
 * L'aplat ci-dessus peint une barre ou une fiche. Écrit tel quel en 11 px sur
 * le thème clair, celui du joueur 3 tombait à 1,81:1 (audit visuel du
 * 22 novembre 2026). L'encre est un jeton de `src/regie.css`, de même teinte,
 * qui change de clarté avec le thème; `lib/regie.test.ts` calcule qu'elle tient
 * 4,5:1 sur chaque surface, case teintée du joueur comprise. */
export const PLAYER_INKS = [
  "var(--p1-encre)",
  "var(--p2-encre)",
  "var(--p3-encre)",
  "var(--p4-encre)",
] as const;

/** Ce que la prise montre quand on est sur le point de la prendre à quelqu'un. */
export const ARMING_COLOUR = "#e0913a";
