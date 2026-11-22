/**
 * Le chef de la salle: ce que la page en dit, et à qui elle propose son rôle.
 *
 * Sorti d'`App.tsx` après la relecture du 22 novembre 2026. Les deux règles y
 * étaient écrites en ligne, et cinq mutants d'`App` restaient verts: remettre
 * « décide du jeu » dans l'aide du menu, ou montrer « Prendre le rôle de chef »
 * à tout le monde, ne rougissait aucun essai. Une fonction pure se teste; une
 * expression dans un composant de deux mille lignes, non.
 */
import { chefAbsent, chefChoisit } from "./mots";

/** Ce que la page sait du chef et de soi, tel qu'`App` le lit. */
export type Role = {
  /** La place de cette page, ou `null` quand elle regarde. */
  port: number | null;
  /** Le WORKER dit que cette place peut changer de jeu (`deciding`). */
  mine: boolean;
  /** Le nom du chef que le salon annonce, ou `null` sans chef. */
  chef: string | null;
  /** Le salon dit que le chef, c'est cette page (`owner.moi`). */
  moi: boolean;
};

/** Le chef est là, mais il ne joue plus: le worker laisse choisir les autres. */
export const chefParti = (role: Role): boolean => role.mine && role.chef !== null && !role.moi;

/** Pourquoi cette page ne peut pas changer de jeu, ou `null` si elle le peut.
 *
 * L'aide d'un jeu grisé dans le menu. Elle disait « Bo décide du jeu dans cette
 * salle » pendant que la colonne disait « Bo choisit le jeu. »: deux verbes
 * pour un rôle (audit T12). */
export function pourquoiPasChoisir(role: Role): string | null {
  const chef = role.chef ?? "quelqu'un";
  if (role.port === null) return "Prends une place pour changer de jeu.";
  if (!role.mine) return chefChoisit(chef);
  return chefParti(role) ? chefAbsent(chef) : null;
}

/** Propose-t-on « Prendre le rôle de chef » ?
 *
 * Seulement quand le chef ne joue plus, et à qui le salon connaît: proposé à
 * tous, c'était la première action offerte à un nouveau venu, celle de prendre
 * la place de l'hôte (audit T12). */
export const repriseDuRole = (role: Role, identifie: boolean): boolean =>
  identifie && chefParti(role);
