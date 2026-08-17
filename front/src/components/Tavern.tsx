/**
 * La taverne: un menu de jeu, dans l'esprit de celui de Hearthstone.
 *
 * # Ce qu'on reprend, et ce qu'on ne peut pas reprendre
 *
 * Rien de Blizzard n'est ici. Tout est dessiné: le bois est une pile de
 * dégradés, le grain est un motif SVG, les ferrures et les volutes sont des
 * tracés. Ce qu'on reprend est ce qui se décrit et se redessine — la MATIÈRE et
 * le MOUVEMENT — pas les images.
 *
 * Quatre choses font qu'on reconnaît ce genre de menu, et aucune n'est le
 * dessin:
 *
 * **Ce sont des objets, pas des lignes.** Chaque entrée est une plaque de bois
 * biseautée, avec une lumière en haut et une ombre en bas. On croit pouvoir la
 * pousser.
 *
 * **Le ressort.** La plaque choisie grossit en DÉPASSANT sa taille puis revient.
 * C'est une courbe d'accélération, `cubic-bezier(.34, 1.56, .64, 1)`, et c'est la
 * moitié de ce qui fait qu'un menu de jeu ne se sent pas comme une liste.
 *
 * **La lumière hésite.** Une bougie ne pulse pas régulièrement. Trois paliers
 * inégaux plutôt qu'une sinusoïde, sinon la pièce respire comme une machine.
 *
 * **Les braises montent.** Une trentaine de points qui s'élèvent et s'éteignent,
 * chacun avec son délai et sa dérive. Sans elles la pièce est un décor; avec
 * elles, elle est allumée.
 *
 * # Les règles du projet, et où on est
 *
 * Les dégradés et les animations sont interdits ailleurs parce qu'ils tirent
 * l'oeil hors de l'image du jeu. Sur un menu il n'y a pas d'image: on a quitté la
 * partie pour venir lire une liste, donc la raison ne s'applique pas et la règle
 * non plus. C'est la même exception que le fond du XMB.
 *
 * Deux garde-fous quand même. Seuls `transform` et `opacity` sont animés, les
 * deux propriétés que le compositeur traite sans repasser par la mise en page:
 * trente braises ne peuvent donc pas voler de temps à la boucle d'images. Et
 * `prefers-reduced-motion` coupe l'ensemble, ressort compris.
 *
 * Les couleurs sont celles de la taverne et ne suivent pas le thème: un menu est
 * un costume (voir 7.26).
 */
import { useEffect, useRef } from "react";
import { cn } from "../lib/cn";
import type { MenuAction } from "../media/menupad";
import { Art } from "./Art";
import { Picker } from "./Picker";
import { useShell } from "./shell";
import type { XmbCategory } from "./Xmb";

const WOOD_DARK = "#20120a";
const WOOD = "#3b2415";
const GOLD = "#d9a94c";
const GOLD_LIT = "#f6dc9c";
const GOLD_DARK = "#7c5716";
const PARCHMENT = "#ecd9b0";
const EMBER = "#ff9c3d";

/** Combien de braises. Trente: en dessous on compte les points, au-dessus la
 * pièce a l'air d'être en feu. */
const EMBERS = 30;

