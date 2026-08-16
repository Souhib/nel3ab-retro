/**
 * Le tableau de bord de la Xbox 360, en lames.
 *
 * # Ce qui le rend reconnaissable
 *
 * Trois choses, et il en manquait trois à la première version.
 *
 * **Le fond**: un dégradé vert sombre vers le noir, pas un aplat. C'est ce qui
 * donne sa profondeur à l'écran et fait ressortir les lames.
 *
 * **Le vernis**: chaque lame est un panneau translucide avec une lumière en
 * haut qui s'éteint vers le bas. Sans ça, une lame est un rectangle de couleur.
 *
 * **Le glissement**: on ne saute pas d'une lame à l'autre, elles coulissent. Les
 * lames fermées restent visibles sur les côtés, réduites à leur tranche avec
 * leur icône, et c'est ce qui donne l'impression d'un classeur qu'on feuillette.
 *
 * La ligne choisie est une **barre claire arrondie** qui glisse elle aussi,
 * plutôt qu'un fond qui s'allume d'un coup. Elle est dessinée sous les lignes et
 * suit l'index: une seule chose qui bouge, donc un seul mouvement à regarder.
 *
 * Les couleurs sont celles de la console et ne suivent pas le thème: un tableau
 * de bord de Xbox en vert Game Boy ne serait plus un tableau de bord de Xbox.
 */
import { useEffect } from "react";
import { cn } from "../lib/cn";
import type { MenuAction } from "../media/menupad";
import { Art } from "./Art";
import { useShell } from "./shell";
import type { XmbCategory } from "./Xmb";

