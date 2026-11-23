/** La commande tenue, dite dans sa ligne de la table, hors de React.
 *
 * Le dessin de gauche (« Ce que le jeu reçoit ») est peint à chaque image
 * par `paintWiring` ou `paintPro`, qui n'écrivent `data-lit` que lorsqu'il
 * change. Ce module observe ces changements et pose `data-tenu` sur la ligne
 * de la commande : la feuille y dessine un carré à la couleur de la place.
 * L'instantané de la page, relu deux fois par seconde, arriverait après le
 * relâché (règle 8). */
import { pieceDe } from "./marques";

/** La pièce du dessin de gauche qui porte une ligne de la table : le stick
 * porte ses deux axes, et une ligne du clavier « x- » porte le sens opposé. */
const pieceDeLigne = (cle: string): string =>
  /^[lr][xy][+-]$/.test(cle) ? pieceDe(cle) : pieceDe(cle.replace(/-$/, ""));

/** Suit les dessins de `racine` (le premier `[data-padmap]` sous
 * `.n3-dessins`) et ses lignes `tr[data-cle]`. Rend la fonction qui arrête. */
export function suivreTenues(racine: Element): () => void {
  const relire = () => {
    const gauche = racine.querySelector(".n3-dessins [data-padmap]");
    for (const ligne of racine.querySelectorAll<HTMLElement>("tr[data-cle]")) {
      const nom = pieceDeLigne(ligne.dataset["cle"] ?? "");
      const tenue =
        gauche?.querySelector(`[data-part="${CSS.escape(nom)}"]`)?.getAttribute("data-lit") ===
        "oui";
      if (tenue !== ligne.hasAttribute("data-tenu")) ligne.toggleAttribute("data-tenu", tenue);
    }
  };
  const veille = new MutationObserver(relire);
  veille.observe(racine, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-lit"],
  });
  relire();
  return () => veille.disconnect();
}
