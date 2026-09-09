/** Le dessin est posé par React; paintWiring anime ses pièces sans le rendre. */
import { useId, type CSSProperties } from "react";
import { cn } from "../lib/cn";
import type { PadMap } from "../lib/padmap";

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
  return (
    <figure className={cn("n3-controller", className)}>
      <figcaption>
        <span className="text-[13px] font-medium">{title}</span>
        {note ? <span className="text-[11px] text-muted">{note}</span> : null}
      </figcaption>
      <svg
        viewBox={map.viewBox ?? "-2 -2 104 66"}
        role={onSelect ? "group" : "img"}
        aria-label={title}
        data-padmap={map.id}
        className="w-full"
        style={
          {
            "--shell-fill": `url(#${uid}-shell)`,
            "--cap-fill": `url(#${uid}-cap)`,
          } as CSSProperties
        }
      >
        <defs>
          <linearGradient id={`${uid}-shell`} x2="0" y2="1">
            <stop stopColor="var(--pad-shell-top)" />
            <stop offset="1" stopColor="var(--pad-shell-bottom)" />
          </linearGradient>
          <linearGradient id={`${uid}-cap`} x2="0" y2="1">
            <stop stopColor="var(--pad-cap-top)" />
            <stop offset="1" stopColor="var(--pad-cap-bottom)" />
          </linearGradient>
        </defs>
        {map.wire ? <path d={map.wire} className="n3-wire" /> : null}
        <path d={map.body} className="n3-shell" />
        {map.recess ? <path d={map.recess} className="n3-recess" /> : null}
        {map.slots ? <path d={map.slots} className="n3-slots" /> : null}
        {map.parts.map((part) => {
          const half = part.r * (part.wide ?? 1);
          const label = labels?.[part.key] ?? (part.label || part.key);
          const inscription = rawLabels ? part.key : part.label;
          return (
            <g
              key={part.key}
              data-part={part.key}
              data-lit="non"
              data-stick={part.stick}
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
              style={{ "--part-tint": part.tint ?? "var(--muted)" } as CSSProperties}
            >
              <title>{label}</title>
              {part.gate ? (
                <circle cx={part.x} cy={part.y} r={part.r + 2} className="n3-gate" />
              ) : null}
              <g
                className="n3-stick-body"
                data-drive={part.stick ? String(part.r * 0.72) : undefined}
              >
                {part.shape === "rond" ? (
                  <circle cx={part.x} cy={part.y} r={part.r} className="n3-cap" />
                ) : (
                  <rect
                    x={part.x - half}
                    y={part.y - part.r}
                    width={half * 2}
                    height={part.r * 2}
                    rx={Math.min(half, part.r) * 0.6}
                    className="n3-cap"
                  />
                )}
                {part.stick ? (
                  <circle cx={part.x} cy={part.y} r={part.r * 0.65} className="n3-stick-grip" />
                ) : null}
                {part.glyph ? (
                  <g transform={`translate(${part.x} ${part.y})`}>
                    <path d={part.glyph} className="n3-glyph" />
                  </g>
                ) : null}
                {inscription ? (
                  <text
                    x={part.x}
                    y={part.y + 1.2}
                    textAnchor="middle"
                    fontSize={inscription.length > 4 ? "2.1" : "3.3"}
                  >
                    {inscription}
                  </text>
                ) : null}
              </g>
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
        })}
      </svg>
    </figure>
  );
}
