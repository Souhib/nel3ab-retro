/**
 * La couronne de qui choisit le jeu, élu par le salon. Ce signe ne vient pas
 * du droit administrateur.
 *
 * Deux dessins, comme chaque icône de la salle : au trait, et en pixels sur
 * la grille du socle (`retro/icones`, effet « icones ») ; la feuille en
 * montre un. Le mot « chef » ne s'écrit plus nulle part (charte des mots,
 * 23 novembre 2026) : le nom accessible dit ce que la couronne veut dire.
 * Dans un bouton qui le dit déjà (une place START), elle se tait (`muette`).
 */
import { iconePixelSVG } from "../retro/icones";
import { PLACES } from "../lib/mots";

export function Crown({ muette = false }: { muette?: boolean }) {
  return (
    <span
      className="n3-couronne inline-flex shrink-0 text-alert"
      role={muette ? undefined : "img"}
      aria-label={muette ? undefined : PLACES.choisit}
      aria-hidden={muette ? "true" : undefined}
    >
      <svg
        viewBox="0 0 24 20"
        className="rt-icone-trait h-3.5 w-4"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M3 15 1 5l6 4 5-8 5 8 6-4-2 10H3Zm0 2h18v2H3Z" />
      </svg>
      <span
        className="contents"
        aria-hidden="true"
        // Le dessin vient de la table du dépôt ; aucune donnée n'y passe.
        dangerouslySetInnerHTML={{ __html: iconePixelSVG("couronne") }}
      />
    </span>
  );
}
