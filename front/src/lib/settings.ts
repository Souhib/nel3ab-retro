/**
 * L'ordre et les groupes des réglages.
 *
 * # Pourquoi une table plutôt que l'ordre du JSX
 *
 * Les quatorze réglages étaient déclarés dans l'ordre où on les avait ajoutés,
 * ce qui donnait: `son` en première position, `volume` en sixième, et
 * `fréquence de la carte son` en onzième. Trois réglages du même sujet séparés
 * par huit autres, et personne ne l'avait décidé — c'est juste l'ordre dans
 * lequel ils sont nés.
 *
 * Réordonner quatre cents lignes de JSX aurait marché une fois. Une table dit
 * l'ordre en quatorze lignes lisibles d'un coup, et le prochain réglage se place
 * en écrivant son nom au bon endroit plutôt qu'en déplaçant un bloc.
 *
 * # Pourquoi des groupes et pas des séparateurs
 *
 * Les trois coques indexent la sélection sur la POSITION visuelle: une colonne
 * qui glisse de `row * hauteur`, une grille de quatre colonnes, une file qui
 * glisse de `row * largeur`. Insérer un titre entre deux entrées casserait ce
 * calcul dans les trois, pour un gain qu'on obtient autrement: les entrées d'un
 * même sujet se suivent, et la coque affiche le sujet à côté du nom du rayon.
 *
 * # L'ordre est celui de l'usage
 *
 * Ce qu'on touche à chaque soirée d'abord — l'écran et le son — puis les
 * manettes, qu'on règle une fois, puis l'allure, qu'on choisit une fois pour
 * toutes.
 */

/** Un réglage: son identifiant, et le sujet auquel il appartient. */
export type Arranged = { id: string; group: string };

/** L'ordre affiché, et le seul endroit où il se décide. */
export const SETTINGS: readonly Arranged[] = [
  { id: "fullscreen", group: "écran" },
  { id: "fit", group: "écran" },
  { id: "half", group: "écran" },
  { id: "bare", group: "écran" },
  { id: "sound", group: "son" },
  { id: "volume", group: "son" },
  { id: "lipsync", group: "son" },
  { id: "deviceRate", group: "son" },
  { id: "bindings", group: "manettes" },
  { id: "pad", group: "manettes" },
  { id: "touchpad", group: "manettes" },
  { id: "padonly", group: "manettes" },
  { id: "theme", group: "allure" },
  { id: "shell", group: "allure" },
] as const;

/**
 * Range les entrées dans cet ordre, et pose le sujet sur chacune.
 *
 * Ce qui n'est pas dans la table passe À LA FIN plutôt que de disparaître. Un
 * réglage qu'on ajoute sans penser à la table doit rester atteignable: le voir
 * mal placé se remarque et se corrige, ne plus le voir du tout se cherche.
 */
export function arrange<T extends { id: string }>(items: T[]): (T & { group?: string })[] {
  const rank = new Map(SETTINGS.map((one, at) => [one.id, at]));
  const group = new Map(SETTINGS.map((one) => [one.id, one.group]));
  return [...items]
    .sort((left, right) => (rank.get(left.id) ?? 999) - (rank.get(right.id) ?? 999))
    .map((item) => ({ ...item, group: group.get(item.id) }));
}
