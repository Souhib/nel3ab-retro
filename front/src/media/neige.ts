/**
 * La neige d'une connexion coupée : le signal perdu, à la place de l'image.
 *
 * Décision K20 du propriétaire (24 novembre 2026) : la neige remplace
 * l'image d'une connexion coupée, et seulement elle. Elle n'est jamais POSÉE
 * sur une image : sous le jeton « neige » de la couverture
 * (`media/couverture.ts`), la feuille cache la toile du jeu et montre ce
 * canevas, posé à côté d'elle sur le même rectangle. La première image peinte
 * retire le jeton dans la boucle de peinture, et la toile revient dans la
 * même image d'écran, sans attendre React.
 *
 * Ce module ne fait que dessiner, et seulement tant que la neige se voit :
 * vingt bruits par seconde quand l'onglet est visible, un seul en mouvement
 * réduit, rien quand le jeton est parti. Le dessin est celui du socle
 * (`retro/calques.ts`, `bruit`) : un gris fin, sans flash général.
 */
import { mouvementReduit } from "../lib/effets";
import { bruit } from "../retro/calques";
import { jetons } from "./couverture";

/** Vingt images de bruit par seconde, comme la neige du socle. */
export const NEIGE_EVERY_MS = 50;

/** Ce que la neige lit du monde : rien qu'on ne puisse remplacer dans un
 * essai. */
export type MondeNeige = {
  dessiner: (canevas: HTMLCanvasElement) => void;
  visible: () => boolean;
  reduit: () => boolean;
  /** La neige se voit-elle encore (le jeton est-il posé) ? */
  posee: () => boolean;
};

const MONDE: MondeNeige = {
  dessiner: (canevas) => bruit(canevas),
  visible: () => document.visibilityState === "visible",
  reduit: mouvementReduit,
  posee: () => jetons().includes("neige"),
};

/**
 * Fait tomber la neige sur `canevas` tant que le jeton est posé. Rend la
 * fonction qui l'arrête. Le minuteur s'arrête aussi seul quand la première
 * image a levé le jeton : rien ne tourne pour une neige qu'on ne voit plus.
 */
export function faireNeiger(canevas: HTMLCanvasElement, monde: MondeNeige = MONDE): () => void {
  monde.dessiner(canevas);
  if (monde.reduit()) return () => {};
  const minuteur = window.setInterval(() => {
    if (!monde.posee()) {
      window.clearInterval(minuteur);
      return;
    }
    if (monde.visible()) monde.dessiner(canevas);
  }, NEIGE_EVERY_MS);
  return () => window.clearInterval(minuteur);
}
