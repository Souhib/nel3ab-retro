/** « Toutes les touches », au bout du panneau de commande de la borne, avant
 * le crédit : ouvre « Touches et manettes » sur l'onglet Clavier (changement
 * 3 du plan manettes). La salle décide de ce que l'ouverture ferme autour
 * (le menu, la feuille) : elle passe `onOuvrir`. */
import { REGLAGE } from "../lib/mots";

export function ToutesLesTouches({ onOuvrir }: { onOuvrir: () => void }) {
  return (
    <button
      type="button"
      id="toutesLesTouches"
      className="rt-boite rt-bouton n3-toutes-touches"
      onClick={onOuvrir}
    >
      <i className="rt-ombre" aria-hidden="true" />
      {REGLAGE.toutes}
    </button>
  );
}
