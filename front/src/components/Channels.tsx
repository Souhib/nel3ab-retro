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
import { useShell, useSwipe } from "./shell";
import type { XmbCategory } from "./Xmb";

/** Quatre par ligne: au-delà, une chaîne n'est plus lisible depuis un canapé. */
const ACROSS = 4;

const PAPER = "#dfe3e6";
const CHANNEL = "#ffffff";
const EDGE = "#c3cbd2";
const BLUE = "#26a4dd";

/** Le même bleu, assez sombre pour porter du TEXTE.
 *
 * `BLUE` vaut 2,82:1 sur une carte blanche et 2,19:1 sur le fond: il fait un
 * très bon liseré de sélection — un élément d'interface n'a besoin que de 3:1 —
 * et un très mauvais texte. Il servait aux deux.
 *
 * Celui-ci tient 5,83:1 sur la carte et 4,52:1 sur le fond, à teinte et
 * saturation constantes. Deux rôles, une seule couleur d'origine: c'est la même
 * correction que pour `--faint`, et pour la même raison.
 */
const BLUE_INK = "#176c93";
const INK = "#4a5259";

/**
 * L'encre du texte SECONDAIRE, et pourquoi ce n'est pas une opacité.
 *
 * Sur les deux coques sombres, atténuer par l'alpha marche: `#e8e8ee` sur
 * `#08080a` tient 4,5:1 jusqu'à 0,50 d'opacité. Ici non, et la raison est dans
 * la formule du contraste: sur un fond CLAIR, baisser l'opacité rapproche le
 * texte du fond, et le rapport s'effondre bien plus vite. Mesuré le 31 août
 * 2026: l'encre actuelle ne tient 4,5:1 que jusqu'à 0,86 d'opacité — autant dire
 * qu'elle ne peut pas s'atténuer du tout. Et assombrir l'encre ne sauve pas
 * grand-chose: même à 11:1 le plancher reste 0,68.
 *
 * D'où une seconde COULEUR plutôt qu'un alpha, choisie pour tenir le seuil sur
 * les deux fonds de cette coque: 4,54:1 sur le fond, 5,85:1 sur une carte
 * blanche. C'est ce que fait un système de couleurs sérieux — des rôles, pas de
 * la transparence.
 *
 * La leçon, plus générale que cette coque: l'alpha est une façon d'atténuer qui
 * marche sur du sombre et qui ment sur du clair.
 */
const INK_SOFT = "#5d666d";

/** Combien de cases vides ajouter pour que le tableau reste un tableau.
 *
 * On complète jusqu'à la ligne pleine, avec un minimum de deux lignes: une seule
 * ligne à moitié remplie se lit comme une rangée, pas comme un tableau. Douze au
 * plus, parce qu'au-delà on dessine du vide pour du vide.
 */
const EMPTY_SLOTS = (held: number): number => {
  const rows = Math.max(2, Math.ceil(held / 4));
  return Math.max(0, Math.min(12, rows * 4 - held));
};

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

  const drag = useSwipe(shell.act);

  return (
    <div
      id="menu"
      {...drag}
      className={cn(
        "n3-enter fixed inset-0 z-50 flex flex-col",
        shell.picking?.previewing ? "n3-peek" : "",
      )}
      style={{
        touchAction: "none",
        color: INK,
        background: PAPER,
        backgroundImage:
          "linear-gradient(rgba(255,255,255,.55) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.55) 1px, transparent 1px)",
        backgroundSize: "44px 44px",
      }}
    >
      <header className="flex items-baseline justify-center gap-6 px-8 pt-6 pb-2">
        <span className="text-[13px]" style={{ color: INK_SOFT }}>
          {category?.label ?? ""}
          {items[row]?.group ? <span className="opacity-70"> · {items[row].group}</span> : null}
        </span>
        <span className="font-mono text-[28px] tracking-tight" style={{ color: "#6b757d" }}>
          {clock}
        </span>
        <span className="text-[13px]" style={{ color: INK_SOFT }}>
          {footer}
        </span>
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
                  item.disabled && "opacity-70",
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
                  <span
                    className="relative max-w-full truncate text-[11px]"
                    style={{ color: INK_SOFT }}
                  >
                    {item.by}
                  </span>
                ) : null}
                {item.value ? (
                  <span className="relative font-mono text-[12px]" style={{ color: BLUE_INK }}>
                    {item.value}
                  </span>
                ) : null}
              </button>
            );
          })}
          {/* Les emplacements VIDES du tableau.
              Une chaîne qui n'existe pas laisse sa case, elle ne fait pas
              rétrécir le tableau: c'est ce qui distingue un tableau de chaînes
              d'une rangée de cartes qui flottent. Avec deux consoles, la grille
              se dessinait centrée sur deux cartes et ne ressemblait à rien.
              Ils ne sont ni cliquables ni comptés: la sélection indexe `items`,
              et ceux-ci viennent après. */}
          {Array.from({ length: EMPTY_SLOTS(items.length) }, (_, at) => (
            <span
              key={`vide-${at}`}
              aria-hidden="true"
              className="aspect-[4/3] rounded-[10px] border border-white/70 bg-black/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
            />
          ))}
        </div>
        {items[row]?.hint ? (
          <p className="mx-auto max-w-5xl pt-6 text-center text-[13px]" style={{ color: INK_SOFT }}>
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
                // Le liseré garde le bleu vif — un élément d'interface n'a
                // besoin que de 3:1 — mais le LIBELLÉ prend l'encre. Le même
                // bleu servait aux deux, et le texte tombait à 2,82:1.
                color: index === ray ? BLUE_INK : INK,
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
