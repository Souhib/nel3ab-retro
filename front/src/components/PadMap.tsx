/** Le dessin est posé par React; paintWiring anime ses pièces sans le rendre.
 *
 * # Une manette en aplats nets
 *
 * Depuis le 23 novembre 2026 (thème rétro, chantier manettes), une matière est
 * un aplat et la coque a un contour net : plus de dégradé, de reflet, de
 * liseré, d'ombre ni de filtre. Chaque touche reste posée dans son logement,
 * avec sa vraie couleur ; un stick garde sa garde et ses anneaux ou son
 * creux. Tout vient du plan (`lib/padmap.ts`) : ce composant ne connaît
 * aucune manette. Les couleurs sont dans `padmap.css` et `regie.css`.
 *
 * `place` pose `data-place` : une touche appuyée prend la couleur de la place
 * de la page, jamais celle d'un autre joueur.
 */
import { useId, type CSSProperties, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { octagon, type Layer, type PadMap, type Part } from "../lib/padmap";
import "./padmap.css";

/** Le contour d'une pièce : son tracé exact, ou un disque, ou une pastille. */
function Outline({ part, className, fill }: { part: Part; className: string; fill?: string }) {
  if (part.d) return <path d={part.d} className={className} fill={fill} />;
  if (part.shape === "rond") {
    return <circle cx={part.x} cy={part.y} r={part.r} className={className} fill={fill} />;
  }
  const half = part.r * (part.wide ?? 1);
  return (
    <rect
      x={part.x - half}
      y={part.y - part.r}
      width={half * 2}
      height={part.r * 2}
      rx={Math.min(half, part.r) * 0.75}
      className={className}
      fill={fill}
    />
  );
}

function Layers({ layers }: { layers?: readonly Layer[] }) {
  if (!layers?.length) return null;
  return (
    <>
      {layers.map((layer, index) => (
        <path key={index} d={layer.d} className="n3-art" data-tone={layer.tone} />
      ))}
    </>
  );
}

export function PadMapView({
  map,
  title,
  note,
  waiting,
  selected,
  onSelect,
  labels,
  className,
  rawLabels = false,
  place = null,
}: {
  map: PadMap;
  title: string;
  note?: string;
  waiting?: string | null;
  selected?: string | null;
  onSelect?: (key: string) => void;
  labels?: Record<string, string>;
  className?: string;
  rawLabels?: boolean;
  /** La place de la page, de 1 à 4, ou rien (spectateur, planche). */
  place?: 1 | 2 | 3 | 4 | null;
}) {
  // Le décor de la coque est découpé par elle : une découpe n'est pas une
  // lumière, et sans elle les grains de la manette Pro débordent du dessin.
  const decoupe = `${useId().replaceAll(":", "")}-coque`;
  const piece = (part: Part): ReactNode => {
    const half = part.r * (part.wide ?? 1);
    const label = labels?.[part.key] ?? (part.label || part.key);
    const inscription = rawLabels ? part.key : part.label;
    const size = part.size ?? (inscription.length > 3 ? 2.2 : 3.2);
    const at = part.callout;
    return (
      <g
        key={part.key}
        data-part={part.key}
        data-lit="non"
        data-stick={part.stick}
        data-under={part.under ? "oui" : undefined}
        data-hangs={part.hangs ? "oui" : undefined}
        data-flush={part.flush ? "oui" : undefined}
        data-selected={selected === part.key ? "oui" : undefined}
        role={onSelect ? "button" : undefined}
        tabIndex={onSelect ? 0 : undefined}
        aria-label={onSelect ? `Configurer ${label}` : undefined}
        aria-pressed={onSelect ? selected === part.key : undefined}
        onClick={onSelect ? () => onSelect(part.key) : undefined}
        onKeyDown={
          onSelect
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(part.key);
                }
              }
            : undefined
        }
        style={
          {
            "--part-tint": part.tint ?? "var(--pad-cap)",
            "--part-ink": part.ink ?? "var(--pad-ink)",
          } as CSSProperties
        }
      >
        <title>{label}</title>
        {at ? <path d={`M ${part.x} ${part.y} L ${at.x} ${at.y}`} className="n3-leader" /> : null}
        {part.gate ? (
          part.gate === "octogone" ? (
            <path d={octagon(part.x, part.y, part.r + 2.2)} className="n3-gate" />
          ) : (
            <circle cx={part.x} cy={part.y} r={part.r + 1.7} className="n3-gate" />
          )
        ) : part.under || part.hangs || part.flush ? null : (
          <Outline part={part} className="n3-well" />
        )}
        <g className="n3-stick-body" data-drive={part.stick ? String(part.r * 0.72) : undefined}>
          <Outline part={part} className="n3-cap" />
          {part.grip === "anneaux" ? (
            <g className="n3-stick-grip">
              <circle cx={part.x} cy={part.y} r={part.r * 0.72} />
              <circle cx={part.x} cy={part.y} r={part.r * 0.47} />
              <circle cx={part.x} cy={part.y} r={part.r * 0.22} />
            </g>
          ) : null}
          {part.grip === "creux" ? (
            <>
              <circle
                cx={part.x}
                cy={part.y}
                r={part.r * 0.9}
                className="n3-stick-grip"
                strokeDasharray="0.35 0.35"
              />
              <circle cx={part.x} cy={part.y} r={part.r * 0.64} className="n3-stick-grip" />
            </>
          ) : null}
          {part.glyph ? (
            <g transform={`translate(${part.x} ${part.y})`}>
              <path d={part.glyph} className="n3-glyph" />
            </g>
          ) : null}
          {inscription && !at ? (
            <text
              x={part.x}
              y={part.y + size * 0.36}
              textAnchor="middle"
              fontSize={size}
              data-taille={size}
              data-piece={part.r * 2}
            >
              {inscription}
            </text>
          ) : null}
        </g>
        {inscription && at ? (
          <text
            x={at.x}
            y={at.y + size * 0.36}
            textAnchor={at.anchor ?? "middle"}
            fontSize={size}
            data-taille={size}
            className="n3-callout"
          >
            {inscription}
          </text>
        ) : null}
        {waiting === part.key || selected === part.key ? (
          <rect
            x={part.x - Math.max(half, part.r) - 1.6}
            y={part.y - part.r - 1.6}
            width={Math.max(half, part.r) * 2 + 3.2}
            height={part.r * 2 + 3.2}
            rx={part.r + 1.6}
            className={waiting === part.key ? "n3-wanted" : "n3-selection"}
          />
        ) : null}
      </g>
    );
  };

  return (
    <figure className={cn("n3-controller", className)}>
      <figcaption>
        <span className="text-corps font-medium">{title}</span>
        {note ? <span className="text-note text-muted">{note}</span> : null}
      </figcaption>
      <svg
        viewBox={map.viewBox ?? "-2 -2 104 66"}
        role={onSelect ? "group" : "img"}
        aria-label={title}
        data-padmap={map.id}
        data-place={place ?? undefined}
        className="w-full"
      >
        <g>
          {map.wire ? <path d={map.wire} className="n3-wire" /> : null}
          <Layers layers={map.under} />
          {map.parts.filter((part) => part.under).map(piece)}
          <path d={map.body} className="n3-shell" />
          <clipPath id={decoupe}>
            <path d={map.body} />
          </clipPath>
          <g clipPath={`url(#${decoupe})`}>
            <Layers layers={map.art} />
          </g>
          <Layers layers={map.deco} />
          {map.parts.filter((part) => !part.under).map(piece)}
        </g>
      </svg>
    </figure>
  );
}