export function Tavern({
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
  const { items, ray, row } = shell;
  const column = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onPad?.(shell.act);
    return () => onPad?.(null);
  });

  /* Le panneau suit le curseur.
   *
   * Sans ça, une liste plus longue que l'écran laisse ses dernières entrées hors
   * de portée POUR TOUJOURS: la flèche bas continue de désigner, mais rien ne se
   * voit bouger, et il n'y a aucune erreur pour le dire. Trouvé par le pilote,
   * sur un écran de 720 pixels de haut où « plein écran » était la onzième
   * entrée des réglages. */
  useEffect(() => {
    column.current?.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView({
      block: "nearest",
    });
  }, [row, ray]);

  return (
    <div
      id="menu"
      className="n3-enter fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{
        color: PARCHMENT,
        background: [
          // Le halo de la pièce, chaud et haut.
          `radial-gradient(70% 55% at 50% 12%, rgba(255,170,80,.16) 0%, transparent 68%)`,
          // La vignette: sans elle, un fond de bois est un aplat marron et rien
          // ne semble éclairé.
          `radial-gradient(120% 95% at 50% 42%, transparent 30%, rgba(0,0,0,.55) 100%)`,
          `linear-gradient(180deg, #3a2314 0%, ${WOOD_DARK} 55%, #0e0804 100%)`,
        ].join(", "),
      }}
    >
      <Grain />
      <Candle />
      <Embers />
      <Filigree corner="tl" />
      <Filigree corner="tr" />
      <Filigree corner="bl" />
      <Filigree corner="br" />

      {/* La poutre et ses enseignes suspendues: les rayons. */}
      <header className="relative z-10 flex flex-col items-center pt-5">
        {/* La poutre. Une planche avec sa tranche éclairée, et non un trait:
            une enseigne doit pendre de quelque chose. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[52px]"
          style={{
            background: `linear-gradient(180deg, #4d3018 0%, #2a1809 88%, #150c05 100%)`,
            borderBottom: `2px solid ${GOLD_DARK}`,
            boxShadow: "inset 0 1px 0 rgba(255,220,160,.18), 0 6px 18px rgba(0,0,0,.55)",
          }}
        />
        <div className="flex items-start gap-3">
          {categories.map((choice, index) => (
            <Sign
              key={choice.id}
              id={`ray-${choice.id}`}
              lit={index === ray}
              onClick={() => shell.goTo(index)}
              icon={choice.icon}
              label={choice.label}
            />
          ))}
        </div>
      </header>

      {/* Les plaques, posées DANS un creux.
          Sans lui, la colonne flotte au milieu d'un aplat de bois: c'est le
          panneau enfoncé qui donne au fond son épaisseur, parce qu'il y a
          maintenant un dedans et un dehors. */}
      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-6 py-3">
        <div
          className="relative flex max-h-full w-full max-w-[640px] flex-col rounded-[14px] p-4"
          style={{
            background: `linear-gradient(180deg, rgba(12,7,3,.62) 0%, rgba(30,18,9,.5) 100%)`,
            border: `2px solid ${GOLD_DARK}`,
            outline: "1px solid rgba(0,0,0,.6)",
            boxShadow: [
              "inset 0 4px 14px rgba(0,0,0,.65)",
              "inset 0 -1px 0 rgba(255,220,160,.12)",
              "0 2px 0 rgba(255,220,160,.08)",
            ].join(", "),
          }}
        >
          <div ref={column} className="flex max-h-full flex-col gap-3 overflow-y-auto px-1 py-1">
            {items.map((item, index) => (
              <Plaque
                key={item.id}
                item={item}
                here={index === row}
                onPoint={() => shell.point(index)}
                onChoose={() => shell.choose(index)}
              />
            ))}
            {items.length === 0 ? (
              <p className="py-8 text-center text-[13px] opacity-50">rien ici</p>
            ) : null}
          </div>
        </div>
      </div>

      <footer className="relative z-10 flex items-center justify-between px-8 pt-1 pb-5 text-[12px]">
        <span style={{ color: GOLD_DARK }}>{footer}</span>
        <span className="flex items-center gap-4">
          <Gem letter="A" what="choisir" tone={GOLD_LIT} />
          <button type="button" id="closeMenu" onClick={onClose}>
            <Gem letter="B" what="reprendre" tone="#c9743f" />
          </button>
        </span>
      </footer>

      <Picker
        picking={shell.picking}
        costume={{
          panel: WOOD,
          ink: PARCHMENT,
          edge: GOLD_DARK,
          accent: GOLD_LIT,
          veil: "rgba(12,7,3,.66)",
        }}
      />
    </div>
  );
}

/** Une enseigne suspendue: un rayon. */
function Sign({
  id,
  lit,
  onClick,
  icon,
  label,
}: {
  id: string;
  lit: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      id={id}
      data-selected={lit}
      onClick={onClick}
      className={cn(
        "n3-spring flex flex-col items-center gap-1 rounded-b-[10px] rounded-t-[4px] px-4 pt-2.5 pb-2",
        // L'enseigne choisie DESCEND d'un cheveu, comme si on l'avait poussée.
        lit ? "translate-y-[3px] scale-[1.06]" : "opacity-70",
      )}
      style={{
        background: lit
          ? `linear-gradient(180deg, #6a4322 0%, ${WOOD} 100%)`
          : `linear-gradient(180deg, #452b18 0%, #2c1a0e 100%)`,
        border: `1px solid ${lit ? GOLD : GOLD_DARK}`,
        boxShadow: lit
          ? `0 6px 18px rgba(0,0,0,.5), 0 0 22px rgba(217,169,76,.28), inset 0 1px 0 rgba(255,222,160,.25)`
          : "0 3px 10px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,222,160,.08)",
        color: lit ? GOLD_LIT : PARCHMENT,
      }}
    >
      <span className="flex h-6 w-6 [&>svg]:h-full [&>svg]:w-full">{icon}</span>
      <span
        className="text-[11px] uppercase tracking-[0.14em]"
        style={{ textShadow: "0 1px 0 rgba(0,0,0,.8)" }}
      >
        {label}
      </span>
    </button>
  );
}

