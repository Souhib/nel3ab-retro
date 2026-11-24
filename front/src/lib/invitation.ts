/**
 * Inviter quelqu'un : un lien vers cette salle, envoyé ou copié.
 *
 * Aucun parcours ne permettait d'inviter (audit P11, 22 novembre 2026). Le mode
 * « manette seule » suppose un téléphone posé près d'un écran, et ce téléphone
 * devait retrouver la salle à la main : l'accueil, la carte, l'avant-salle,
 * puis entrer. Le lien entre directement, pour jouer ou pour regarder
 * (`lienDInvitation`).
 *
 * Deux gestes depuis le 23 novembre 2026, au lieu d'un bouton qui choisissait
 * seul :
 *
 * - « Copier le lien », partout. Quand le navigateur refuse, le lien entier est
 *   SÉLECTIONNÉ et la page le dit : un bouton qui ne fait rien en silence ne
 *   doit pas exister ;
 * - « Envoyer le lien », là où le navigateur sait partager (`navigator.share`,
 *   un téléphone surtout) : la feuille de partage du système vaut mieux qu'un
 *   presse-papiers qu'on ne voit pas. Fermer la feuille n'est pas un échec.
 *
 * Le code QR, écarté le 22 novembre faute d'encodeur prouvé, est revenu avec
 * `lib/qr`, prouvé contre un autre encodeur.
 */

/** Ce qu'un geste a fait. */
export type Invitation = "envoyee" | "copiee" | "a-copier" | "annulee";

/** Ce dont l'invitation a besoin du navigateur, passé pour être remplacé dans un essai. */
export type Outils = {
  partager?: (donnees: { title: string; url: string }) => Promise<void>;
  copier?: (texte: string) => Promise<void>;
};

/** Copie le lien, ou dit qu'il faut le copier à la main. */
export async function copier(lien: string, outils: Outils): Promise<Invitation> {
  if (!outils.copier) return "a-copier";
  try {
    await outils.copier(lien);
    return "copiee";
  } catch {
    return "a-copier";
  }
}

/** Envoie le lien par la feuille de partage ; sans elle, ou quand elle échoue
 * pour une autre raison qu'une fermeture, le copie. */
export async function envoyer(lien: string, outils: Outils): Promise<Invitation> {
  if (outils.partager) {
    try {
      await outils.partager({ title: "nel3ab", url: lien });
      return "envoyee";
    } catch (erreur) {
      // Fermer la feuille de partage n'est pas un échec : rien à dire.
      if (erreur instanceof DOMException && erreur.name === "AbortError") return "annulee";
    }
  }
  return copier(lien, outils);
}

/** Les outils du navigateur, quand il les a. */
export function outilsDuNavigateur(): Outils {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    partager: nav?.share ? (donnees) => nav.share(donnees) : undefined,
    copier: nav?.clipboard?.writeText ? (texte) => nav.clipboard.writeText(texte) : undefined,
  };
}

/** Sélectionne tout le texte d'un élément, pour une copie à la main. */
export function selectionner(element: Element): void {
  const selection = element.ownerDocument.getSelection();
  if (!selection) return;
  const plage = element.ownerDocument.createRange();
  plage.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(plage);
}
