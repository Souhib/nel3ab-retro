/**
 * Le tableau des chaînes de la Wii.
 *
 * # Ce qui le rend reconnaissable
 *
 * **La lumière.** Fond très clair quadrillé de lignes fines, chaînes BLANCHES
 * posées dessus avec une ombre courte. Sans l'ombre, ce sont des cases dans une
 * grille; avec, ce sont des objets posés sur une table.
 *
 * **Le grossissement.** La chaîne pointée grandit un peu et prend un liseré
 * bleu. C'est le seul retour que donnait cette console, et c'est ce qu'on
 * cherche des yeux.
 *
 * **L'arrivée.** Les chaînes apparaissent l'une après l'autre en s'ouvrant, pas
 * toutes d'un coup. Ça dure moins d'une demi-seconde et c'est la moitié de ce
 * qu'on reconnaît.
 *
 * **Le bas de l'écran.** Une barre grise avec un gros bouton rond à gauche et un
 * plus petit à côté, et l'heure au-dessus des chaînes. Les rayons vivent là,
 * parce que cette console mettait ses commandes en bas et rien en haut.
 *
 * Les couleurs sont celles de la console et ne suivent pas le thème.
 */
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import type { MenuAction } from "../media/menupad";
import { Art } from "./Art";
import { Picker } from "./Picker";
import { useShell } from "./shell";
import type { XmbCategory } from "./Xmb";

/** Quatre par ligne: au-delà, une chaîne n'est plus lisible depuis un canapé. */
const ACROSS = 4;

const PAPER = "#dfe3e6";
const CHANNEL = "#ffffff";
const EDGE = "#c3cbd2";
const BLUE = "#26a4dd";
const INK = "#4a5259";

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
  const [clock, setClock] = useState(() => now());

  useEffect(() => {
    onPad?.(shell.act);
    return () => onPad?.(null);
  });

  // L'heure, en haut, comme sur la console. Rafraîchie à la minute: une horloge
  // qui compte les secondes sur un menu est une horloge qui clignote pour rien.
  useEffect(() => {
    const tick = window.setInterval(() => setClock(now()), 20_000);
    return () => window.clearInterval(tick);
  }, []);

  return (
    <div
      id="menu"
      className={cn(
        "n3-enter fixed inset-0 z-50 flex flex-col",
        shell.picking?.previewing ? "n3-peek" : "",
      )}
      style={{
        color: INK,
        background: PAPER,
        backgroundImage:
          "linear-gradient(rgba(255,255,255,.55) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.55) 1px, transparent 1px)",
        backgroundSize: "44px 44px",
      }}
    >
      <header className="flex items-baseline justify-center gap-6 px-8 pt-6 pb-2">
        <span className="text-[13px] opacity-60">{category?.label ?? ""}</span>
        <span className="font-mono text-[28px] tracking-tight" style={{ color: "#6b757d" }}>
          {clock}
        </span>
        <span className="text-[13px] opacity-50">{footer}</span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-10 py-6">
        <div className="mx-auto grid max-w-6xl grid-cols-4 gap-5">
          {items.map((item, index) => {
            const here = index === row;
            return (
              <button
                key={item.id}
                type="button"
                id={`item-${item.id}`}
                data-selected={here}
                disabled={item.disabled}
                onMouseEnter={() => shell.point(index)}
                onClick={() => shell.choose(index)}
                className={cn(
                  "n3-pop relative flex min-h-[178px] flex-col items-center justify-center gap-3 overflow-hidden rounded-[12px] px-2 py-3 text-center",
                  "transition-transform duration-200 ease-out",
                  here && "scale-[1.06]",
                  item.disabled && "opacity-45",
                )}
                style={{
                  animationDelay: `${Math.min(index, 11) * 45}ms`,
                  background: CHANNEL,
                  border: `2px solid ${here ? BLUE : EDGE}`,
                  boxShadow: here
                    ? `0 6px 18px rgba(38,164,221,.34), 0 0 0 4px rgba(38,164,221,.18)`
                    : "0 2px 6px rgba(70,80,90,.22)",
                }}
              >
                {/* Le vernis: la lumière du haut d'une chaîne. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-[12px]"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(255,255,255,.95) 0%, rgba(255,255,255,0) 100%)",
                  }}
                />
                {item.game ? (
                  <Art
                    index={item.game.index}
                    name={item.label}
                    has={item.game.art}
                    width={228}
                    className="rounded-[5px]"
                  />
                ) : (
                  <span className="relative flex h-12 w-12 opacity-35 [&>svg]:h-full [&>svg]:w-full">
                    {item.icon}
                  </span>
                )}
                <span className="relative line-clamp-2 text-[14px] leading-tight">
                  {item.label}
                </span>
                {item.by ? (
                  <span className="relative max-w-full truncate text-[11px] opacity-45">
                    {item.by}
                  </span>
                ) : null}
                {item.value ? (
                  <span className="relative font-mono text-[12px]" style={{ color: BLUE }}>
                    {item.value}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {items[row]?.hint ? (
          <p className="mx-auto max-w-5xl pt-6 text-center text-[13px] opacity-55">
            {items[row].hint}
          </p>
        ) : null}
      </div>

      <footer
        className="flex items-center gap-4 px-8 py-5"
        style={{
          background: "linear-gradient(180deg, #cfd6db 0%, #b9c2c9 100%)",
          borderTop: `1px solid ${EDGE}`,
        }}
      >
        <Round big label="reprendre" id="closeMenu" onClick={onClose} />
        <div className="flex flex-1 justify-center gap-3">
          {categories.map((choice, index) => (
            <button
              key={choice.id}
              type="button"
              id={`ray-${choice.id}`}
              data-selected={index === ray}
              onClick={() => shell.goTo(index)}
              className="flex items-center gap-2 rounded-full px-5 py-2 text-[13px] transition-all duration-150"
              style={{
                background: CHANNEL,
                border: `2px solid ${index === ray ? BLUE : EDGE}`,
                color: index === ray ? BLUE : INK,
                boxShadow: index === ray ? `0 0 0 3px rgba(38,164,221,.2)` : "none",
              }}
            >
              <span className="flex h-5 w-5 opacity-60 [&>svg]:h-full [&>svg]:w-full">
                {choice.icon}
              </span>
              {choice.label}
            </button>
          ))}
        </div>
        <span className="w-[92px]" />
      </footer>

      <Picker
        picking={shell.picking}
        costume={{
          panel: CHANNEL,
          ink: INK,
          edge: EDGE,
          accent: BLUE,
          veil: "rgba(90,100,110,.35)",
        }}
      />
    </div>
  );
}

/** Le gros bouton rond du bas, celui qui ramène d'où on vient. */
function Round({
  big,
  label,
  id,
  onClick,
}: {
  big?: boolean;
  label: string;
  id?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center rounded-full text-[12px] transition-transform duration-150 hover:scale-105",
        big ? "h-[74px] w-[92px]" : "h-14 w-14",
      )}
      style={{
        background: "linear-gradient(180deg, #ffffff 0%, #e6ebee 100%)",
        border: `2px solid ${EDGE}`,
        color: INK,
        boxShadow: "0 3px 8px rgba(70,80,90,.28)",
      }}
    >
      {label}
    </button>
  );
}

/** L'heure, comme la console l'écrivait: sans les secondes. */
function now(): string {
  const at = new Date();
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}
