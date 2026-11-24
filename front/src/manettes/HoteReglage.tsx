/** L'emplacement du réglage dans la salle : la salle le pose là où vivent les
 * rangs de la colonne, et il ne rend rien tant que personne n'a appelé
 * `ouvrirReglage`. Il n'y a rien à charger (K38) : le panneau est dans la
 * page. À la fermeture, le focus revient à l'ouvreur, ou au repli que la
 * salle donne quand l'ouvreur a disparu avec les rangs. */
import type { Hote } from "../lib/cadre";
import { changerOnglet, fermerReglage, focusRendu, useReglage } from "./entree";
import type { TrameDolphin } from "./reglage/Dolphin";
import type { TramePro } from "./reglage/Pro";
import { Reglage, type Bande } from "./reglage/Reglage";

export function HoteReglage({
  trame,
  autres,
  vit,
  hote,
  repli,
  bande,
}: {
  /** La trame de la salle, ou `null` sans session : rien à régler. */
  trame: TrameDolphin | TramePro | null;
  autres: boolean;
  vit: boolean;
  hote?: Hote | null;
  repli: () => HTMLElement | null;
  /** L'état de la salle quand elle ne vit pas (voir `Reglage`). */
  bande?: Bande | null;
}) {
  const ouverture = useReglage();
  if (!ouverture || !trame) return null;
  return (
    <Reglage
      onglet={ouverture.onglet}
      onOnglet={changerOnglet}
      onFermer={() => {
        const ouvreur = fermerReglage();
        requestAnimationFrame(() => focusRendu(ouvreur, repli)?.focus());
      }}
      autres={autres}
      vit={vit}
      hote={hote}
      trame={trame}
      bande={bande}
    />
  );
}
