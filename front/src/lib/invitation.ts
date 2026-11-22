/**
 * Inviter quelqu'un: un lien vers cette salle, partagé ou copié.
 *
 * Aucun parcours ne permettait d'inviter (audit P11, 22 novembre 2026). Le mode
 * « manette seule » suppose un téléphone posé près d'un écran, et ce téléphone
 * devait retrouver la salle à la main: l'accueil, la carte, l'avant-salle,
 * puis entrer. Le lien entre directement pour jouer (`lienDInvitation`).
 *
 * Un téléphone sait partager (`navigator.share`): la feuille de partage du
 * système vaut mieux qu'un presse-papiers qu'on ne voit pas. Ailleurs, le lien
 * est copié. Quand ni l'un ni l'autre ne marche, le lien s'affiche, prêt à
 * copier à la main: un bouton qui ne fait rien en silence ne doit pas exister.
 *
 * Pas de code QR: il faudrait un encodeur (correction d'erreurs, masques),
 * soit une dépendance, soit trois cents lignes à prouver. La feuille de partage
 * d'un téléphone couvre déjà le cas « un appareil à côté de l'autre ».
 */

/** Ce que l'invitation a fait. */
export type Invitation = "partagee" | "copiee" | "a-copier" | "annulee";

/** Ce dont l'invitation a besoin du navigateur, passé pour être remplacé dans un essai. */
export type Outils = {
  partager?: (donnees: { title: string; url: string }) => Promise<void>;
  copier?: (texte: string) => Promise<void>;
};

/** Partage, sinon copie, sinon demande de copier à la main. */
export async function inviter(lien: string, outils: Outils): Promise<Invitation> {
  if (outils.partager) {
    try {
      await outils.partager({ title: "nel3ab", url: lien });
      return "partagee";
    } catch (erreur) {
      // Fermer la feuille de partage n'est pas un échec: rien à dire.
      if (erreur instanceof DOMException && erreur.name === "AbortError") return "annulee";
    }
  }
  if (outils.copier) {
    try {
      await outils.copier(lien);
      return "copiee";
    } catch {
      return "a-copier";
    }
  }
  return "a-copier";
}

/** La phrase qui suit le geste. */
export function ditInvitation(etat: Invitation | null): string {
  switch (etat) {
    case "partagee":
      return "Lien partagé.";
    case "copiee":
      return "Lien copié. Colle-le à ton invité.";
    case "a-copier":
      return "Copie ce lien :";
    default:
      return "";
  }
}

/** La condition, dite une fois: le lien n'ouvre la salle qu'à qui y a accès. */
export const RESEAU_PRIVE = "Le lien marche pour qui est déjà sur le réseau privé de nel3ab.";

/** Les outils du navigateur, quand il les a. */
export function outilsDuNavigateur(): Outils {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    partager: nav?.share ? (donnees) => nav.share(donnees) : undefined,
    copier: nav?.clipboard?.writeText ? (texte) => nav.clipboard.writeText(texte) : undefined,
  };
}