/** Une plaque de bois: une entrée. */
function Plaque({
  item,
  here,
  onPoint,
  onChoose,
}: {
  item: XmbCategory["items"][number];
  here: boolean;
  onPoint: () => void;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      id={`item-${item.id}`}
      data-selected={here}
      disabled={item.disabled}
      onMouseMove={onPoint}
      onClick={onChoose}
      className={cn(
        "n3-spring relative flex shrink-0 items-center gap-3 rounded-[9px] px-3 py-2.5 text-left",
        here && "scale-[1.045]",
        // Pas `opacity`: une plaque de bois à moitié transparente disparaît dans
        // le bois du fond. Une entrée indisponible reste une plaque, en plus
        // sombre, ce qui se lit comme « éteinte » et non comme « absente ».
        item.disabled && "saturate-[.55] brightness-[.72]",
      )}
      style={{
        background: here
          ? `linear-gradient(180deg, #9a6531 0%, #7a4b22 42%, #4b2c13 100%)`
          : `linear-gradient(180deg, #6b431f 0%, #543314 45%, #331e0d 100%)`,
        // Deux traits et non un: un liseré d'or sur un cadre sombre, ce qui est
        // ce qui donne son épaisseur à une ferrure. Un seul trait reste plat.
        border: `2px solid ${here ? GOLD_LIT : GOLD_DARK}`,
        outline: `1px solid rgba(0,0,0,.55)`,
        boxShadow: here
          ? [
              "0 10px 26px rgba(0,0,0,.6)",
              "0 0 30px rgba(255,180,80,.3)",
              "inset 0 2px 0 rgba(255,235,190,.42)",
              "inset 0 -3px 10px rgba(0,0,0,.45)",
            ].join(", ")
          : [
              "0 5px 14px rgba(0,0,0,.55)",
              "inset 0 2px 0 rgba(255,225,170,.2)",
              "inset 0 -3px 10px rgba(0,0,0,.4)",
            ].join(", "),
      }}
    >
      {/* Le sceau: l'icône dans un rond de laiton, ou la jaquette pour un jeu. */}
      {item.game ? (
        <Art
          index={item.game.index}
          name={item.label}
          has={item.game.art}
          width={96}
          className="shrink-0 rounded-[4px]"
          // Le liseré de laiton autour de la jaquette: sans lui, une image posée
          // sur du bois a l'air collée dessus plutôt qu'encadrée.
        />
      ) : (
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full [&>svg]:h-6 [&>svg]:w-6"
          style={{
            background: `radial-gradient(circle at 34% 28%, #c99a4e 0%, #7a5320 45%, #2a1a0a 100%)`,
            border: `2px solid ${here ? GOLD_LIT : GOLD_DARK}`,
            color: here ? "#2a1806" : "#f0dcb4",
            boxShadow: "inset 0 2px 4px rgba(255,235,190,.3), 0 2px 6px rgba(0,0,0,.5)",
          }}
        >
          {item.icon}
        </span>
      )}

      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className="truncate text-[15px]"
          style={{
            color: here ? GOLD_LIT : PARCHMENT,
            // Gravé: une ombre en dessous, une lumière au-dessus. C'est ce qui
            // fait que le texte est DANS le bois et pas posé sur lui.
            textShadow: "0 1px 0 rgba(0,0,0,.85), 0 -1px 0 rgba(255,215,150,.14)",
          }}
        >
          {item.label}
        </span>
        {item.by ? <span className="truncate text-[11px] opacity-55">{item.by}</span> : null}
        {here && item.hint ? (
          <span className="truncate text-[11px] opacity-65">{item.hint}</span>
        ) : null}
      </span>

      {item.value ? (
        <span className="shrink-0 font-mono text-[12px]" style={{ color: here ? GOLD_LIT : GOLD }}>
          {item.value}
        </span>
      ) : null}
    </button>
  );
}

