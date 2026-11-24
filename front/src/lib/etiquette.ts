/**
 * L'étiquette tapée d'une personne : son nom, sa couleur de joueur, son
 * numéro de place, et ses trois initiales d'arcade.
 *
 * # Les initiales
 *
 * Le calcul des trois lettres est celui du socle (`retro/arcade`, `initiales`) :
 * sans accent, en capitales, les lettres seulement (partition du 23 novembre
 * 2026, K35). Ce module n'ajoute que deux règles, propres à une salle :
 *
 * - un nom plus court que trois lettres est complété par « - » : « Al » donne
 *   « AL- ». Une place START montre toujours trois signes, comme un tableau
 *   des scores, et deux étiquettes voisines gardent la même largeur ;
 * - deux personnes de la même salle qui tombent sur les mêmes trois lettres
 *   voient TOUTES LES DEUX leur troisième lettre remplacée par leur numéro de
 *   place : deux « Lina » aux places 1 et 3 donnent « LI1 » et « LI3 ».
 *   Remplacer les deux, et non le second venu, rend le résultat indépendant
 *   de l'ordre d'arrivée : la page qui arrive après les deux voit les mêmes
 *   lettres que celle qui les a vus entrer. Un chiffre ne sort jamais d'un
 *   nom (le socle ne garde que les lettres), donc « LI1 » ne peut pas croiser
 *   les initiales de quelqu'un d'autre.
 *
 * Le choix de ses propres lettres est reporté : le salon n'a pas de champ
 * pour les retenir.
 */
import { initiales } from "../retro/arcade";

/** Trois signes, toujours : le socle, complété par « - ». */
export function troisLettres(nom: string): string {
  return `${initiales(nom)}---`.slice(0, 3);
}

/**
 * Les initiales de chaque place tenue d'une salle, doublons résolus.
 *
 * `noms` : le nom de qui tient chaque place (1 à 4), quand on le connaît.
 * Une place sans nom n'a pas d'initiales : on n'en invente pas.
 */
export function initialesDeLaSalle(noms: ReadonlyMap<number, string>): Map<number, string> {
  const brutes = new Map<number, string>();
  for (const [place, nom] of noms) brutes.set(place, troisLettres(nom));
  const vues = new Map<string, number>();
  for (const lettres of brutes.values()) vues.set(lettres, (vues.get(lettres) ?? 0) + 1);
  const rendues = new Map<number, string>();
  for (const [place, lettres] of brutes) {
    rendues.set(place, (vues.get(lettres) ?? 0) > 1 ? `${lettres.slice(0, 2)}${place}` : lettres);
  }
  return rendues;
}

/** L'encre du joueur d'une place, jeton de la régie (4,5:1 sur le panneau,
 * calculé par `lib/regie.test.ts`). */
export const encreDuJoueur = (place: number): string => `var(--p${place}-encre)`;

/** L'aplat du joueur d'une place, pour le bouton START allumé. */
export const aplatDuJoueur = (place: number): string => `var(--p${place})`;
