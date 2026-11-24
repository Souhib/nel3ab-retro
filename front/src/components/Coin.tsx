/**
 * Le coin, au pied de la colonne : la ligne d'état, puis la scène de la
 * mascotte en dessous, jamais par-dessus (colonne.3).
 *
 * La ligne ouvre les mesures de la liaison, qui ont remplacé l'onglet
 * « mesures » de l'ancienne colonne. Le chantier personnes y écrit l'état en
 * clair ; le chantier etats la vide quand une fiche parle. L'hôte de la
 * mascotte (`data-hote="coin"`) est trouvé par l'arbitre des scènes du cadre
 * (`useArbitre`, K10) ; rien n'y joue tant qu'aucune scène n'est demandée.
 */
import { COLONNE } from "../lib/mots";
import { IconeRang } from "./Colonne";

/** La hauteur de la scène, sous la ligne : la pose la plus haute de la
 * mascotte provisoire y tient sans toucher la ligne. */
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
  return (
    <div id="coin" className="n3-coin">
      <button
        type="button"
        id="mesures"
        // Un clic de souris rend le clavier au jeu (`lib/focus-jeu`).
        data-rend-le-jeu=""
        // Il déplie les mesures (`#stats`) à la place des rangs : un bouton qui
        // ouvre, pas un interrupteur (plan personnes, mesures 0).
        aria-expanded={mesures}
        aria-controls={mesures ? "stats" : undefined}
        onClick={onMesures}
        className="n3-coin-ligne"
      >
        <IconeRang nom="horloge" />
        <span className="flex-1 truncate">{ligne ?? COLONNE.mesures}</span>
        {/* L'état en clair ne dit pas ce que la ligne ouvre : son nom le dit,
            et une ligne tue (`ligne=""`) garde un nom. */}
        {ligne === undefined ? null : (
          <span className="sr-only">{ligne ? ` : ${COLONNE.mesures}` : COLONNE.mesures}</span>
        )}
        {mesures ? <span className="text-faint">{COLONNE.revenir}</span> : null}
      </button>
      <div
        className="n3-coin-scene"
        data-hote="coin"
        aria-hidden="true"
        style={{ height: SCENE_DU_COIN }}
      />
    </div>
  );
}
