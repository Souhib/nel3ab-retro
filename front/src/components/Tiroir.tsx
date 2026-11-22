/**
 * Le tiroir de la salle: la colonne, par-dessus l'image, sur un téléphone ou
 * une tablette (`lib/disposition`).
 *
 * Il porte la colonne entière, sans rien en retirer: les places, prendre une
 * place précise ou demander celle d'un autre, l'invitation, le clip, le
 * micro, les spectateurs, le son, le diagnostic de la liaison, « signaler »
 * et la sortie. Sur un téléphone, ces fonctions n'existaient nulle part
 * ailleurs quand la colonne était repliée (audit P5, E2).
 *
 * Plein écran tenu droit, panneau de droite tenu en travers: jamais à côté de
 * l'image, qu'il recouvre le temps d'un geste. Un dialogue modal, pour que
 * Tab reste dedans et que le reste soit inerte; la salle démonte la manette à
 * l'écran tant qu'il est ouvert (audit M6).
 *
 * Les avis qui doivent passer au-dessus d'un dialogue (`Surcouche`) se rendent
 * dedans tant qu'il est ouvert, comme dans le menu.
 */
import { useLayoutEffect, useRef } from "react";
import { PlaceDesSurcouches } from "./Surcouche";
import "./telephone.css";

export function Tiroir({
  onFermer,
  children,
}: {
  onFermer: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const boite = ref.current;
    if (boite && !boite.open) boite.showModal();
    return () => {
      if (boite?.open) boite.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      id="tiroir"
      className="n3-tiroir"
      aria-label="La salle"
      onCancel={(event) => {
        event.preventDefault();
        onFermer();
      }}
      // Seulement si le dialogue est VRAIMENT fermé: l'événement part plus
      // tard que `close()`, et un démontage suivi d'un remontage (le double
      // passage des effets de React en développement) le laissait fermer une
      // feuille qu'on venait de rouvrir. Vu par `salle-telephone.mjs`.
      onClose={(event) => {
        if (!event.currentTarget.open) onFermer();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onFermer();
      }}
    >
      {children}
      <PlaceDesSurcouches />
    </dialog>
  );
}

/** Le tiroir quand la colonne en est un, rien autour sinon: la même colonne
 * dans les deux formes, écrite une seule fois (`App`). */
export function TiroirSi({
  actif,
  onFermer,
  children,
}: {
  actif: boolean;
  onFermer: () => void;
  children: React.ReactNode;
}) {
  return actif ? <Tiroir onFermer={onFermer}>{children}</Tiroir> : <>{children}</>;
}
