/**
 * Les consoles, telles que la salle les range.
 *
 * Le code vient du disque, lu par `dolphin-tool`: voir `emulator::disc`. Ici on
 * ne fait que le nommer et l'ordonner pour l'écran.
 *
 * L'ordre est celui des sorties, parce que c'est celui qu'une étagère a: la
 * GameCube d'abord, la Wii ensuite. Un tri alphabétique mettrait la Wii en
 * premier et ferait bouger les dossiers le jour où une troisième console
 * arrive.
 */

/** Ce qu'un code de console vaut à l'écran, dans l'ordre d'affichage. */
export const CONSOLES: readonly { code: string; label: string; note: string }[] = [
  { code: "gc", label: "GameCube", note: "carte mémoire, deux sauvegardes par jeu" },
  { code: "wii", label: "Wii", note: "sauvegarde dans la console, deux par jeu" },
  // Un disque dont l'outil n'a pas su dire la console. Il a quand même son
  // dossier: le cacher ferait disparaître un jeu de la salle sans rien dire, et
  // un jeu qu'on ne voit plus est pire qu'un jeu mal rangé.
  { code: "?", label: "à classer", note: "le disque n'a pas dit de quelle console il est" },
] as const;

/** Le nom d'une console, ou son code faute de mieux. */
export function consoleLabel(code: string): string {
  return CONSOLES.find((one) => one.code === code)?.label ?? code;
}
