/**
 * Les consoles, telles que la salle les range.
 *
 * Lues dans `consoles/consoles.json`, à la racine du dépôt (ADR D22), et non plus
 * recopiées ici. Le worker, le salon et la boîte noire lisent le même fichier ou
 * sont vérifiés contre lui. Le fichier entre dans l'empreinte de la page
 * (`stamp.mjs`): le changer sans reconstruire la page rougit la porte.
 *
 * Le code vient du disque, lu par `dolphin-tool`, ou de la fiche d'un jeu: voir
 * `emulator::disc`. Ici on ne fait que le nommer et l'ordonner pour l'écran.
 *
 * L'ordre est celui du manifeste, qui suit celui des sorties: c'est celui qu'une
 * étagère a. Un tri alphabétique ferait bouger les dossiers le jour où une
 * console arrive.
 */
import manifest from "../../../consoles/consoles.json";

/** Une console du manifeste, avec ce que la page en lit. */
type Described = (typeof manifest.consoles)[number];

const DESCRIBED: readonly Described[] = manifest.consoles;

function described(code: string | undefined): Described | undefined {
  return DESCRIBED.find((one) => one.code === code);
}

/** Ce qu'un code de console vaut à l'écran, dans l'ordre d'affichage. */
export const CONSOLES: readonly { code: string; label: string; note: string }[] = [
  ...DESCRIBED.map((one) => ({
    code: one.code,
    // « à l'essai » vient du drapeau, pas du nom: le salon et le worker lisent
    // le même nom, et un nom qui porte un statut finit par mentir sur lui.
    // « (expérimental) » jusqu'au 24 novembre 2026 : le mot d'un laboratoire,
    // pas celui d'une borne (chantier menus, B3).
    label: one.experimental ? `${one.label} à l'essai` : one.label,
    note: one.note,
  })),
  // Un disque dont l'outil n'a pas su dire la console. Il a quand même son
  // dossier: le cacher ferait disparaître un jeu de la salle sans rien dire, et
  // un jeu qu'on ne voit plus est pire qu'un jeu mal rangé. Il n'est pas dans le
  // manifeste: c'est une réponse du disque, pas une console.
  { code: "?", label: "à classer", note: "le disque n'a pas dit de quelle console il est" },
];

/** Les codes du manifeste, sans « ? ». */
export const CONSOLE_CODES: readonly string[] = DESCRIBED.map((one) => one.code);

/** Le nom d'une console, ou son code faute de mieux. */
export function consoleLabel(code: string): string {
  return CONSOLES.find((one) => one.code === code)?.label ?? code;
}

/** Le nom court, sans la mention « expérimental »: celui des plans et des marques. */
export function consoleName(code: string | undefined): string | null {
  return described(code)?.label ?? null;
}

/** Le moteur qui fait tourner la console, d'après le manifeste (`engine`):
 * « dolphin », « ryubing », « eden », « xenia ». Nul pour un code inconnu. Lu
 * pour ne donner un chiffre mesuré que là où il a été mesuré
 * (`mots.prixImageLegere`). */
export function moteurDe(code: string | undefined): string | null {
  return described(code)?.engine ?? null;
}

/** La console parle la trame de manette Pro: pavé tactile, écran de liaison,
 * blocage des entrées pendant la configuration. Le premier sens de l'ancien
 * `isSwitchConsole`. */
export function usesProInput(code: string | undefined): boolean {
  return described(code)?.input === "pro";
}

/** L'image du jeu est une vraie illustration, à lisser, et non une bannière en
 * pixels. Le second sens de l'ancien `isSwitchConsole`. */
export function smoothArt(code: string | undefined): boolean {
  return described(code)?.art === "sidecar";
}

/** Le salon sait préparer ce jeu: une console du manifeste qu'on peut lancer. */
export function preparable(code: string | undefined): boolean {
  return described(code)?.playable === true;
}

/** Faux pour une console décrite mais pas encore jouable, comme la Xbox 360
 * avant le 21 novembre 2026.
 *
 * Un code que le manifeste ne connaît pas, « ? » compris, reste lançable par le
 * chemin en deux pressions: c'est le worker qui décide, comme avant. */
export function launchable(code: string | undefined): boolean {
  return described(code)?.playable !== false;
}

/** Vrai pour une console que la salle garde à l'essai (le drapeau
 * `experimental` du manifeste), la Switch 2 depuis le 22 novembre 2026. */
export function aLEssai(code: string | undefined): boolean {
  return described(code)?.experimental === true;
}

/** Les appareils qu'une préparation propose pour cette console, lus dans le
 * manifeste comme le salon le fait (`CONSOLES.devices`). Vide pour un code
 * inconnu, « ? » compris. */
export function appareilsDe(code: string | undefined): readonly number[] {
  return described(code)?.devices ?? [];
}

/** Vrai quand la salle ne valide qu'un joueur pour cette console, comme
 * `CONSOLES.solo` du salon : la préparation ne compte alors que le chef. */
export function seulDe(code: string | undefined): boolean {
  return described(code)?.players === 1;
}
