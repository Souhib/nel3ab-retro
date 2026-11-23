/**
 * Le panneau de commande de la borne : l'emplacement des places.
 *
 * Au bureau, il se pose sous l'image, sur toute la largeur, quand l'image
 * garde exactement sa taille avec lui (`panneauAuBureau`, calculé sur la vraie
 * pose de `lib/fit`). Sinon il se range au pied de la colonne, en deux
 * rangées. Le chantier personnes y pose les places START 1P à 4P ; la salle y
 * posera le crédit et le temps de jeu. Il ne se pose jamais sur l'image.
 *
 * Son bord haut est l'hôte « bord-panneau » de l'arbitre des scènes : une
 * arrivée ou un départ y joue quand le panneau est sous l'image.
 */
import type { CSSProperties, ReactNode } from "react";
import type { FormePanneau } from "../lib/cadre";
import { COLONNE } from "../lib/mots";

export function PanneauCommande({
  forme,
  hauteur,
  children,
  fin,
}: {
  forme: Exclude<FormePanneau, "absent">;
  /** La hauteur que le cadre lui donne sous l'image ; libre ailleurs. */
  hauteur?: number;
  children: ReactNode;
  /** Le bout droit : le crédit, puis le temps de jeu quand la salle le dit. */
  fin?: ReactNode;
}) {
  return (
    <section
      id="panneau"
      data-forme={forme}
      aria-label={COLONNE.panneau}
      className="n3-panneau"
      style={
        hauteur === undefined ? undefined : ({ "--panneau-h": `${hauteur}px` } as CSSProperties)
      }
    >
      {forme === "sous" ? <div className="n3-panneau-bord" data-hote="bord-panneau" /> : null}
      <div className="n3-panneau-places">
        {children}
        {fin}
      </div>
    </section>
  );
}
