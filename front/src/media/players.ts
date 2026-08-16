/**
 * Les quatre couleurs de joueur, et pourquoi elles ne suivent pas le thème.
 *
 * Rien dans le matériel n'est coloré: les prises d'une GameCube sont toutes du
 * même plastique noir. Mais tous les jeux qui ont demandé « lequel es-tu ? » ont
 * répondu dans ces couleurs-là, alors ce sont celles qu'un joueur reconnaît. Les
 * faire changer avec l'ambiance reviendrait à repeindre le joueur 1 en vert.
 */
export const PLAYER_COLOURS = ["#d9534f", "#4a86d9", "#d9b64a", "#4aab5c"] as const;

/** Ce que la prise montre quand on est sur le point de la prendre à quelqu'un. */
export const ARMING_COLOUR = "#e0913a";
