/** « Changer » : la pièce attendue reste à l'écran (changement 12 du plan).
 *
 * Changer une ligne du bas de la table fait défiler les dessins hors de la
 * vue, au bureau bas comme au téléphone : la personne ne voit plus quelle
 * pièce elle règle. Tant que la pièce encadrée du dessin n'est pas entière à
 * l'écran, la ligne porte une vignette de 64 px de cette pièce, encadrée de
 * ses coins en pixels. Quand le dessin se voit, rien n'est monté : la
 * vignette ne double jamais un dessin visible.
 *
 * La visibilité vient d'un `IntersectionObserver` sur la pièce du dessin,
 * qui tient compte de la fenêtre et de la colonne qui défile. Sans lui
 * (jsdom, un navigateur trop ancien), aucune vignette : le dessin reste le
 * repère, comme avant. */
import { useEffect, useState, type RefObject } from "react";
import type { PadMap } from "../../lib/padmap";
import { PadMapView } from "../../components/PadMap";

/** Vrai quand `piece`, cherchée sous `racine`, n'est pas entière à l'écran.
 * Faux sans pièce, sans racine ou sans `IntersectionObserver`. */
export function useHorsDeVue(racine: RefObject<Element | null>, piece: string | null): boolean {
  // Le constat porte le nom de sa pièce : un constat d'avant ne vaut pas
  // pour la pièce suivante, et aucun effet n'a à le remettre à zéro.
  const [constat, setConstat] = useState<{ piece: string; hors: boolean } | null>(null);
  useEffect(() => {
    if (!piece || typeof IntersectionObserver !== "function") return;
    // Par égalité exacte : la GameCube a un stick « x » et un bouton « X »,
    // et le moteur de sélecteurs de jsdom ne distingue pas la casse.
    const cible = [...(racine.current?.querySelectorAll("[data-padmap] [data-part]") ?? [])].find(
      (une) => une.getAttribute("data-part") === piece,
    );
    if (!cible) return;
    const veille = new IntersectionObserver(
      (vues) => {
        const vue = vues.at(-1);
        // Entière à un centième près : l'arrondi des sous-pixels ne doit pas
        // monter une vignette sous un dessin qui se voit.
        if (vue) setConstat({ piece, hors: !vue.isIntersecting || vue.intersectionRatio < 0.99 });
      },
      { threshold: [0, 0.99, 1] },
    );
    veille.observe(cible);
    return () => veille.disconnect();
  }, [racine, piece]);
  return piece !== null && constat?.piece === piece && constat.hors;
}

/** La vignette : le dessin recadré autour de la pièce, ses coins posés. */
export function Vignette({
  map,
  piece,
  place,
}: {
  map: PadMap;
  piece: string;
  place: 1 | 2 | 3 | 4 | null;
}) {
  return <PadMapView map={map} title="" recadrer={piece} waiting={piece} place={place} />;
}
