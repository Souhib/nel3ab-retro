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
 * Ce qu'on touche à chaque soirée d'abord: l'image et le son. Puis l'allure,
 * qu'on choisit une fois pour toutes. Les réglages pointus viennent en dernier,
 * repliés.
 *
 * # Les manettes ont quitté ce rayon
 *
 * Régler sa manette demandait Échap, deux flèches droite, neuf flèches bas et
 * Entrée: « touches et manettes » était la dixième entrée sur quinze, après
 * l'écran et le son, et trois autres réglages de manette étaient éparpillés
 * autour (audit P12, 22 novembre 2026). Ils ont maintenant leur rubrique,
 * `MANETTES`, et « réglages » ne garde que l'image, le son et l'allure.
 *
 * # Avancé, replié
 *
 * La fréquence de la carte son, l'image calée sur le son et l'état de la
 * connexion servent à qui cherche une panne, pas à qui joue. Ils restent dans
 * le menu, derrière une entrée « réglages avancés » qui les déplie
 * (`avecAvances`). Un réglage replié n'est pas un réglage perdu: l'entrée qui
 * les déplie dit lesquels elle cache.
 */

/** Un réglage: son identifiant, et le sujet auquel il appartient. */
export type Arranged = { id: string; group: string };

/** Le groupe replié par défaut. */
export const AVANCE = "avancé";

/** L'ordre affiché sous « réglages », et le seul endroit où il se décide. */
export const SETTINGS: readonly Arranged[] = [
  { id: "fullscreen", group: "image et son" },
  { id: "fit", group: "image et son" },
  { id: "half", group: "image et son" },
  { id: "sound", group: "image et son" },
  { id: "volume", group: "image et son" },
  { id: "theme", group: "allure" },
  { id: "shell", group: "allure" },
  { id: "bare", group: "allure" },
  { id: "columnWidth", group: "allure" },
  { id: "advanced", group: AVANCE },
  { id: "deviceRate", group: AVANCE },
  { id: "lipsync", group: AVANCE },
  { id: "connexion", group: AVANCE },
] as const;

/** L'ordre affiché sous « manettes »: d'abord ta manette et tes touches, puis
 * l'appareil des jeux Wii, puis le téléphone. */
export const MANETTES: readonly Arranged[] = [
  { id: "bindings", group: "ta manette" },
  { id: "pad", group: "jeux Wii" },
  { id: "touchpad", group: "téléphone" },
  { id: "padonly", group: "téléphone" },
] as const;

/**
 * Range les entrées dans l'ordre d'une table, et pose le sujet sur chacune.
 *
 * Ce qui n'est pas dans la table passe À LA FIN plutôt que de disparaître. Un
 * réglage qu'on ajoute sans penser à la table doit rester atteignable: le voir
 * mal placé se remarque et se corrige, ne plus le voir du tout se cherche.
 */
export function arrange<T extends { id: string }>(
  items: T[],
  table: readonly Arranged[] = SETTINGS,
): (T & { group?: string })[] {
  const rank = new Map(table.map((one, at) => [one.id, at]));
  const group = new Map(table.map((one) => [one.id, one.group]));
  return [...items]
    .sort((left, right) => (rank.get(left.id) ?? 999) - (rank.get(right.id) ?? 999))
    .map((item) => ({ ...item, group: group.get(item.id) }));
}

/**
 * Les réglages visibles: le groupe avancé replié derrière son entrée.
 *
 * L'entrée qui déplie (`advanced`) reste à sa place, ouverte ou non: le
 * curseur qui vient de la choisir ne doit pas se retrouver sur une autre
 * ligne. Ouverte, les réglages avancés la suivent.
 */
export function avecAvances<T extends { id: string; group?: string }>(
  items: T[],
  ouvert: boolean,
): T[] {
  return items.filter((item) => ouvert || item.group !== AVANCE || item.id === "advanced");
}
