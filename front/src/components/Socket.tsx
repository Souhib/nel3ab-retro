/**
 * Une prise de manette, dessinée comme celle de la console.
 *
 * Une ouverture deux fois plus large que haute, plate en bas, bombée en haut,
 * avec le bloc de broches dedans et le numéro du port dessous. C'est ce que
 * quelqu'un reconnaît en regardant l'avant d'une GameCube.
 *
 * Trois états, à distinguer d'un coup d'oeil depuis l'autre bout d'une pièce:
 * LIBRE montre ses broches dans un trou noir, et TOUTE prise occupée est bouchée
 * par une fiche **de la couleur de son joueur**. Le port 2 est bleu qu'il soit à
 * moi ou à quelqu'un d'autre, parce que c'est la couleur du port et pas celle du
 * propriétaire: sur un écran de Melee, le joueur 2 est bleu pour tout le monde.
 *
 * Ce qui distingue la mienne est le mot dessous, « TOI », et rien de plus. Le
 * contour allumé qu'il y avait avant disait la même chose une deuxième fois, en
 * grisant les autres, ce qui les rendait toutes identiques.
 *
 * Les quatre couleurs sont FIXES et ne suivent pas le thème. Rien dans le
 * matériel n'est coloré, les prises sont toutes du même plastique noir; mais
 * tous les jeux qui ont demandé « lequel es-tu ? » ont répondu dans ces
 * couleurs-là, alors ce sont celles qu'un joueur reconnaît. Les faire changer
 * avec l'ambiance reviendrait à repeindre le joueur 1 en vert.
 */
import type { Fiche } from "../bobine/Branchement";
import { ARMING_COLOUR, PLAYER_COLOURS, PLAYER_INKS } from "../media/players";

export type SocketState = "free" | "busy" | "mine" | "arming";

/**
 * `fiche` raconte un changement, par-dessus l'état:
 * - « cachee »: la prise est tenue mais Bobine n'a pas encore enfoncé la fiche.
 *   Elle se dessine libre le temps de la scène;
 * - « claque »: la fiche vient d'entrer, elle rebondit une fois;
 * - « saute »: la prise vient de se libérer, l'ancienne fiche s'en échappe.
 */
export function Socket({
  port,
  state,
  fiche,
}: {
  port: number;
  state: SocketState;
  fiche?: Fiche;
}) {
  const armed = state === "arming";
  const portColour = PLAYER_COLOURS[port - 1] ?? PLAYER_COLOURS[0];
  const colour = armed ? ARMING_COLOUR : portColour;
  const plugged = state !== "free" && fiche !== "cachee";
  const escaping = state === "free" && fiche === "saute";
  /** Seul l'armement change le boîtier: c'est le seul état qui annonce que le
   * prochain clic va faire quelque chose à quelqu'un. */
  const warn = armed;

  return (
    <svg viewBox="0 0 72 84" className="block w-full" aria-hidden="true">
      <rect
        x="2"
        y="2"
        width="68"
        height="60"
        rx="10"
        fill={warn ? "#33333f" : "#2a2a33"}
        stroke={warn ? colour : "#43434f"}
        strokeWidth={warn ? 3 : 1.5}
      />
      <path
        d="M 12 48 L 12 34 A 24 24 0 0 1 60 34 L 60 48 Z"
        fill="#07070b"
        stroke="#4a4a58"
        strokeWidth="1.5"
      />
      {plugged ? (
        <g className={fiche === "claque" ? "n3-fiche-claque" : undefined}>
          <path d="M 16 48 L 16 35 A 20 20 0 0 1 56 35 L 56 48 Z" fill={colour} />
          <rect x="24" y="40" width="24" height="3" rx="1.5" fill="#07070b" opacity="0.45" />
        </g>
      ) : (
        <>
          <circle cx="27" cy="36" r="2.6" fill="#8a8a98" />
          <circle cx="36" cy="36" r="2.6" fill="#8a8a98" />
          <circle cx="45" cy="36" r="2.6" fill="#8a8a98" />
        </>
      )}
      {escaping ? (
        <g className="n3-fiche-saute">
          <path d="M 16 48 L 16 35 A 20 20 0 0 1 56 35 L 56 48 Z" fill={portColour} />
        </g>
      ) : null}
      {/* Le libellé est du TEXTE posé sur la colonne, pas un morceau de la
          prise: il prend l'encre du joueur, qui change avec le thème, et la
          légende quand la prise est libre. Écrit dans l'aplat (`colour`),
          « P1 » ne tenait que 4,08:1 même la nuit (contraste.mjs, 22 novembre
          2026), et « P3 » tombait à 1,81:1 le jour. */}
      <text
        x="36"
        y="78"
        textAnchor="middle"
        fill={
          armed
            ? "var(--alerte)"
            : plugged
              ? (PLAYER_INKS[port - 1] ?? PLAYER_INKS[0])
              : "var(--legende)"
        }
        style={{
          font: armed ? "600 11px var(--police-texte)" : "400 11px var(--police-machine)",
        }}
      >
        {armed ? "PRENDRE ?" : `P${port}`}
      </text>
    </svg>
  );
}
