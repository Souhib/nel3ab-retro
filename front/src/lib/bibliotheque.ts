/**
 * La bibliothèque d'une salle, sans React : ses rangées, ce qui suit un
 * lancement, ce qu'il arrête, et comment les flèches vont d'une cartouche à
 * l'autre (chantier menus, 24 novembre 2026).
 *
 * Une salle sans jeu montre ses jeux debout sur l'écran éteint, une rangée
 * par console (`Rayonnage`). Pendant une partie, la rubrique Jeux du menu
 * montre les mêmes, en liste. Les deux lisent ce module : deux ordres pour
 * une même bibliothèque finiraient par ne plus être d'accord.
 */
import type { Game } from "../client";
import { aLEssai, appareilsDe, CONSOLES, seulDe } from "./consoles";
import { BIBLIO } from "./mots";

/** Une rangée : les jeux d'une console, sous son nom. */
export type Rangee = {
  code: string;
  /** « GameCube, 3 jeux ». */
  titre: string;
  /** La console est à l'essai : la rangée le dit, avec sa note. */
  essai: boolean;
  jeux: Game[];
};

/** Les rangées, dans l'ordre du manifeste, « à classer » en dernier, sans
 * rangée vide.
 *
 * Un code que la page ne connaît pas va dans « à classer » : le filtre
 * d'avant, console par console, faisait disparaître un tel jeu de la salle
 * sans rien dire. */
export function rangees(library: readonly Game[]): Rangee[] {
  const connus = new Set(CONSOLES.map((one) => one.code));
  const codeDe = (game: Game) => {
    const code = game.console ?? "?";
    return connus.has(code) ? code : "?";
  };
  return CONSOLES.flatMap((one) => {
    const jeux = library.filter((game) => codeDe(game) === one.code);
    if (jeux.length === 0) return [];
    return [
      {
        code: one.code,
        titre: BIBLIO.titre(one.label, jeux.length),
        essai: aLEssai(one.code),
        jeux,
      },
    ];
  });
}

/** Ce qui suit « Lancer », calculé comme `Preparation.directe` du salon :
 * le chef est seul à jouer et le jeu ne propose qu'un appareil.
 *
 * Les appareils sont ceux de `allowed_devices` : le guide d'un jeu restreint
 * une console qui en offre plusieurs (la Wii), jamais une console qui n'en a
 * qu'un. Une console qui ne valide qu'un joueur (`seulDe`) ne compte que le
 * chef. */
export function suiteDuLancement(e: {
  console?: string;
  allowed?: readonly number[];
  /** Les places tenues dans la salle. */
  tenues: number;
  /** Cette page tient une place. */
  assis: boolean;
}): string {
  const appareils = appareilsDe(e.console);
  const proposes = e.allowed && appareils.length > 1 ? e.allowed.length : appareils.length;
  const joueurs = seulDe(e.console) ? (e.assis ? 1 : 0) : e.tenues;
  return proposes === 1 && joueurs === 1 && e.assis ? BIBLIO.toutDeSuite : BIBLIO.chacunPret;
}

/** Ce que lancer ce jeu arrête, dit en gras au-dessus de « Lancer ».
 *
 * `null` dans une salle sans jeu : rien ne s'arrête. Le jeu qui tourne,
 * choisi à nouveau, repart de la sauvegarde choisie. */
export function consequence(e: {
  enCours: Game | null;
  choisi: Game;
  tenues: number;
  assis: boolean;
}): string | null {
  if (e.enCours === null) return null;
  if (e.enCours.index === e.choisi.index) return BIBLIO.repart;
  return BIBLIO.arrete(e.enCours.name, e.tenues, e.assis);
}

/** Où est une cartouche, pour les flèches : sa rangée et le centre de sa
 * boîte, lus dans la page au moment du geste. */
export type Place = { rangee: number; centre: number };

/** La cartouche où va une flèche, sans rien déplacer.
 *
 * ← → suivent l'ordre de la bibliothèque, sans faire le tour ; ↑ ↓ vont à
 * la cartouche de la rangée voisine dont le centre est le plus proche (la
 * première à égalité). Rien au-delà de la première ou de la dernière rangée. */
export function cartoucheVoisine(
  places: readonly Place[],
  i: number,
  geste: "haut" | "bas" | "gauche" | "droite",
): number {
  const ici = places[i];
  if (ici === undefined) return i;
  if (geste === "gauche") return Math.max(0, i - 1);
  if (geste === "droite") return Math.min(places.length - 1, i + 1);
  const cible = ici.rangee + (geste === "bas" ? 1 : -1);
  let meilleure = i;
  let ecart = Infinity;
  places.forEach((place, j) => {
    if (place.rangee !== cible) return;
    const d = Math.abs(place.centre - ici.centre);
    if (d < ecart) {
      ecart = d;
      meilleure = j;
    }
  });
  return meilleure;
}

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/** Le moment de la journée, à l'heure de cet appareil. */
function partie(heure: number): "matin" | "après-midi" | "soir" | "nuit" {
  if (heure < 5) return "nuit";
  if (heure < 12) return "matin";
  if (heure < 18) return "après-midi";
  return "soir";
}

/** Quand, dit comme on le dit : « ce soir », « hier soir », « jeudi soir »,
 * « le 12 novembre ». `null` pour une date illisible ou à venir : une ligne
 * qui ment sur le moment est pire qu'aucune ligne. */
export function moment(quand: string, maintenant: Date): string | null {
  const date = new Date(quand);
  if (Number.isNaN(date.getTime()) || date.getTime() > maintenant.getTime() + 60_000) return null;
  const jour = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const jours = Math.round((jour(maintenant) - jour(date)) / 86_400_000);
  const p = partie(date.getHours());
  if (jours === 0)
    return p === "nuit" ? "cette nuit" : p === "après-midi" ? "cet après-midi" : `ce ${p}`;
  if (jours === 1) return p === "nuit" ? "la nuit dernière" : `hier ${p}`;
  if (jours < 7) return `${JOURS[date.getDay()]} ${p}`;
  return `le ${date.getDate()} ${MOIS[date.getMonth()]}`;
}
