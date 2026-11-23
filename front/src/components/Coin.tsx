/**
 * Le coin, au pied de la colonne : la ligne d'état, puis la maison de la
 * mascotte en dessous, jamais par-dessus (colonne.3).
 *
 * La maison est le logo, descendu de l'en-tête de la colonne le 23 novembre
 * 2026 (K26, ADR D46) : Aïn y est le 3, il en sort pour ses scènes et y
 * rentre. Le logo se peint au montage, avant toute scène.
 *
 * La ligne ouvre les mesures de la liaison, qui ont remplacé l'onglet
 * « mesures » de l'ancienne colonne. Le chantier personnes y écrit l'état en
 * clair ; le chantier etats la vide quand une fiche parle. L'hôte de la
 * mascotte (`data-hote="coin"`) est trouvé par l'arbitre des scènes du cadre
 * (`useArbitre`, K10) ; rien n'y joue tant qu'aucune scène n'est demandée.
 */
import { useEffect, useRef } from "react";

import { COLONNE } from "../lib/mots";
import { poserMascotte } from "../mascotte";
import { IconeRang } from "./Colonne";

/** La hauteur de la maison, sous la ligne : le logo à deux pixels d'écran
 * par pixel d'Aïn (31 × 2 = 62 px) y tient sans toucher la ligne. */
export const SCENE_DU_COIN = 64;

export function Coin({
  mesures,
  onMesures,
  ligne,
}: {
  /** Les mesures sont ouvertes dans la colonne. */
  mesures: boolean;
  onMesures: () => void;
  /** La ligne d'état ; vide quand une fiche d'état parle. */
  ligne?: string;
}) {
  const maison = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (maison.current) poserMascotte(maison.current);
  }, []);
  return (
    <div id="coin" className="n3-coin">
      <button
        type="button"
        id="mesures"
        // Un clic de souris rend le clavier au jeu (`lib/focus-jeu`).
        data-rend-le-jeu=""
        aria-pressed={mesures}
        onClick={onMesures}
        className="n3-coin-ligne"
      >
        <IconeRang nom="horloge" />
        <span className="flex-1 truncate">{ligne ?? COLONNE.mesures}</span>
        {mesures ? <span className="text-faint">{COLONNE.revenir}</span> : null}
      </button>
      <div
        ref={maison}
        className="n3-coin-scene"
        data-hote="coin"
        aria-hidden="true"
        style={{ height: SCENE_DU_COIN }}
      />
    </div>
  );
}