/** Le grain du bois: un motif SVG, répété, très discret.
 *
 * Un motif et non une image: quelques courbes suffisent à casser l'aplat d'un
 * dégradé, et c'est ce qui distingue une planche d'un rectangle marron. */
function Grain() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.14]"
      aria-hidden="true"
    >
      <defs>
        <pattern id="n3-grain" width="180" height="46" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="#000" strokeWidth="1.1">
            <path d="M0 8c40-6 80 6 120 0s50-4 60 2" />
            <path d="M0 21c50 5 70-6 110-2s60 4 70 0" />
            <path d="M0 33c30-5 60 4 100 1s60 3 80-2" />
            <path d="M0 43c60 3 100-4 180 1" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#n3-grain)" />
    </svg>
  );
}

/** La lumière de la pièce, qui hésite. */
function Candle() {
  return (
    <span
      aria-hidden="true"
      className="n3-candle pointer-events-none absolute inset-0"
      style={{
        background: `radial-gradient(60% 45% at 50% 2%, rgba(255,178,90,.32) 0%, transparent 70%)`,
      }}
    />
  );
}

/** Les braises.
 *
 * Position, délai, durée et dérive tirés d'une suite FIXE et non au hasard: un
 * rendu de React qui retirerait le hasard remettrait toutes les braises au
 * départ en même temps, ce qui se voit immédiatement. Une suite déterministe
 * garde chaque braise à sa place d'un rendu à l'autre.
 */
function Embers() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: EMBERS }, (_, at) => {
        const spread = (at * 37) % 100;
        const delay = ((at * 13) % 70) / 10;
        const life = 5.5 + ((at * 7) % 40) / 10;
        const drift = ((at * 23) % 60) - 30;
        const size = 2 + ((at * 11) % 4);
        return (
          <span
            key={at}
            className="n3-ember absolute rounded-full"
            style={{
              left: `${spread}%`,
              bottom: `-${4 + (at % 5)}%`,
              width: size,
              height: size,
              background: EMBER,
              boxShadow: `0 0 ${size * 4}px ${EMBER}`,
              animationDelay: `${delay}s`,
              animationDuration: `${life}s`,
              ["--drift" as string]: `${drift}px`,
            }}
          />
        );
      })}
    </span>
  );
}

/** Une volute de laiton dans un coin. */
function Filigree({ corner }: { corner: "tl" | "tr" | "bl" | "br" }) {
  const flip = corner === "tr" || corner === "br" ? "scaleX(-1)" : "";
  const upend = corner === "bl" || corner === "br" ? "scaleY(-1)" : "";
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 120 120"
      className={cn(
        "pointer-events-none absolute h-32 w-32 opacity-55",
        corner.includes("t") ? "top-0" : "bottom-0",
        corner.includes("l") ? "left-0" : "right-0",
      )}
      style={{ transform: `${flip} ${upend}`.trim() || undefined }}
      fill="none"
      stroke={GOLD_DARK}
      strokeWidth="2"
    >
      {/* Un quart de cadre, puis l'enroulement qui le termine. Les boucles
          d'avant se lisaient comme des gribouillis: une volute a une direction. */}
      <path d="M2 2h58M2 2v58" strokeWidth="3" strokeLinecap="round" />
      <path d="M12 12h34a6 6 0 0 1 6 6v22" strokeLinecap="round" />
      <path d="M12 12v34a6 6 0 0 0 6 6h22" strokeLinecap="round" />
      <path
        d="M52 40c0 7 5 11 11 9s5-11-2-12-9 6-4 10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M40 52c7 0 11 5 9 11s-11 5-12-2 6-9 10-4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="4" fill={GOLD} stroke="none" />
      <circle cx="70" cy="70" r="2.5" fill={GOLD} stroke="none" />
    </svg>
  );
}

/** Une pastille de bouton, taillée comme une gemme. */
function Gem({ letter, what, tone }: { letter: string; what: string; tone: string }) {
  return (
    <span className="flex items-center gap-2" style={{ color: PARCHMENT }}>
      <span
        className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-semibold"
        style={{
          background: `radial-gradient(circle at 35% 30%, ${tone}, rgba(0,0,0,.6))`,
          border: `1px solid ${GOLD_DARK}`,
          color: "#241206",
          boxShadow: `0 0 10px ${tone}55`,
        }}
      >
        {letter}
      </span>
      {what}
    </span>
  );
}
