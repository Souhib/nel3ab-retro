/**
 * Le menu en grille, dans l'esprit du tableau de chaînes de la Wii.
 *
 * Ce qui le caractérise: un fond CLAIR, des tuiles carrées à coins arrondis
 * posées sur une grille régulière, un liseré fin autour de celle qu'on pointe,
 * et une barre en bas qui porte les actions. Tout est grand, tout est espacé, et
 * on lit une page entière d'un coup au lieu de faire défiler.
 *
 * Le rayon choisi est la PAGE: les rayons vivent dans la barre du bas, comme les
 * boutons de la console. C'est la vraie différence avec la croix, où tout est
 * visible en même temps: ici on voit une chose à la fois, en grand.
 */
import { useEffect } from "react";
import { cn } from "../lib/cn";
import type { MenuAction } from "../media/menupad";
import type { XmbCategory } from "./Xmb";
import { useShell } from "./shell";

/** Combien de tuiles par ligne. Quatre, comme la Wii: au-delà, une tuile n'est
 * plus lisible depuis un canapé. */
const ACROSS = 4;

export function Channels({
  categories,
  onClose,
  footer,
  onPad,
}: {
  categories: XmbCategory[];
  onClose: () => void;
  footer?: React.ReactNode;
  onPad?: (handler: ((action: MenuAction) => void) | null) => void;
}) {
  const shell = useShell(categories, ACROSS, onClose);
  const { category, items, ray, row } = shell;

  useEffect(() => {
    onPad?.(shell.act);
    return () => onPad?.(null);
  });

  return (
    <div id="menu" className="fixed inset-0 z-50 flex flex-col bg-panel">
      <header className="flex items-baseline justify-between border-b border-rule px-8 py-5">
        <h1 className="text-[20px] tracking-tight">{category?.label ?? ""}</h1>
        <span className="text-[12px] text-faint">{footer}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-8">
        <div className="mx-auto grid max-w-5xl grid-cols-4 gap-5">
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
                "flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl border-2 bg-ink px-4 text-center transition-all",
                index === row
                  ? "border-indigo shadow-[0_0_0_4px_var(--indigo-dim)]"
                  : "border-rule hover:border-rule-bright",
                item.disabled && "opacity-40",
              )}
            >
              <span className="h-12 w-12 text-muted">{item.icon}</span>
              <span className="line-clamp-2 text-[14px] leading-tight">{item.label}</span>
              {item.value ? (
                <span className="font-mono text-[12px] text-indigo">{item.value}</span>
              ) : null}
            </button>
          ))}
        </div>
        {items[row]?.hint ? (
          <p className="mx-auto max-w-5xl pt-5 text-center text-[13px] text-faint">
            {items[row].hint}
          </p>
        ) : null}
      </div>

      {/* La barre du bas porte les rayons, comme les boutons de la console. */}
      <footer className="flex items-center justify-center gap-3 border-t border-rule px-8 py-5">
        {categories.map((choice, index) => (
          <button
            key={choice.id}
            type="button"
            id={`ray-${choice.id}`}
            data-selected={index === ray}
            onClick={() => shell.goTo(index)}
            className={cn(
              "flex items-center gap-2 rounded-full border-2 px-5 py-2 text-[13px] transition-colors",
              index === ray ? "border-indigo text-indigo" : "border-rule text-muted",
            )}
          >
            <span className="h-5 w-5">{choice.icon}</span>
            {choice.label}
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