/** Le vert du tableau de bord, et les couleurs que les lames portaient. */
const GREEN = "#5dc21e";
const BLADES = ["#4fa81a", "#d98c14", "#2076b8", "#8c3fa8"];
/** Largeur d'une lame fermée, en pixels. Assez pour son icône, pas plus. */
const SPINE = 74;
/** Hauteur d'une ligne, en pixels: la barre qui glisse s'en sert aussi. */
const ROW = 56;

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

  useEffect(() => {
    onPad?.(shell.act);
    return () => onPad?.(null);
  });

  return (
    <div
      id="menu"
      className="n3-enter fixed inset-0 z-50 overflow-hidden"
      style={{
        background: `radial-gradient(120% 90% at 20% 0%, #16330a 0%, #0a1505 45%, #050805 100%)`,
        color: "#eef2ea",
      }}
    >
      <div className="flex h-full">
        {categories.map((choice, index) => {
          const open = index === ray;
          const shade = BLADES[index % BLADES.length] ?? GREEN;
          return (
            <button
              key={choice.id}
              type="button"
              id={open ? `ray-open-${choice.id}` : `ray-${choice.id}`}
              data-selected={open}
              onClick={() => shell.goTo(index)}
              className={cn(
                "relative flex shrink-0 flex-col overflow-hidden text-left",
                // La largeur est ce qui coulisse. Quatre éléments seulement, donc
                // une transition de largeur coûte moins qu'une pile de calques.
                "transition-all duration-300 ease-out",
              )}
              style={{
                width: open ? `calc(100% - ${SPINE * (categories.length - 1)}px)` : SPINE,
                background: open
                  ? `linear-gradient(180deg, ${shade}f2 0%, ${shade}c8 12%, #12180f 12.5%, #0d120b 100%)`
                  : `linear-gradient(180deg, ${shade}ee, ${shade}96)`,
                borderRight: index < categories.length - 1 ? "1px solid rgba(0,0,0,.45)" : "none",
                boxShadow: open ? "0 0 40px rgba(0,0,0,.6)" : "inset -8px 0 18px rgba(0,0,0,.28)",
              }}
            >
              {/* Le vernis: une lumière en haut qui s'éteint. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-1/2"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,.22) 0%, rgba(255,255,255,0) 100%)",
                }}
              />

              {open ? (
                <>
                  <header className="relative flex items-baseline justify-between px-8 pt-5 pb-4">
                    <h1 className="text-[26px] font-light uppercase tracking-[0.12em] text-black/80">
                      {category?.label ?? ""}
                    </h1>
                    <span className="text-[12px] text-black/50">{footer}</span>
                  </header>

                  <div className="relative min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-16">
                    <div className="relative" style={{ height: items.length * ROW }}>
                      {/* La barre qui glisse, sous les lignes. */}
                      <span
                        aria-hidden="true"
                        className="absolute left-0 right-0 rounded-full transition-transform duration-200 ease-out"
                        style={{
                          height: ROW - 8,
                          top: 4,
                          transform: `translateY(${row * ROW}px)`,
                          background:
                            "linear-gradient(180deg, rgba(255,255,255,.96), rgba(226,232,222,.88))",
                          boxShadow: "0 2px 10px rgba(0,0,0,.45)",
                        }}
                      />
                      {items.map((item, place) => {
                        const here = place === row;
                        return (
                          <span
                            key={item.id}
                            id={`item-${item.id}`}
                            data-selected={here}
                            onMouseEnter={() => shell.point(place)}
                            onClick={(event) => {
                              event.stopPropagation();
                              shell.choose(place);
                            }}
                            className={cn(
                              "absolute inset-x-0 flex cursor-pointer items-center gap-4 px-5",
                              item.disabled && "opacity-40",
                            )}
                            style={{ top: place * ROW, height: ROW }}
                          >
                            {item.game ? (
                              <Art
                                index={item.game.index}
                                name={item.label}
                                has={item.game.art}
                                width={78}
                              />
                            ) : (
                              <span
                                className="flex h-7 w-7 shrink-0 [&>svg]:h-full [&>svg]:w-full"
                                style={{
                                  color: here ? "#1c2418" : "#cfd8c9",
                                  opacity: here ? 0.8 : 0.6,
                                }}
                              >
                                {item.icon}
                              </span>
                            )}
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span
                                className="truncate text-[17px] font-light"
                                style={{ color: here ? "#141a12" : "#e6ece2" }}
                              >
                                {item.label}
                              </span>
                              {here && item.hint ? (
                                <span className="truncate text-[12px] text-black/55">
                                  {item.hint}
                                </span>
                              ) : null}
                            </span>
                            {/* Le studio à droite, comme le tableau de bord
                                mettait ses détails: la ligne porte alors deux
                                informations sans que le titre ait à les dire. */}
                            {(item.value ?? item.by) ? (
                              <span
                                className="shrink-0 truncate pl-4 font-mono text-[12px]"
                                style={{
                                  color: here ? shade : "#9aa694",
                                  maxWidth: "34%",
                                }}
                              >
                                {item.value ?? item.by}
                              </span>
                            ) : null}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  <footer className="absolute inset-x-0 bottom-0 flex items-center justify-between px-8 py-4 text-[12px] text-white/50">
                    <span>← → lame · ↑ ↓ ligne</span>
                    <span className="flex items-center gap-4">
                      <Button letter="A" colour="#7ec850" what="choisir" />
                      <span
                        id="closeMenu"
                        onClick={(event) => {
                          event.stopPropagation();
                          onClose();
                        }}
                        className="cursor-pointer"
                      >
                        <Button letter="B" colour="#d24b3e" what="reprendre" />
                      </span>
                    </span>
                  </footer>
                </>
              ) : (
                <span className="relative flex flex-1 flex-col items-center justify-center gap-4">
                  <span className="flex h-8 w-8 text-black/65 [&>svg]:h-full [&>svg]:w-full">
                    {choice.icon}
                  </span>
                  <span
                    className="text-[11px] uppercase tracking-[0.24em] text-black/55"
                    style={{ writingMode: "vertical-rl" }}
                  >
                    {choice.label}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Une pastille de bouton, comme la console en dessine en bas de ses écrans. */
function Button({ letter, colour, what }: { letter: string; colour: string; what: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold text-black/80"
        style={{ background: colour }}
      >
        {letter}
      </span>
      {what}
    </span>
  );
}
