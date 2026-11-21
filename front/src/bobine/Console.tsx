/**
 * Une console vue de face, juste assez pour qu'on y glisse un jeu.
 *
 * Pas une console réelle: un boîtier, une fente selon le support, quatre
 * petites prises aux couleurs des joueurs et une diode. La diode est la seule
 * chose qui parle: éteinte, le jeu n'est pas là; verte, il tourne; orange qui
 * clignote, quelque chose coince.
 */
import { PLAYER_COLOURS } from "../media/players";
import type { Support } from "./support";

export type Diode = "eteinte" | "allumee" | "coince";

export function Console({
  support,
  diode,
  avale,
}: {
  support: Support;
  diode: Diode;
  /** Le jeu entre dans la fente, et y reste. */
  avale: boolean;
}) {
  return (
    <svg viewBox="0 0 120 74" className="n3-console" data-avale={avale} aria-hidden="true">
      {support === "cartouche" ? (
        <g className="n3-media n3-media-cartouche">
          <path d="M44 4 h32 v24 h-28 l-4 -4 Z" />
          <rect x="49" y="8" width="22" height="9" className="n3-media-etiquette" />
        </g>
      ) : null}
      {support === "carte" ? (
        <g className="n3-media n3-media-carte">
          <path d="M80 6 h12 v16 h-12 Z" />
        </g>
      ) : null}
      <rect x="8" y="26" width="104" height="40" rx="7" className="n3-console-boitier" />
      {support === "disque" ? (
        <rect x="30" y="37" width="60" height="4" rx="2" className="n3-console-fente" />
      ) : null}
      {support === "cartouche" ? (
        <rect x="40" y="24" width="40" height="5" rx="1.5" className="n3-console-fente" />
      ) : null}
      {support === "carte" ? (
        <rect x="78" y="24.5" width="16" height="3" rx="1" className="n3-console-fente" />
      ) : null}
      {PLAYER_COLOURS.map((couleur, i) => (
        <rect
          key={couleur}
          x={18 + i * 9}
          y="53"
          width="6"
          height="5"
          rx="1.2"
          fill={couleur}
          className="n3-console-prise"
        />
      ))}
      <circle cx="100" cy="55" r="2.6" className="n3-console-diode" data-diode={diode} />
      {support === "disque" ? (
        <g className="n3-media n3-media-disque">
          <circle cx="16" cy="39" r="13" />
          <circle cx="16" cy="39" r="3" className="n3-media-trou" />
        </g>
      ) : null}
    </svg>
  );
}
