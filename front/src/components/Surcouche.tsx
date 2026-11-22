/**
 * Ce qui doit passer AU-DESSUS du menu ouvert.
 *
 * Le menu est un dialogue modal (`showModal`): il monte dans la couche du
 * dessus du navigateur, et tout ce qui n'est pas DANS le dialogue devient
 * inerte, peu importe son `z-index`. Trois avis de la page s'affichaient
 * pourtant au-dessus du menu, en `z-index: 100`: la demande de reprise du rôle
 * de chef (`Recovery`), l'erreur d'un lancement refusé, et l'état d'une
 * préparation. L'erreur naît justement d'un choix fait dans le menu.
 *
 * Tant qu'un menu est ouvert, ces avis se rendent donc DANS le menu, à
 * l'endroit qu'il leur réserve (`PlaceDesSurcouches`); sinon, à leur place
 * habituelle. Le menu ignore les touches venues de cet endroit (`useShell`):
 * une flèche sur « garder ma place » ne déplace pas la liste derrière.
 *
 * Ce que ça coûte: passer d'un endroit à l'autre remonte l'avis, comme tout
 * changement de conteneur d'un portail React. Un avis ouvert pendant qu'on
 * ouvre ou ferme le menu repart donc de son état initial. Ce qui ne doit pas
 * repartir, comme une réponse en vol, vit chez le parent (`Recovery`, `busy`).
 *
 * Le menu ignore aussi Échap venu d'un avis (`useShell`, `useMenuDialogue`):
 * sur son bouton, Échap fermait le menu par l'événement `cancel` du dialogue.
 */
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type Hote = { hote: HTMLElement | null; poser: (el: HTMLElement | null) => void };

const Contexte = createContext<Hote>({ hote: null, poser: () => {} });

export function HoteDesSurcouches({ children }: { children: React.ReactNode }) {
  const [hote, poser] = useState<HTMLElement | null>(null);
  const valeur = useMemo(() => ({ hote, poser }), [hote]);
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function Surcouche({ children }: { children: React.ReactNode }) {
  const { hote } = useContext(Contexte);
  return hote ? createPortal(children, hote) : <>{children}</>;
}

/**
 * L'endroit, dans un menu ouvert, où les surcouches se rendent.
 *
 * Il dit aussi la hauteur du pied du menu (`--pied-menu`), pour que les avis
 * du bas se posent AU-DESSUS: posés à 20 px du bord, ils couvraient le bouton
 * « Reprendre la partie » d'un téléphone, seule sortie à l'écran (relecture du
 * 22 novembre 2026). Le pied est mesuré plutôt que recopié: il change avec
 * l'appareil, l'orientation et la coque.
 */
export function PlaceDesSurcouches() {
  const { poser } = useContext(Contexte);
  const ici = useRef<HTMLDivElement | null>(null);
  const [pied, setPied] = useState(0);
  const attacher = useCallback(
    (el: HTMLDivElement | null) => {
      ici.current = el;
      poser(el);
    },
    [poser],
  );
  useLayoutEffect(() => {
    // Le premier pied du dialogue: celui de la coque, avant celui du sélecteur.
    const footer = ici.current?.closest("dialog")?.querySelector("footer");
    if (!footer) return;
    const lire = () => setPied(Math.ceil(footer.getBoundingClientRect().height));
    lire();
    if (typeof ResizeObserver === "undefined") return;
    const suivre = new ResizeObserver(lire);
    suivre.observe(footer);
    return () => suivre.disconnect();
  }, []);
  return (
    <div
      data-surcouche=""
      ref={attacher}
      style={{ "--pied-menu": `${pied}px` } as React.CSSProperties}
    />
  );
}
