/**
 * Le menu en rangée, dans l'esprit de l'écran d'accueil de la Switch.
 *
 * Ce qui le caractérise: une barre en haut avec qui joue et l'heure, une RANGÉE
 * de grandes tuiles carrées au milieu, et une barre en bas avec les rayons en
 * petites icônes. On se déplace à l'horizontale dans la rangée; la tuile pointée
 * grandit et sort du rang.
 *
 * C'est l'inverse de la croix: là où le XMB montre deux axes en même temps,
 * celui-ci en montre un seul et le montre en grand.
 */
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
  who,
}: {
  categories: XmbCategory[];
  onClose: () => void;
  footer?: React.ReactNode;
  onPad?: (handler: ((action: MenuAction) => void) | null) => void;
  who: string;
}) {
  // Une rangée: haut et bas changent de rayon, gauche et droite parcourent les
  // entrées. C'est le contraire de la croix, et c'est ce que `perRow` exprime.
  const shell = useShell(categories, 1, onClose);
  const { items, ray, row } = shell;

  useEffect(() => {
    onPad?.((action) => {
      if (action === "up") return shell.goTo(Math.max(0, ray - 1));
      if (action === "down") return shell.goTo(Math.min(categories.length - 1, ray + 1));
      if (action === "left") return shell.point(Math.max(0, row - 1));
      if (action === "right") return shell.point(Math.min(items.length - 1, row + 1));
      shell.act(action);
    });
    return () => onPad?.(null);
  });

  return (
    <div id="menu" className="fixed inset-0 z-50 flex flex-col bg-ink">
      <header className="flex items-center justify-between border-b border-rule px-8 py-4">
        <span className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-indigo text-[13px] text-indigo">
            {who.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-[14px]">{who}</span>
        </span>
        <span className="text-[12px] text-faint">{footer}</span>
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
                "flex shrink-0 flex-col items-center justify-center gap-3 rounded-xl border-2 bg-panel px-5 text-center transition-all duration-200",
                index === row
                  ? "h-56 w-56 border-indigo"
                  : "h-40 w-40 border-rule opacity-60 hover:opacity-90",
                item.disabled && "opacity-30",
              )}
            >
              <span className={cn("text-muted", index === row ? "h-14 w-14" : "h-10 w-10")}>
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
                <span className="font-mono text-[12px] text-indigo">{item.value}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <p className="px-8 pb-2 text-center text-[13px] text-faint">{items[row]?.hint ?? ""}</p>

      <footer className="flex items-center justify-center gap-4 border-t border-rule px-8 py-4">
        {categories.map((choice, index) => (
          <button
            key={choice.id}
            type="button"
            id={`ray-${choice.id}`}
            data-selected={index === ray}
            onClick={() => shell.goTo(index)}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full border-2 transition-colors",
              index === ray ? "border-indigo text-indigo" : "border-rule text-muted",
            )}
            title={choice.label}
          >
            <span className="h-6 w-6">{choice.icon}</span>
          </button>
        ))}
        <button
          type="button"
          id="closeMenu"
          onClick={onClose}
          className="ml-6 rounded-full border-2 border-rule px-5 py-2 text-[13px] text-muted hover:border-indigo hover:text-indigo"
        >
          reprendre
        </button>
      </footer>
    </div>
  );
}
