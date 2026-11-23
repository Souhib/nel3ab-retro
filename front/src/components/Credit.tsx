/**
 * Le crédit de la borne, au bout droit du panneau de commande : « places
 * libres 2 » (effet « credit », niveau sobre et au-dessus ; 23 novembre 2026,
 * chantier salle, K02).
 *
 * Compté sur les places tenues que le worker annonce (`occupied`), comme
 * les places START qu'il accompagne. Caché au lecteur d'écran : les places
 * disent déjà « libre », et le dire deux fois serait un doublon. Rien quand
 * la salle est fermée : il n'y a plus de place à prendre.
 */
import { CREDIT } from "../lib/mots";

export function Credit({ libres, fermee }: { libres: number; fermee: boolean }) {
  if (fermee) return null;
  return (
    <p id="credit" className="rt-credit n3-credit" aria-hidden="true">
      {CREDIT.placesLibres(libres)}
    </p>
  );
}
