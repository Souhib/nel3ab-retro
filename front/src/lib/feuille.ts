/**
 * La feuille du bas: les gestes de la PAGE, hors des touches du jeu.
 *
 * La manette à l'écran portait trois gestes de page parmi ses touches: son,
 * menu, cacher. Le 22 novembre 2026, sur un iPhone tenu droit, « cacher » était
 * posé sur R, et taper R faisait disparaître la manette en pleine partie
 * (audit M1). Le plein écran et « signaler » n'avaient pas de place du tout,
 * et la colonne, repliée d'office, emportait avec elle les places, les
 * spectateurs et la sortie (audit P5).
 *
 * Un seul bouton « ••• » reste donc parmi les touches, et ouvre cette feuille.
 * Elle tient tous les gestes de page d'un téléphone, à l'abri des pouces: le
 * son, le menu du jeu, la salle (le tiroir de la colonne), la manette à
 * l'écran, le plein écran ou l'écran d'accueil, et le signalement.
 *
 * Ce module dit QUOI montrer; `FeuilleDuBas` le pose. Le son coupé passe en
 * tête: c'est la seule entrée qui répare quelque chose.
 */
import type { PleinEcran } from "./plein-ecran";

/** Le nom du « ••• », lu à voix haute: le son coupé y est dit en mots, la
 * pastille rouge seule ne se lisant pas. Un seul texte pour le « ••• » de la
 * manette et pour celui qui se pose seul. */
export function nomDuPlus(sonCoupe: boolean): string {
  const nom = "Options : son, menu, la salle";
  return sonCoupe ? `Son coupé. ${nom}` : nom;
}

export type IdEntree =
  | "son"
  | "menu"
  | "salle"
  | "manette"
  | "plein-ecran"
  | "ecran-accueil"
  | "signaler";

export type EntreeFeuille = { id: IdEntree; titre: string; detail: string; alerte: boolean };

export type EtatFeuille = {
  /** Le contexte audio ne joue pas. */
  sonCoupe: boolean;
  /** La manette à l'écran: montrée, cachée, ou sans objet à la souris. */
  manette: "montree" | "cachee" | null;
  plein: PleinEcran;
  /** La page est en plein écran en ce moment. */
  pleinActif: boolean;
};

export function entreesDeLaFeuille({
  sonCoupe,
  manette,
  plein,
  pleinActif,
}: EtatFeuille): EntreeFeuille[] {
  const entrees: EntreeFeuille[] = [
    sonCoupe
      ? {
          id: "son",
          titre: "Rallumer le son",
          // L'interrupteur du côté de l'iPhone coupe le son de la page, et
          // aucun code ne le voit: on le nomme plutôt que de le deviner.
          detail: "Le son est coupé. Si rien ne sort, regarde le bouton silence du téléphone.",
          alerte: true,
        }
      : {
          id: "son",
          titre: "Tester le son",
          detail: "Un bip, pour vérifier le volume.",
          alerte: false,
        },
    { id: "menu", titre: "Menu du jeu", detail: "Jeux, sauvegardes, réglages.", alerte: false },
    { id: "salle", titre: "La salle", detail: "Places, spectateurs, quitter.", alerte: false },
  ];
  if (manette !== null)
    entrees.push(
      manette === "montree"
        ? {
            id: "manette",
            titre: "Cacher la manette",
            detail: "Pour jouer avec une vraie manette.",
            alerte: false,
          }
        : {
            id: "manette",
            titre: "Montrer la manette",
            detail: "Les touches à l'écran.",
            alerte: false,
          },
    );
  if (plein === "api")
    entrees.push({
      id: "plein-ecran",
      titre: pleinActif ? "Quitter le plein écran" : "Plein écran",
      detail: pleinActif ? "Retrouver les barres du navigateur." : "Sans les barres du navigateur.",
      alerte: false,
    });
  else if (plein === "ecran-accueil")
    entrees.push({
      id: "ecran-accueil",
      titre: "Sur l'écran d'accueil",
      detail: "Pour jouer sans la barre de Safari.",
      alerte: false,
    });
  entrees.push({
    id: "signaler",
    titre: "Signaler un problème",
    detail: "Note cet instant pour qui répare.",
    alerte: false,
  });
  return entrees;
}
