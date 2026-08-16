/**
 * Le tableau de bord de la Xbox 360, en lames.
 *
 * Ce qui le caractérise: des panneaux verticaux de couleur, empilés vers la
 * gauche, dont un seul est ouvert. Les autres ne montrent que leur tranche, et
 * on passe de l'un à l'autre à gauche et à droite. La lame ouverte porte son
 * titre en haut et sa liste dessous.
 *
 * Les couleurs sont celles de la console et **ne suivent pas le thème**: un
 * tableau de bord de Xbox en vert Game Boy ne serait plus un tableau de bord de
 * Xbox. C'est la différence entre un thème, qui habille la salle, et un menu,
 * qui est un costume.
 */
import { useEffect } from "react";
import { cn } from "../lib/cn";
import type { MenuAction } from "../media/menupad";
import { useShell } from "./shell";
import type { XmbCategory } from "./Xmb";

/** Le vert du tableau de bord, et les couleurs que les lames portaient. */
const GREEN = "#5dc21e";
const BLADES = ["#5dc21e", "#e8a020", "#2a8fd8", "#b64ac0"];
const INK = "#101010";
const PANEL = "#1c1c1c";

export function Blades({
  categories,
  onClose,
  footer,
  onPad,
  paused,
}: {
  categories: XmbCategory[];
  onClose: () => void;
  footer?: React.ReactNode;
  onPad?: (handler: ((action: MenuAction) => void) | null) => void;
  paused?: boolean;
}) {
  const shell = useShell(categories, 1, onClose, paused);
  const { category, items, ray, row } = shell;
  const colour = BLADES[ray % BLADES.length];

  useEffect(() => {
    onPad?.(shell.act);
    return () => onPad?.(null);
  });

  return (
    <div
      id="menu"
      className="fixed inset-0 z-50 flex"
      style={{ background: INK, color: "#e8e8e8" }}
    >
      {/* Les lames fermées: leur tranche, et rien d'autre. */}
      {categories.map((choice, index) =>
        index < ray ? (
          <button
            key={choice.id}
            type="button"
            id={`ray-${choice.id}`}
            onClick={() => shell.goTo(index)}
            className="flex w-16 shrink-0 flex-col items-center justify-center gap-3 border-r border-black/40"
            style={{ background: BLADES[index % BLADES.length] }}
          >
            <span className="h-6 w-6 text-black/70">{choice.icon}</span>
            <span
              className="text-[12px] uppercase tracking-[0.2em] text-black/70"
              style={{ writingMode: "vertical-rl" }}
            >
              {choice.label}
            </span>
          </button>
        ) : null,
      )}

      {/* La lame ouverte. */}
      <div className="flex min-w-0 flex-1 flex-col" style={{ background: PANEL }}>
        <header
          className="flex items-baseline justify-between px-8 py-5"
          style={{ background: colour, color: "#101010" }}
        >
          <h1 className="text-[20px] uppercase tracking-[0.14em]">{category?.label ?? ""}</h1>
          <span className="text-[12px] opacity-70">{footer}</span>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="flex max-w-3xl flex-col">
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                id={`item-${item.id}`}
                data-selected={index === row}
                disabled={item.disabled}
                onMouseEnter={() => shell.point(index)}
                onClick={() => shell.choose(index)}
                className={cn(
                  "flex items-center justify-between gap-6 px-5 py-3 text-left transition-colors",
                  item.disabled && "opacity-40",
                )}
                style={
                  index === row
                    ? { background: "#e8e8e8", color: "#101010" }
                    : { background: "transparent" }
                }
              >
                <span className="flex min-w-0 items-center gap-4">
                  <span className="h-7 w-7 shrink-0 opacity-70">{item.icon}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[16px]">{item.label}</span>
                    {index === row && item.hint ? (
                      <span className="truncate text-[12px] opacity-60">{item.hint}</span>
                    ) : null}
                  </span>
                </span>
                {item.value ? (
                  <span
                    className="shrink-0 font-mono text-[13px]"
                    style={{ color: index === row ? colour : "#8a8a8a" }}
                  >
                    {item.value}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <footer className="flex items-center justify-between px-8 py-4 text-[12px] opacity-60">
          <span>← → lame · ↑ ↓ entrée · A choisit</span>
          <button type="button" id="closeMenu" onClick={onClose} style={{ color: GREEN }}>
            B reprend la partie
          </button>
        </footer>
      </div>

      {/* Les lames encore fermées, à droite. */}
      {categories.map((choice, index) =>
        index > ray ? (
          <button
            key={choice.id}
            type="button"
            id={`ray-${choice.id}`}
            onClick={() => shell.goTo(index)}
            className="flex w-16 shrink-0 flex-col items-center justify-center gap-3 border-l border-black/40"
            style={{ background: BLADES[index % BLADES.length] }}
          >
            <span className="h-6 w-6 text-black/70">{choice.icon}</span>
            <span
              className="text-[12px] uppercase tracking-[0.2em] text-black/70"
              style={{ writingMode: "vertical-rl" }}
            >
              {choice.label}
            </span>
          </button>
        ) : null,
      )}
    </div>
  );
}
