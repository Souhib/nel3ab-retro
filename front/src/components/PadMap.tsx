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

/** Les coins en pixels d'une pièce : quatre angles droits autour de sa boîte,
 * et la flèche ▶ en escalier qui arrive par la gauche. Toujours dans le
 * balisage, montrés par la feuille seulement (choix, attente, marques du pas
 * à pas) : poser une marque ne change qu'un attribut. */
function coinsDe(part: Part): { coins: string; fleche: string } {
  const demi = Math.max(part.r * (part.wide ?? 1), part.r) + 1.6;
  const haut = part.r + 1.6;
  const [g, d, h, b] = [part.x - demi, part.x + demi, part.y - haut, part.y + haut];
  const l = Math.min(2, demi / 2, haut / 2);
  const f = (n: number) => +n.toFixed(2);
  const coins = [
    `M${f(g)} ${f(h + l)}V${f(h)}H${f(g + l)}`,
    `M${f(d - l)} ${f(h)}H${f(d)}V${f(h + l)}`,
    `M${f(d)} ${f(b - l)}V${f(b)}H${f(d - l)}`,
    `M${f(g + l)} ${f(b)}H${f(g)}V${f(b - l)}`,
  ].join("");
  // Trois marches de 0,8 de chaque côté de la pointe : un ▶ de pixels.
  const x = g - 1.2;
  const y = part.y;
  const fleche = `M${f(x)} ${f(y)}h-0.8v-0.8h-0.8v-0.8h-0.8v-0.8h-0.4v6.4h0.4v-0.8h0.8v-0.8h0.8v-0.8h0.8z`;
  return { coins, fleche };
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
  absente = false,
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
  /** Aucune manette vue : la coque seule, tramée sous l'effet « tramage ». */
  absente?: boolean;
}) {
  // Le décor de la coque est découpé par elle : une découpe n'est pas une
  // lumière, et sans elle les grains de la manette Pro débordent du dessin.
  const decoupe = `${useId().replaceAll(":", "")}-coque`;
  const piece = (part: Part): ReactNode => {
    const label = labels?.[part.key] ?? (part.label || part.key);
    const { coins, fleche } = coinsDe(part);
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
        data-attendue={waiting === part.key ? "oui" : undefined}
        // Le dessin montre, la liste agit : un clic de souris choisit la
        // ligne, et la tabulation passe par la liste, jamais par une pièce.
        role={onSelect ? "button" : undefined}
        tabIndex={onSelect ? -1 : undefined}
        aria-label={onSelect ? `Configurer ${label}` : undefined}
        aria-pressed={onSelect ? selected === part.key : undefined}
        onClick={onSelect ? () => onSelect(part.key) : undefined}
        style={
          {
            "--part-tint": part.tint ?? "var(--pad-cap)",
            "--part-ink": part.ink ?? "var(--pad-ink)",
          } as CSSProperties
        }
      >
        <title>{label}</title>
        {onSelect ? (
          // La zone de clic, invisible : son rayon suit la taille rendue
          // (`manettes/reglage/zones.ts`), la pièce elle-même au départ.
          <circle cx={part.x} cy={part.y} r={part.r} data-r={part.r} className="n3-zone" />
        ) : null}
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
        <path d={coins} className="n3-coins" />
        <path d={fleche} className="n3-fleche" />
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
        data-absente={absente ? "oui" : undefined}
        style={absente ? ({ "--trame": `url(#${decoupe}-trame)` } as CSSProperties) : undefined}
        className="w-full"
      >
        {absente ? (
          <pattern id={`${decoupe}-trame`} width="1" height="1" patternUnits="userSpaceOnUse">
            <rect width="0.5" height="0.5" className="n3-trame" />
            <rect x="0.5" y="0.5" width="0.5" height="0.5" className="n3-trame" />
          </pattern>
        ) : null}
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
