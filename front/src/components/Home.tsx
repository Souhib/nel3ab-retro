/**
 * Le menu en rangée, dans l'esprit de l'écran d'accueil de la Switch.
 *
 * Ce qui le caractérise: une barre en haut avec qui joue et l'heure, une RANGÉE
 * de grandes tuiles carrées au milieu, et une barre en bas avec les rayons en
 * petites icônes. On se déplace à l'horizontale dans la rangée; la tuile pointée
 * grandit et sort du rang.
 *
 * C'est l'inverse du XMB: là où celui-ci montre deux axes en même temps, celui-là
 * en montre un seul et le montre en grand.
 *
 * Les couleurs sont celles de la console et **ne suivent pas le thème**: le gris
 * très sombre, le blanc, et le rouge. Une Switch en ambre ne serait plus une
 * Switch, et c'est la différence entre un thème, qui habille la salle, et un
 * menu, qui est un costume.
 */

/** Le gris de l'écran d'accueil, et le rouge de la marque. */
const INK = "#2d2d2d";
const TILE = "#3c3c3c";
const EDGE = "#4c4c4c";
const RED = "#e60012";
import { useEffect } from "react";
import { cn } from "../lib/cn";
import type { MenuAction } from "../media/menupad";
import { useShell } from "./shell";
import type { XmbCategory } from "./Xmb";

export function Home({
  categories,
  onClose,
  footer,
  onPad,
  paused,
  who,
}: {
  categories: XmbCategory[];
  onClose: () => void;
  footer?: React.ReactNode;
  onPad?: (handler: ((action: MenuAction) => void) | null) => void;
  paused?: boolean;
  who: string;
}) {
  // Une rangée: haut et bas changent de rayon, gauche et droite parcourent les
  // entrées. C'est le contraire de la croix, et l'échange se fait dans la
  // mécanique partagée pour que le clavier et la manette le voient pareil.
  const shell = useShell(categories, 1, onClose, paused, true);
  const { items, ray, row } = shell;

  useEffect(() => {
    onPad?.(shell.act);
    return () => onPad?.(null);
  });

  return (
    <div
      id="menu"
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: INK, color: "#f0f0f0" }}
    >
      <header
        className="flex items-center justify-between px-8 py-4"
        style={{ borderBottom: `1px solid ${EDGE}` }}
      >
        <span className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full text-[14px]"
            style={{ background: RED, color: "#fff" }}
          >
            {who.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-[14px]">{who}</span>
        </span>
        <span className="text-[12px] opacity-50">{footer}</span>
      </header>

      <div className="flex min-h-0 flex-1 items-center overflow-x-auto px-8">
        <div className="flex items-center gap-5">
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
                "flex shrink-0 flex-col items-center justify-center gap-3 rounded-xl px-5 text-center transition-all duration-200",
                index === row ? "h-56 w-56" : "h-40 w-40 opacity-60 hover:opacity-90",
                item.disabled && "opacity-30",
              )}
              style={{
                background: TILE,
                border: `3px solid ${index === row ? "#f0f0f0" : EDGE}`,
              }}
            >
              <span className={cn("opacity-70", index === row ? "h-14 w-14" : "h-10 w-10")}>
                {item.icon}
              </span>
              <span
                className={cn(
                  "line-clamp-2 leading-tight",
                  index === row ? "text-[15px]" : "text-[12px]",
                )}
              >
                {item.label}
              </span>
              {item.value ? (
                <span className="font-mono text-[12px]" style={{ color: RED }}>
                  {item.value}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <p className="px-8 pb-2 text-center text-[13px] opacity-50">{items[row]?.hint ?? ""}</p>

      <footer
        className="flex items-center justify-center gap-4 px-8 py-4"
        style={{ borderTop: `1px solid ${EDGE}` }}
      >
        {categories.map((choice, index) => (
          <button
            key={choice.id}
            type="button"
            id={`ray-${choice.id}`}
            data-selected={index === ray}
            onClick={() => shell.goTo(index)}
            className="flex h-11 w-11 items-center justify-center rounded-full border-2 transition-colors"
            style={{
              borderColor: index === ray ? "#f0f0f0" : EDGE,
              opacity: index === ray ? 1 : 0.6,
            }}
            title={choice.label}
          >
            <span className="h-6 w-6">{choice.icon}</span>
          </button>
        ))}
        <button
          type="button"
          id="closeMenu"
          onClick={onClose}
          className="ml-6 rounded-full border-2 px-5 py-2 text-[13px]"
          style={{ borderColor: EDGE }}
        >
          reprendre
        </button>
      </footer>
    </div>
  );
}
