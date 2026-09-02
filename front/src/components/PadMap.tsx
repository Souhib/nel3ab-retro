/**
 * Un schéma de manette, allumé en direct.
 *
 * # Pourquoi il ne rend pas à chaque image
 *
 * React lit un instantané deux fois par seconde (règle 8): voir sa touche
 * s'allumer une demi-seconde après l'avoir appuyée ne rassure sur rien, et c'est
 * exactement ce que cet écran est censé faire. La boucle qui allume vit donc
 * hors de React, dans un effet qui pose des attributs sur les pièces déjà
 * dessinées — le composant dessine une fois, la boucle éclaire soixante fois par
 * seconde.
 *
 * C'est la même règle que pour l'image du jeu: ce qui bouge à la cadence de
 * l'écran ne passe pas par un rendu.
 */
import { cn } from "../lib/cn";
import type { PadMap } from "../lib/padmap";

export function PadMapView({
  map,
  title,
  note,
  /** La pièce que l'apprentissage attend, s'il y en a un en cours. */
  waiting,
  className,
}: {
  map: PadMap;
  title: string;
  note?: string;
  waiting?: string | null;
  className?: string;
}) {
  return (
    <figure className={cn("flex min-w-0 flex-col gap-2", className)}>
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[13px]">{title}</span>
        {note ? <span className="truncate text-[11px] text-faint">{note}</span> : null}
      </figcaption>
      <svg
        viewBox={map.viewBox ?? "-2 -2 104 66"}
        role="img"
        aria-label={title}
        data-padmap={map.id}
        data-flat={map.flat ? "oui" : undefined}
        className="w-full"
      >
        <path d={map.body} className="n3-shell" />

        {map.recess ? <path d={map.recess} className="n3-recess" /> : null}
        {map.slots ? <path d={map.slots} className="n3-slots" /> : null}
        {map.wire ? <path d={map.wire} className="n3-wire" /> : null}

        {map.parts.map((part) => {
          const half = part.r * (part.shape !== "rond" ? (part.wide ?? 1) : 1);
          const round = part.shape === "rond";
          const cap = (extra?: React.SVGProps<SVGCircleElement>) =>
            round
              ? { cx: part.x, cy: part.y, r: part.r, ...extra }
              : {
                  x: part.x - half,
                  y: part.y - part.r,
                  width: half * 2,
                  height: part.r * 2,
                  rx: Math.min(half, part.r),
                  ...extra,
                };
          return (
            <g key={part.key} data-part={part.key} data-lit="non" data-stick={part.stick}>
              {/* La garde d'un stick: la couronne octogonale qui borne sa course.
                  Dessinée SOUS la pièce et hors du groupe éclairé, parce qu'elle
                  ne s'allume pas — elle ne se presse pas. AU-DESSUS d'elle, le
                  corps du stick (le disque et son capot) vit dans son propre
                  groupe: la boucle d'affichage le DÉPLACE quand on incline le
                  stick, et la garde, elle, ne bouge pas. */}
              {part.gate ? (
                <circle cx={part.x} cy={part.y} r={part.r + 2} className="n3-gate" fill="none" />
              ) : null}
              <g
                className="n3-stick-body"
                data-drive={part.stick ? String(part.r * 0.72) : undefined}
              >
                {round ? (
                  <circle {...cap()} />
                ) : (
                  <rect {...(cap() as React.SVGProps<SVGRectElement>)} />
                )}
                {part.glyph ? (
                  <g transform={`translate(${part.x} ${part.y})`}>
                    <path d={part.glyph} className="n3-glyph" />
                  </g>
                ) : null}
              </g>
              {part.label ? (
                <text x={part.x} y={part.y + 1.3} textAnchor="middle" fontSize="3.4">
                  {part.label}
                </text>
              ) : null}
              {waiting === part.key ? (
                <circle
                  cx={part.x}
                  cy={part.y}
                  r={Math.max(half, part.r) + 2.4}
                  className="n3-wanted"
                  fill="none"
                />
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
