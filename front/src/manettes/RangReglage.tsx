/** Le rang « Touches et manettes », en tête de la colonne, juste sous
 * Signaler (`rangsDeLaColonne`) : il ouvre le panneau sur l'onglet Manette
 * (`ouvrirReglage`, K05), qui prend la place des rangs. Tenue en main, la
 * colonne vit dans la feuille agrandie, et la feuille à mi-hauteur porte la
 * même entrée quand elle a la place (`entreesDeLaFeuille`). */
import { IconeRang } from "../components/Colonne";
import { REGLAGE } from "../lib/mots";

export function RangReglage({ onOuvrir }: { onOuvrir: () => void }) {
  return (
    <button type="button" id="touchesEtManettes" onClick={onOuvrir} className="n3-rang">
      <IconeRang nom="manette" />
      <span className="flex-1">{REGLAGE.titre}</span>
    </button>
  );
}
