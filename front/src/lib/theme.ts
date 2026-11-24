/**
 * Deux régies, et l'appareil qui choisit entre elles.
 *
 * La salle porte la régie du salon (`src/regie.css`): la nuit, en bleu marine,
 * et le jour, en givre, depuis le thème rétro du 23 novembre 2026 (ADR D37;
 * graphite et craie avant). Sans choix, la page suit le réglage
 * clair ou sombre du système; un choix explicite l'emporte et se garde dans le
 * navigateur.
 *
 * Il y en avait sept jusqu'au 22 novembre 2026. Plusieurs ne tenaient pas leurs
 * promesses (la console et le canapé ne changeaient pas de couleur, des boutons
 * se coupaient en phosphore), chaque nouveau composant devait penser à sept
 * palettes, et aucune ne suivait le système: une personne en mode clair sur
 * son téléphone recevait une page noire. La nostalgie reste dans les menus de
 * console, qui sont des costumes et pas des thèmes.
 *
 * Un thème ne change que des couleurs. Il ne touche ni la disposition, ni ce
 * qui est affiché, ni l'image: la zone d'écran reste noire dans les deux.
 *
 * Le thème s'écrit sur `<html>`, pas dans un contexte React: la couleur de fond
 * doit être posée avant le premier rendu de React. Et c'est la FEUILLE qui suit
 * le système, par `prefers-color-scheme`, pas ce script: avec « comme
 * l'appareil », la page est juste dès sa première image, script lancé ou non.
 *
 * Un choix CONTRE le système ne peut pas attendre ce module, lancé après la
 * lecture du document: sa première image portait le thème du système.
 * Mesuré le 22 novembre 2026 sur la page construite, dans Chrome sans écran:
 * « nuit » sous un système clair y était encore en craie quatre fois sur
 * quatre au début du corps. Depuis, un script CLASSIQUE de l'en-tête de
 * `front/index.html` pose `data-theme` avant le corps, et
 * `theme-en-tete.test.ts` le compare à `storedTheme()` pour chaque valeur.
 * Ce module le repose ensuite, à l'identique.
 */
export const THEMES = [
  { id: "auto", label: "comme l'appareil", note: "clair ou sombre selon le système" },
  { id: "nuit", label: "nuit", note: "bleu marine, pour une pièce sombre" },
  { id: "jour", label: "jour", note: "givre, pour une pièce éclairée" },
] as const;

export type Theme = (typeof THEMES)[number]["id"];

const DEFAULT: Theme = "auto";
const REMEMBERED = "nel3ab:theme";

/** Les sept ambiances d'avant, rangées du côté où elles peignaient.
 *
 * Un choix déjà fait se garde: quelqu'un qui avait pris un fond clair le
 * retrouve clair. Tout le reste, valeur inconnue ou stockage bricolé, retombe
 * sur l'appareil plutôt que sur la nuit: deviner un côté pour une valeur
 * qu'on ne connaît pas serait imposer un choix que personne n'a fait. */
const ANCIENS: Readonly<Record<string, Theme>> = {
  "instrument-sombre": "nuit",
  phosphore: "nuit",
  ambre: "nuit",
  "instrument-clair": "jour",
  indigo: "jour",
  famicom: "jour",
  gameboy: "jour",
};

const known = (value: string | null): value is Theme => THEMES.some((theme) => theme.id === value);

export function storedTheme(): Theme {
  try {
    const found = localStorage.getItem(REMEMBERED);
    if (known(found)) return found;
    return (
      (found !== null && Object.hasOwn(ANCIENS, found) ? ANCIENS[found] : undefined) ?? DEFAULT
    );
  } catch {
    return DEFAULT;
  }
}

/** Pose le thème sur le document. Appelé avant React, puis à chaque changement.
 *
 * `auto` est posé lui aussi, plutôt que d'effacer l'attribut: la feuille ne
 * force ni la nuit ni le jour pour cette valeur, et un pilote qui lit
 * `data-theme` voit ce qui a été choisi au lieu d'un vide. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function rememberTheme(theme: Theme): void {
  try {
    localStorage.setItem(REMEMBERED, theme);
  } catch {
    /* navigation privée: le thème vaut pour cette session */
  }
}

export const themeLabel = (theme: Theme): string =>
  THEMES.find((found) => found.id === theme)?.label ?? theme;

/** Ce que la colonne montre: la salle, ou les mesures. */
export type Mode = "normal" | "details";

const MODE = "nel3ab:mode";

export function storedMode(): Mode {
  try {
    return localStorage.getItem(MODE) === "details" ? "details" : "normal";
  } catch {
    return "normal";
  }
}

export function rememberMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE, mode);
  } catch {
    /* navigation privée */
  }
}

/**
 * La forme du menu, retirée le 24 novembre 2026 (chantier menus).
 *
 * Trois formes existaient : la croix du XMB, les chaînes de la Wii et
 * l'accueil de la Switch. Un seul menu les remplace, et la clé qui retenait
 * la forme choisie ne sert plus à rien : elle est effacée au démarrage, pour
 * qu'un navigateur ne la garde pas indéfiniment. Sous try/catch, comme toute
 * lecture du stockage : une navigation privée peut le refuser.
 */
export const CLE_DE_LA_COQUE = "nel3ab:shell";

