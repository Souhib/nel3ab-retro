/** Le dessin est posé par React; paintWiring anime ses pièces sans le rendre.
 *
 * # Une manette en volume, avec six effets et pas une image
 *
 * La coque a un dégradé de haut en bas, un reflet vers le haut à gauche, ses
 * bords assombris (un trait flou découpé par la coque elle-même) et un liseré
 * clair en haut, sombre en bas. Chaque touche est posée dans son logement (le
 * même contour élargi, en sombre), a sa vraie couleur et reçoit un reflet
 * bombé. Un stick a sa cuvette, sa garde, et des anneaux ou un creux selon la
 * manette. Tout vient du plan (`lib/padmap.ts`) : ce composant ne connaît
 * aucune manette.
 *
 * Une seule lumière, en haut à gauche, pour toutes les manettes : deux dessins
 * côte à côte éclairés de deux côtés différents se liraient comme deux images
 * collées, pas comme deux objets sur la même table.
 */
import { useId, type CSSProperties, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { octagon, type Layer, type PadMap, type Part } from "../lib/padmap";

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
}) {
  const uid = useId().replaceAll(":", "");
  const ref = (name: string) => `url(#${uid}-${name})`;

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
          {part.stick ? (
            <circle cx={part.x} cy={part.y + 0.9} r={part.r} className="n3-stick-shadow" />
          ) : null}
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
              <circle
                cx={part.x}
                cy={part.y}
                r={part.r * 0.64}
                className="n3-dish"
                fill={ref("dish")}
              />
            </>
          ) : null}
          <Outline part={part} className="n3-gloss" fill={ref("gloss")} />
          {part.glyph ? (
            <g transform={`translate(${part.x} ${part.y})`}>
              <path d={part.glyph} className="n3-glyph" />
            </g>
          ) : null}
          {inscription && !at ? (
            <text x={part.x} y={part.y + size * 0.36} textAnchor="middle" fontSize={size}>
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
        className="w-full"
        style={
          {
            "--shell-fill": ref("shell"),
            "--grain-fill": ref("grain"),
          } as CSSProperties
        }
      >
        <defs>
          <linearGradient id={`${uid}-shell`} x2="0" y2="1">
            <stop stopColor="var(--pad-shell-top)" />
            <stop offset="1" stopColor="var(--pad-shell-bottom)" />
          </linearGradient>
          <radialGradient id={`${uid}-sheen`} cx="0.32" cy="0.12" r="0.75">
            <stop stopColor="#fff" stopOpacity="var(--pad-sheen)" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${uid}-rim`} x2="0" y2="1">
            <stop stopColor="#fff" stopOpacity="0.55" />
            <stop offset="0.3" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.75" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.5" />
          </linearGradient>
          <radialGradient id={`${uid}-gloss`} cx="0.36" cy="0.3" r="0.78">
            <stop stopColor="#fff" stopOpacity="0.5" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.72" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.38" />
          </radialGradient>
          <linearGradient id={`${uid}-dish`} x1="0.2" y1="0.1" x2="0.8" y2="0.9">
            <stop stopColor="#000" stopOpacity="0.45" />
            <stop offset="0.6" stopColor="#000" stopOpacity="0.05" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.18" />
          </linearGradient>
          <pattern id={`${uid}-grain`} width="1.1" height="1.1" patternUnits="userSpaceOnUse">
            <circle cx="0.55" cy="0.55" r="0.2" fill="#000" fillOpacity="0.28" />
          </pattern>
          <clipPath id={`${uid}-clip`}>
            <path d={map.body} />
          </clipPath>
          <filter id={`${uid}-soft`} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
          <filter id={`${uid}-drop`} x="-15%" y="-15%" width="130%" height="140%">
            <feDropShadow
              dx="0"
              dy="1.6"
              stdDeviation="1.3"
              floodColor="#000"
              floodOpacity="0.55"
            />
          </filter>
        </defs>
        <g filter={ref("drop")}>
          {map.wire ? <path d={map.wire} className="n3-wire" /> : null}
          <Layers layers={map.under} />
          {map.parts.filter((part) => part.under).map(piece)}
          <path d={map.body} className="n3-shell" />
          <path d={map.body} className="n3-sheen" fill={ref("sheen")} />
          <g clipPath={ref("clip")}>
            <Layers layers={map.art} />
            <path d={map.body} className="n3-inner" filter={ref("soft")} />
          </g>
          <path d={map.body} className="n3-rim" stroke={ref("rim")} />
          <Layers layers={map.deco} />
          {map.parts.filter((part) => !part.under).map(piece)}
        </g>
      </svg>
    </figure>
  );
}
