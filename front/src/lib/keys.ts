/**
 * Les jeux de touches d'une personne, nommés, et celui qui joue.
 *
 * # Ce que c'est, et surtout ce que ce n'est pas
 *
 * Des correspondances touche vers commande, et rien d'autre. C'est PERSONNEL:
 * en changer ne touche ni la salle, ni la partie, ni l'écran de qui que ce soit.
 *
 * Ils ont été liés au type de manette pendant une demi-heure — un jeu de touches
 * pour la manette GameCube, un pour la Wiimote, un pour la guitare — et c'était
 * une faute de conception, pas un détail. Le type de manette est un réglage de la
 * SALLE: Dolphin le lit au démarrage, donc en changer relance la partie de tout
 * le monde. Accrocher un réglage personnel à celui-là faisait redémarrer le jeu
 * de quatre personnes parce qu'une seule voulait régler ses touches.
 *
 * Deux choses de portées différentes ne partagent pas un bouton.
 *
 * # Une seule règle: il y en a toujours au moins un, et il est toujours actif
 *
 * Aucun état où le clavier ne fait rien. Un dossier vide donne un profil nommé
 * `défaut` avec la disposition d'origine, effacer le dernier est refusé, et un
 * nom actif qui ne désigne rien retombe sur le premier de la liste.
 */
import { DEFAULT_KEYS, type KeyProfile } from "../media/pad";

/** Le nom du profil qu'on a quand on n'a rien demandé. */
export const DEFAULT_NAME = "défaut";

/** Ce qu'un nom peut mesurer. Assez pour « guitare hero », assez peu pour que la
 * rangée de boutons reste une rangée. */
export const NAME_MAX = 24;

/** Ce que le navigateur garde: les profils par nom, et celui qui joue.
 *
 * `locked` n'est PAS rangé: il vient de la salle et se recalcule à chaque
 * chargement. Le ranger ferait vieillir la liste et, pire, ferait partir les
 * profils de la salle au service comme s'ils étaient personnels — la garantie
 * « je peux toujours y revenir » tomberait le jour où quelqu'un les modifie.
 */
export type KeySet = {
  byName: Record<string, KeyProfile>;
  active: string;
  /** Les noms qui viennent de la salle. Ils ne s'éditent ni ne s'effacent. */
  locked: string[];
};

/** Ce qui sépare le nom d'un profil de salle du nom que quelqu'un a tapé.
 *
 * # Pourquoi un préfixe plutôt qu'un drapeau à côté
 *
 * Les collisions sont CERTAINES, pas hypothétiques: la référence contiendra un
 * profil « défaut » et tous ceux qui ont déjà réglé leurs touches en ont un
 * aussi, puisque c'est le nom que la migration donne. Un préfixe rend la
 * collision impossible par construction, là où un drapeau demanderait une règle
 * d'arbitrage — et une règle d'arbitrage sur un nom finit toujours par cacher un
 * profil à quelqu'un.
 *
 * Il est refusé à la création, sinon on pourrait fabriquer un faux profil de
 * salle.
 */
export const ROOM_MARK = "salle · ";

/** Un dossier neuf: un seul profil, la disposition d'origine. */
export function fresh(): KeySet {
  return { byName: { [DEFAULT_NAME]: { ...DEFAULT_KEYS } }, active: DEFAULT_NAME, locked: [] };
}

/**
 * Relit ce qui était rangé, quelle que soit sa forme.
 *
 * # Trois formes, et pourquoi aucune ne porte de numéro de version
 *
 * - `{ byName, active }`: celle-ci.
 * - `{ byPad: { 0: ..., 2: ... } }`: la demi-heure où les touches suivaient la
 *   manette. Les codes redeviennent des noms, donc personne ne perd un réglage.
 * - `{ KeyX: {...} }`: le profil à plat, celle qui a vécu des mois et qui est
 *   sur les disques des gens.
 *
 * Les trois se distinguent par une clé que les autres ne peuvent pas porter, et
 * c'est ce qui remplace un numéro: écrire une version dans la forme à plat est
 * précisément ce qu'on ne peut plus faire, elle est déjà écrite.
 *
 * Tout le reste rend un dossier neuf. Un réglage illisible est un réglage qu'on
 * remplace, pas une page qui refuse de démarrer.
 */
export function readKeySet(raw: unknown): KeySet {
  if (!isRecord(raw)) return fresh();

  const byName = raw["byName"];
  if (isRecord(byName)) {
    const kept = onlyProfiles(byName);
    if (Object.keys(kept).length === 0) return fresh();
    const asked = raw["active"];
    return {
      byName: kept,
      active: settled(kept, typeof asked === "string" ? asked : ""),
      locked: [],
    };
  }

  const byPad = raw["byPad"];
  if (isRecord(byPad)) {
    const named: Record<string, KeyProfile> = {};
    for (const [code, profile] of Object.entries(onlyProfiles(byPad))) {
      named[PAD_NAMES[code] ?? `manette ${code}`] = profile;
    }
    if (Object.keys(named).length === 0) return fresh();
    return { byName: named, active: settled(named, DEFAULT_NAME), locked: [] };
  }

  // La forme à plat. Ce qu'elle contient est le profil lui-même.
  if (Object.keys(raw).length === 0) return fresh();
  return { byName: { [DEFAULT_NAME]: raw as KeyProfile }, active: DEFAULT_NAME, locked: [] };
}

/** Comment s'appelaient les jeux de touches déduits du type de manette. */
const PAD_NAMES: Record<string, string> = {
  "0": DEFAULT_NAME,
  "1": "Wiimote",
  "2": "guitare",
};