export function oublierLaCoque(stockage: Pick<Storage, "removeItem"> | null = null): void {
  try {
    (stockage ?? localStorage).removeItem(CLE_DE_LA_COQUE);
  } catch {
    /* navigation privée */
  }
}

/**
 * L'écran d'entrée: lequel des deux dessins.
 *
 * Ce n'est ni un thème ni un tableau de bord. Un thème change les couleurs de
 * toute la salle; un tableau de bord change le MENU une fois dedans. Ceci
 * change la page d'AVANT, celle qu'on voit en arrivant et qu'on quitte en
 * entrant, et elle seule.
 *
 * Trois dessins et pas sept, parce qu'ils ne se valent pas: `classique` est la
 * fiche actuelle, que Souhib a demandé de garder telle quelle, `cables` et `sol`
 * sont les propositions du 13 septembre 2026. Ajouter une entrée ici est une
 * décision, pas une variante de couleur.
 *
 * L'ordre compte: la bascule est un CYCLE qui suit ce tableau. Tant qu'elle
 * cherchait « la première entrée différente de celle-ci », une troisième était
 * inatteignable — depuis `classique` on allait à `cables`, et depuis `cables` on
 * revenait à `classique`.
 */
export const LOBBIES = [
  { id: "classique", label: "classique", note: "la fiche, telle qu'elle était" },
  { id: "cables", label: "câbles", note: "quatre fils, un par manette" },
  { id: "plan", label: "plan", note: "la salle vue d'en haut" },
] as const;

export type LobbyLook = (typeof LOBBIES)[number]["id"];

const LOBBY = "nel3ab:lobby";

export function storedLobby(): LobbyLook {
  try {
    const found = localStorage.getItem(LOBBY);
    return LOBBIES.some((choice) => choice.id === found) ? (found as LobbyLook) : "classique";
  } catch {
    return "classique";
  }
}

export function rememberLobby(look: LobbyLook): void {
  try {
    localStorage.setItem(LOBBY, look);
  } catch {
    /* navigation privée: le choix vaut pour cet onglet */
  }
}

export const lobbyLabel = (look: LobbyLook): string =>
  LOBBIES.find((found) => found.id === look)?.label ?? look;

/** Faut-il montrer la manette à l'écran ?
 *
 * Trois états et pas deux. « Auto » regarde l'appareil: un écran tactile sans
 * souris la montre, un ordinateur non. Les deux autres sont un choix explicite,
 * parce que la détection se trompe des deux côtés — un portable tactile n'a pas
 * besoin d'une manette à l'écran, et une tablette branchée à un clavier peut
 * quand même en vouloir une.
 */
export const TOUCHPADS = [
  { id: "auto", label: "selon l'appareil", note: "montrée sur un écran tactile" },
  { id: "on", label: "toujours", note: "même avec un clavier" },
  { id: "off", label: "jamais", note: "cachée quoi qu'il arrive" },
] as const;

export type TouchPref = (typeof TOUCHPADS)[number]["id"];

const TOUCH_KEY = "nel3ab:touchpad";

const PAD_ONLY_KEY = "nel3ab:padonly";

/** Vrai quand cette page ne doit servir que de manette.
 *
 * Gardé dans le navigateur, comme les autres réglages: un téléphone qui sert de
 * manette le soir sert de manette le lendemain, et le redemander à chaque
 * ouverture serait un geste de plus à faire à quatre.
 */
export function storedPadOnly(): boolean {
  try {
    return localStorage.getItem(PAD_ONLY_KEY) === "oui";
  } catch {
    return false;
  }
}

export function rememberPadOnly(only: boolean): void {
  try {
    localStorage.setItem(PAD_ONLY_KEY, only ? "oui" : "non");
  } catch {
    // Un navigateur en navigation privée refuse d'écrire. Le réglage vaut alors
    // pour cette séance et pas au-delà, ce qui est mieux que de ne pas marcher.
  }
}

export function storedTouch(): TouchPref {
  try {
    const found = localStorage.getItem(TOUCH_KEY);
    return TOUCHPADS.some((choice) => choice.id === found) ? (found as TouchPref) : "auto";
  } catch {
    return "auto";
  }
}

export function rememberTouch(pref: TouchPref): void {
  try {
    localStorage.setItem(TOUCH_KEY, pref);
  } catch {
    // Navigation privée: le choix dure le temps de l'onglet.
  }
}

export function touchLabel(pref: TouchPref): string {
  return TOUCHPADS.find((choice) => choice.id === pref)?.label ?? pref;
}

/** L'appareil a-t-il un écran tactile et pas de souris fine ?
 *
 * `pointer: coarse` plutôt que la présence d'événements tactiles: un portable
 * tactile répond oui à la seconde question et n'a pas besoin d'une manette à
 * l'écran. Ce qu'on veut savoir est comment la personne DÉSIGNE, pas ce que le
 * matériel sait faire.
 */
export function looksLikeAPhone(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/** Faut-il la montrer, tout compte fait ? En automatique, une vraie manette
 * branchée l'efface : au téléphone, l'image reprend toute la largeur, et
 * les touches reviennent quand la manette part (en-jeu-manette.4,
 * 23 novembre 2026). */
export function showsTouchPad(pref: TouchPref, coarse: boolean, manette = false): boolean {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return coarse && !manette;
}
