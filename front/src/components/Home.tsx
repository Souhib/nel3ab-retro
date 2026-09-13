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
import { useShell, useSwipe } from "./shell";
import type { XmbCategory } from "./Xmb";

const INK = "#2b2b2b";
const TILE = "#3a3a3a";
const EDGE = "#4a4a4a";
const RED = "#e60012";

/**
 * L'opacité la plus basse à laquelle du texte reste lisible ici.
 *
 * Cinquante-sept pour cent, calculé sur le pire des deux fonds de cette coque:
 * `#f2f2f2` sur une vignette `#3a3a3a` donne 10,16:1 à plein, et 0,57 ramène ça
 * à 4,5:1. Sur le fond de l'écran (`#2b2b2b`) le plancher serait 0,51; on garde
 * le plus exigeant, parce que la même classe sert aux deux.
 *
 * Ce qui était écrit avant descendait à 0,30 pour une vignette désactivée et à
 * 0,35 pour la ligne d'aide. Mesuré le 31 août 2026.
 */
const DIM = "opacity-[0.57]";
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
  idle = false,
  footer,
  onPad,
  paused,
  who,
}: {
  categories: XmbCategory[];
  onClose: () => void;
  idle?: boolean;
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

  const drag = useSwipe(shell.act);

  return (
    <div
      id="menu"
      {...drag}
      className={cn(
        "n3-enter fixed inset-0 z-50 flex flex-col overflow-hidden",
        shell.picking?.previewing ? "n3-peek" : "",
      )}
      style={{ background: INK, color: "#f2f2f2", touchAction: "none" }}
    >
      <header className="flex items-center justify-between px-8 py-4">
        <span className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full text-fort font-semibold"
            style={{ background: RED, color: "#fff" }}
          >
            {who.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-fort">{who}</span>
        </span>
        <span className={cn("text-corps", DIM)}>{footer}</span>
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
                  // PAS d'opacité sur la tuile: elle entraîne tout ce qu'elle
                  // contient, y compris la pastille du nombre de jeux, dont le
                  // blanc sur rouge tient 4,80:1 à plein et tombe à 4,02:1 à
                  // 0,90. Une tuile non choisie se distingue par sa taille et
                  // son liseré, qui ne déteignent sur rien.
                  chosen ? "n3-breathe" : "",
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
                    console={item.game.console}
                    width={TILE_WIDTH}
                  />
                ) : (
                  <span className="flex flex-col items-center gap-4 px-4">
                    <span className="flex h-12 w-12 items-center justify-center [&>svg]:h-full [&>svg]:w-full">
                      {item.icon}
                    </span>
                    <span
                      className="text-center text-fort leading-snug"
                      style={{ color: item.disabled ? "#b4b4b4" : undefined }}
                    >
                      {item.label}
                    </span>
                  </span>
                )}
                {item.value ? (
                  <span
                    className="absolute top-1.5 right-1.5 rounded-full px-2 py-[2px] font-mono text-mini"
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
        {here?.group ? (
          <p className={cn("text-note uppercase tracking-[0.18em]", DIM)}>{here.group}</p>
        ) : null}
        <p className="max-w-[80%] truncate text-center text-large">{here?.label ?? ""}</p>
        {here?.by ? (
          <p className={cn("max-w-[70%] truncate text-center text-corps", DIM)}>{here.by}</p>
        ) : null}
        {/* La phrase que l'éditeur a écrite sur le disque. `pre-line` parce que
            ces textes ont été mis en page sur deux lignes et que la coupure est
            la leur. */}
        {here?.note ? (
          <p
            className="max-w-[60%] text-center text-corps opacity-60"
            style={{ whiteSpace: "pre-line" }}
          >
            {here.note}
          </p>
        ) : null}
        {here?.hint ? (
          <p className={cn("max-w-[70%] truncate text-center text-corps", DIM)}>{here.hint}</p>
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
              className="flex w-16 flex-col items-center gap-1.5 transition-all duration-150"
            >
              <span
                className="flex h-11 w-11 items-center justify-center rounded-full"
                style={{
                  background: index === ray ? "#f2f2f2" : "transparent",
                  color: index === ray ? INK : "#9a9a9a",
                  border: `1px solid ${index === ray ? "#f2f2f2" : EDGE}`,
                }}
              >
                <span className="flex h-6 w-6 [&>svg]:h-full [&>svg]:w-full">{choice.icon}</span>
              </span>
              {/* Le NOM sous la pastille. Quatre ronds muets demandent de survoler
                  pour savoir ce qu'ils ouvrent, ce qui ne marche ni à la manette ni
                  au doigt — c'est-à-dire dans les deux cas où cette coque sert.
                  L'infobulle `title` faisait ce travail et ne l'a jamais fait pour
                  personne. */}
              <span
                className="max-w-full truncate text-note"
                style={{ color: index === ray ? "#f2f2f2" : "#9a9a9a" }}
              >
                {choice.label}
              </span>
            </button>
          ))}
        </span>

        <span className="flex items-center gap-5 text-corps opacity-70">
          <Pip letter="A" what="choisir" />
          <span id="closeMenu" onClick={onClose} className="cursor-pointer">
            <Pip letter="B" what={idle ? "fermer" : "reprendre"} />
          </span>
        </span>
      </footer>

      <Picker
        picking={shell.picking}
        costume={{
          panel: TILE,
          ink: "#f2f2f2",
          edge: EDGE,
          accent: RED,
          // RED tient 2,37:1 sur la tuile: illisible en lettres. Ces deux
          // encres tiennent 5,99:1 et 5,49:1, mesurées le 12 septembre 2026.
          accentInk: "#fca5a5",
          dim: "#b4b4b4",
        }}
      />
    </div>
  );
}

/** Une pastille de bouton, comme la console en dessine en bas de ses écrans. */
function Pip({ letter, what }: { letter: string; what: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full border text-note"
        style={{ borderColor: "#9a9a9a" }}
      >
        {letter}
      </span>
      {what}
    </span>
  );
}