function isRecord(found: unknown): found is Record<string, unknown> {
  return typeof found === "object" && found !== null && !Array.isArray(found);
}

function onlyProfiles(found: Record<string, unknown>): Record<string, KeyProfile> {
  const out: Record<string, KeyProfile> = {};
  for (const [name, profile] of Object.entries(found)) {
    if (isRecord(profile)) out[name] = profile as KeyProfile;
  }
  return out;
}

/** Un nom actif qui désigne vraiment quelque chose. */
function settled(byName: Record<string, KeyProfile>, asked: string): string {
  if (byName[asked]) return asked;
  return Object.keys(byName)[0] ?? DEFAULT_NAME;
}

/** Le profil qui joue, en copie: personne ne modifie le dossier par surprise. */
export function playing(set: KeySet): KeyProfile {
  return { ...(set.byName[set.active] ?? DEFAULT_KEYS) };
}

/** Les noms, dans l'ordre où ils ont été créés. */
export function names(set: KeySet): string[] {
  return Object.keys(set.byName);
}

/** Le dossier, avec le profil ACTIF remplacé. */
export function edited(set: KeySet, keys: KeyProfile): KeySet {
  return { ...set, byName: { ...set.byName, [set.active]: keys } };
}

/** Le dossier, en jouant celui-là. Un nom inconnu ne change rien. */
export function activated(set: KeySet, name: string): KeySet {
  return set.byName[name] ? { ...set, active: name } : set;
}

/**
 * Le dossier, avec un profil de plus, actif, COPIE de celui qui jouait.
 *
 * Une copie et non la disposition d'origine: on crée un profil pour changer deux
 * touches, pas pour tout refaire. Rendre du vide obligerait à réapprendre seize
 * commandes à chaque fois, ce qui est exactement le travail qu'un profil évite.
 *
 * Un nom vide, trop long ou déjà pris ne change rien. Deux profils du même nom,
 * ce serait un profil qu'on croit régler et un autre qui joue.
 */
export function added(set: KeySet, name: string): KeySet {
  const wanted = name.trim().slice(0, NAME_MAX);
  // Le préfixe de la salle est refusé: sinon on fabriquerait un faux profil de
  // salle, verrouillé pour personne et affiché comme une référence.
  if (wanted === "" || set.byName[wanted] || wanted.startsWith(ROOM_MARK)) return set;
  return { ...set, byName: { ...set.byName, [wanted]: playing(set) }, active: wanted };
}

/**
 * Le dossier, sans celui-là.
 *
 * Le DERNIER ne s'efface pas: un dossier vide voudrait dire un clavier qui ne
 * fait rien, et « oublier » est un bouton qui doit laisser la salle jouable.
 */
export function removed(set: KeySet, name: string): KeySet {
  // Un profil de la salle ne s'oublie pas depuis ici: il n'appartient pas à
  // cette personne, et le retirer localement le ferait revenir au prochain
  // chargement — un bouton qui a l'air de marcher et ne marche pas.
  if (set.locked.includes(name)) return set;
  if (!set.byName[name] || Object.keys(set.byName).length <= 1) return set;
  const byName = { ...set.byName };
  delete byName[name];
  return { ...set, byName, active: settled(byName, set.active) };
}

/**
 * Ce qui est RANGÉ, sans jamais un profil de la salle.
 *
 * # L'invariant qui porte toute la garantie
 *
 * Les profils de la salle sont fusionnés à l'affichage et n'appartiennent à
 * personne. S'ils repartaient au service dans le dossier de quelqu'un, ils
 * deviendraient des copies personnelles: modifiables, donc perdables, et figées
 * au jour où elles ont été copiées. « Je peux y revenir quoi qu'il arrive »
 * tomberait sans qu'aucune erreur ne s'affiche.
 *
 * C'est pour ça que cette fonction existe au lieu de ranger `set` tel quel, et
 * c'est pour ça qu'un essai la vérifie plutôt que de faire confiance à l'ordre
 * des appels.
 */
export function mine(set: KeySet): { byName: Record<string, KeyProfile>; active: string } {
  const byName: Record<string, KeyProfile> = {};
  for (const [name, profile] of Object.entries(set.byName)) {
    if (!set.locked.includes(name)) byName[name] = profile;
  }
  // Le nom actif aussi: si la salle jouait, ranger son nom ferait rouvrir la
  // page sur un profil qui n'est pas dans le dossier, donc sur le premier venu.
  // On garde alors le premier profil personnel, qui existe toujours.
  const active = byName[set.active] ? set.active : (Object.keys(byName)[0] ?? DEFAULT_NAME);
  return { byName, active };
}

/**
 * Le dossier personnel, plus ce que la salle propose, verrouillé.
 *
 * Les noms de la salle sont préfixés, donc aucune collision n'est possible avec
 * ce que quelqu'un a nommé lui-même.
 */
export function withRoom(set: KeySet, room: Record<string, KeyProfile>): KeySet {
  const byName = { ...set.byName };
  const locked: string[] = [];
  for (const [name, profile] of Object.entries(room)) {
    const shown = `${ROOM_MARK}${name}`;
    byName[shown] = profile;
    locked.push(shown);
  }
  return { byName, active: settled(byName, set.active), locked };
}

/** Le nom qu'un profil de la salle porte dans la salle, sans son préfixe. */
export function roomName(shown: string): string {
  return shown.startsWith(ROOM_MARK) ? shown.slice(ROOM_MARK.length) : shown;
}
