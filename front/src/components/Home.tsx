/**
 * L'écran d'accueil de la Switch.
 *
 * # Ce qui le rend reconnaissable
 *
 * **La tuile centrée.** Une file de grands carrés, celui qu'on pointe au MÊME
 * endroit toujours: c'est la file qui coulisse dessous. Il est plus grand que
 * les autres et porte un liseré blanc qui respire.
 *
 * **Le titre en dessous.** Le nom de ce qu'on pointe s'écrit en grand sous la
 * file, pas dans la tuile. C'est ce qui permet aux tuiles d'être des carrés
 * presque vides et à l'écran de rester calme.
 *
 * **Les deux barres.** En haut, qui joue, à gauche, dans un rond de couleur. En
 * bas, une rangée de petits ronds pour les rayons, et les pastilles A et B.
 *
 * Les couleurs sont celles de la console et ne suivent pas le thème.
 */
import { useEffect } from "react";
import { cn } from "../lib/cn";
import type { MenuAction } from "../media/menupad";
import { Art } from "./Art";
import { Picker } from "./Picker";
import { useShell } from "./shell";
import type { XmbCategory } from "./Xmb";

const INK = "#2b2b2b";
const TILE = "#3a3a3a";
const EDGE = "#4a4a4a";
const RED = "#e60012";
/** Largeur d'une tuile et de l'espace entre deux, en pixels: la file coulisse
 * d'un pas exact pour que la tuile choisie reste à la même place.
 *
 * La hauteur n'est pas ici: elle vient de la jaquette, qui fait trois de large
 * pour un de haut. C'est ce qui remplace le carré. */
const TILE_WIDTH = 336;
const TILE_HEIGHT = TILE_WIDTH / 3;
const GAP = 22;

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
  // entrées. L'échange se fait dans la mécanique partagée pour que le clavier et
  // la manette le voient pareil.
  const shell = useShell(categories, 1, onClose, paused, true);
  const { items, ray, row } = shell;
  const here = items[row];

  useEffect(() => {
    onPad?.(shell.act);
    return () => onPad?.(null);
  });

  return (
    <div
      id="menu"
      className="n3-enter fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{ background: INK, color: "#f2f2f2" }}
    >
      <header className="flex items-center justify-between px-8 py-4">
        <span className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full text-[15px] font-semibold"
            style={{ background: RED, color: "#fff" }}
          >
            {who.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-[14px]">{who}</span>
        </span>
        <span className="text-[12px] opacity-45">{footer}</span>
      </header>

      {/* La file. Elle coulisse pour que la tuile choisie reste au même endroit,
          à un tiers de la largeur. */}
      <div className="relative flex min-h-0 flex-1 items-center overflow-hidden">
        <div
          className="flex items-center transition-transform duration-300 ease-out"
          style={{
            paddingLeft: "33%",
            gap: GAP,
            transform: `translateX(${-row * (TILE_WIDTH + GAP)}px)`,
          }}
        >
          {items.map((item, index) => {
            const chosen = index === row;
            return (
              <button
                key={item.id}
                type="button"
                id={`item-${item.id}`}
                data-selected={chosen}
                disabled={item.disabled}
                onMouseEnter={() => shell.point(index)}
                onClick={() => shell.choose(index)}
                className={cn(
                  "relative flex shrink-0 flex-col items-center justify-center gap-3 rounded-[10px] transition-all duration-300 ease-out",
                  chosen ? "n3-breathe" : "opacity-90",
                  item.disabled && "opacity-30",
                )}
                style={{
                  width: TILE_WIDTH,
                  height: TILE_HEIGHT,
                  background: TILE,
                  overflow: "hidden",
                  border: `2px solid ${chosen ? "#f2f2f2" : EDGE}`,
                  transform: chosen ? "scale(1.16)" : "scale(1)",
                  boxShadow: chosen ? "0 0 0 4px rgba(242,242,242,.18)" : "none",
                }}
              >
                {item.game ? (
                  <Art
                    index={item.game.index}
                    name={item.label}
                    has={item.game.art}
                    width={TILE_WIDTH}
                  />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center opacity-60 [&>svg]:h-full [&>svg]:w-full">
                    {item.icon}
                  </span>
                )}
                {item.value ? (
                  <span
                    className="absolute top-1.5 right-1.5 rounded-full px-2 py-[2px] font-mono text-[10px]"
                    style={{ background: RED, color: "#fff" }}
                  >
                    {item.value}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Le nom de ce qu'on pointe, en grand, sous la file. */}
      <div className="flex min-h-[132px] flex-col items-center justify-center gap-1 px-8">
        <p className="max-w-[80%] truncate text-center text-[22px]">{here?.label ?? ""}</p>
        {here?.by ? (
          <p className="max-w-[70%] truncate text-center text-[13px] opacity-45">{here.by}</p>
        ) : null}
        {/* La phrase que l'éditeur a écrite sur le disque. `pre-line` parce que
            ces textes ont été mis en page sur deux lignes et que la coupure est
            la leur. */}
        {here?.note ? (
          <p
            className="max-w-[60%] text-center text-[13px] opacity-60"
            style={{ whiteSpace: "pre-line" }}
          >
            {here.note}
          </p>
        ) : null}
        {here?.hint ? (
          <p className="max-w-[70%] truncate text-center text-[12px] opacity-35">{here.hint}</p>
        ) : null}
      </div>

      <footer
        className="flex items-center justify-between px-8 py-4"
        style={{ borderTop: `1px solid ${EDGE}` }}
      >
        <span className="flex items-center gap-3">
          {categories.map((choice, index) => (
            <button
              key={choice.id}
              type="button"
              id={`ray-${choice.id}`}
              data-selected={index === ray}
              onClick={() => shell.goTo(index)}
              title={choice.label}
              className="flex h-11 w-11 items-center justify-center rounded-full transition-all duration-150"
              style={{
                background: index === ray ? "#f2f2f2" : "transparent",
                color: index === ray ? INK : "#9a9a9a",
                border: `1px solid ${index === ray ? "#f2f2f2" : EDGE}`,
              }}
            >
              <span className="flex h-6 w-6 [&>svg]:h-full [&>svg]:w-full">{choice.icon}</span>
            </button>
          ))}
        </span>

        <span className="flex items-center gap-5 text-[12px] opacity-70">
          <Pip letter="A" what="choisir" />
          <span id="closeMenu" onClick={onClose} className="cursor-pointer">
            <Pip letter="B" what="reprendre" />
          </span>
        </span>
      </footer>

      <Picker
        picking={shell.picking}
        costume={{ panel: TILE, ink: "#f2f2f2", edge: EDGE, accent: RED }}
      />
    </div>
  );
}

/** Une pastille de bouton, comme la console en dessine en bas de ses écrans. */
function Pip({ letter, what }: { letter: string; what: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full border text-[11px]"
        style={{ borderColor: "#9a9a9a" }}
      >
        {letter}
      </span>
      {what}
    </span>
  );
}
