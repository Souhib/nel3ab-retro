/**
 * Le décor de borne dans les bandes latérales de 72 px ou plus qui ne
 * portent pas la manette tactile (effet « borne », niveau tout ; 23 novembre
 * 2026, chantier salle, étape 7).
 *
 * Un décor fixe, en CSS : le tramage du socle, un manche et quatre boutons
 * aux couleurs des joueurs. Caché au lecteur d'écran, sans prise au
 * pointeur, posé en absolu : l'image ne rapetisse jamais pour lui, et il
 * s'arrête à 2 px de l'image. Sans l'effet, les deux boîtes restent vides et
 * transparentes.
 */
import type { CSSProperties } from "react";

export const BORNE_ECART = 2;

export function CoteBorne({
  gauche,
  largeur,
  hauteur,
}: {
  /** La largeur de chaque bande : la bande gauche va de 0 à l'image. */
  gauche: number;
  /** La largeur de la zone de l'image. */
  largeur: number;
  hauteur: number;
}) {
  const w = gauche - BORNE_ECART;
  if (w <= 0) return null;
  const cote = (x: number, sens: "g" | "d") => (
    <div
      className="rt-cote n3-borne"
      data-cote={sens}
      aria-hidden="true"
      style={{ left: x, top: 0, width: w, height: hauteur } as CSSProperties}
    >
      <span className="n3-borne-manche" />
      <span className="n3-borne-boutons">
        <i />
        <i />
        <i />
        <i />
      </span>
    </div>
  );
  return (
    <>
      {cote(0, "g")}
      {cote(largeur - w, "d")}
    </>
  );
}
