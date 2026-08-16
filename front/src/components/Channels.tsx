/**
 * Le menu en grille, dans l'esprit du tableau de chaînes de la Wii.
 *
 * Ce qui le caractérise: un fond CLAIR, des tuiles carrées à coins arrondis
 * posées sur une grille régulière, un liseré fin autour de celle qu'on pointe,
 * et une barre en bas qui porte les actions. Tout est grand, tout est espacé, et
 * on lit une page entière d'un coup au lieu de faire défiler.
 *
 * Le rayon choisi est la PAGE: les rayons vivent dans la barre du bas, comme les
 * deux boutons ronds de la console. C'est la vraie différence avec le XMB, où
 * tout est visible en même temps: ici on voit une chose à la fois, en grand.
 *
 * Les couleurs sont celles de la console et **ne suivent pas le thème**: blanc,
 * gris clair, et le bleu des liserés. Une Wii en vert Game Boy ne serait plus
 * une Wii, et c'est la différence entre un thème, qui habille la salle, et un
 * menu, qui est un costume.
 */

/** Le blanc, le gris des chaînes et le bleu du liseré. */
const PAPER = "#f4f4f4";
const CHANNEL = "#fdfdfd";
const EDGE = "#d8dde2";
const BLUE = "#1ba4e2";
const INK = "#3a3f44";
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
  paused,
}: {
  categories: XmbCategory[];
  onClose: () => void;
  footer?: React.ReactNode;
  onPad?: (handler: ((action: MenuAction) => void) | null) => void;
  paused?: boolean;
}) {
  const shell = useShell(categories, ACROSS, onClose, paused);
  const { category, items, ray, row } = shell;

  useEffect(() => {
    onPad?.(shell.act);
    return () => onPad?.(null);
  });

  return (
    <div
      id="menu"
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: PAPER, color: INK }}
    >
      <header
        className="flex items-baseline justify-between px-8 py-5"
        style={{ borderBottom: `1px solid ${EDGE}` }}
      >
        <h1 className="text-[20px] tracking-tight">{category?.label ?? ""}</h1>
        <span className="text-[12px] opacity-50">{footer}</span>
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
                "flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl px-4 text-center transition-all",
                item.disabled && "opacity-40",
              )}
              style={{
                background: CHANNEL,
                border: `2px solid ${index === row ? BLUE : EDGE}`,
                boxShadow: index === row ? `0 0 0 5px ${BLUE}33` : "none",
              }}
            >
              <span className="h-12 w-12 opacity-40">{item.icon}</span>
              <span className="line-clamp-2 text-[14px] leading-tight">{item.label}</span>
              {item.value ? (
                <span className="font-mono text-[12px]" style={{ color: BLUE }}>
                  {item.value}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {items[row]?.hint ? (
          <p className="mx-auto max-w-5xl pt-5 text-center text-[13px] opacity-50">
            {items[row].hint}
          </p>
        ) : null}
      </div>

      {/* La barre du bas porte les rayons, comme les boutons de la console. */}
      <footer
        className="flex items-center justify-center gap-3 px-8 py-5"
        style={{ borderTop: `1px solid ${EDGE}` }}
      >
        {categories.map((choice, index) => (
          <button
            key={choice.id}
            type="button"
            id={`ray-${choice.id}`}
            data-selected={index === ray}
            onClick={() => shell.goTo(index)}
            className="flex items-center gap-2 rounded-full border-2 px-5 py-2 text-[13px] transition-colors"
            style={{
              borderColor: index === ray ? BLUE : EDGE,
              color: index === ray ? BLUE : INK,
              background: CHANNEL,
            }}
          >
            <span className="h-5 w-5">{choice.icon}</span>
            {choice.label}
          </button>
        ))}
        <button
          type="button"
          id="closeMenu"
          onClick={onClose}
          className="ml-6 rounded-full border-2 px-5 py-2 text-[13px]"
          style={{ borderColor: EDGE, background: CHANNEL }}
        >
          reprendre
        </button>
      </footer>
    </div>
  );
}
