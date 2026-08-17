/**
 * L'auberge de Hearthstone: la boîte bleue, l'or, et le tourbillon.
 *
 * # Ce qu'on reprend, et ce qu'on ne peut pas reprendre
 *
 * Rien de Blizzard n'est ici, comme pour la taverne: tout est dessiné. Le bois
 * est une pile de dégradés, le tourbillon est trois arcs SVG, les ferrures sont
 * des tracés. Ce qu'on reprend est ce qui se décrit et se redessine — la
 * MATIÈRE et le MOUVEMENT — pas les images. Cinq choses font qu'on reconnaît ce
 * menu avant d'y lire quoi que ce soit, et aucune n'est un dessin:
 *
 * **Le bois est BLEU.** Une taverne générique est brune; la boîte de
 * Hearthstone est en bois teinté nuit, cerclé de laiton. C'est cette teinte,
 * plus que tout le reste, qui la distingue de la taverne d'à côté.
 *
 * **Le tourbillon d'arcane.** Au fronton tourne lentement un vortex bleu,
 * l'endroit où le logo est vissé dans le vrai. Trois arcs en tire-bouchon qui
 * ne tournent pas à la même vitesse: un seul anneau ferait horloge, trois font
 * portail.
 *
 * **Les boutons penchent.** Posés comme des plaques sur une table, chacun a un
 * léger angle, fixe et déterministe. Choisie, la plaque se REDRESSE et se
 * soulève, cerclée d'azur: c'est le redressement, plus que le grossissement,
 * qui la donne l'air d'avoir été prise en main.
 *
 * **La poussière d'arcane, pas des braises.** Des poussières bleues et or qui
 * montent en dérivant et SCINTILLENT — deux paliers d'opacité au lieu de
 * s'éteindre en ligne droite. La braise meurt en montant; la poussière
 * d'arcane, elle, clignote.
 *
 * **La lumière est froide.** La taverne est éclairée d'une bougie; ici la
 * lumière vient du tourbillon. Le halo est azur, il respire plus lentement, et
 * il ne flambe jamais.
 *
 * # Les règles du projet, et où on est
 *
 * Même exception que la taverne: les dégradés et les animations sont interdits
 * ailleurs parce qu'ils tirent l'oeil hors de l'image du jeu, et un menu n'a
 * pas d'image derrière lui. Mêmes garde-fous: seuls `transform` et `opacity`
 * sont animés — une rotation lente et vingt-six poussières ne peuvent pas voler
 * de temps à la boucle d'images — et `prefers-reduced-motion` coupe tout,
 * ressort compris. Les couleurs sont celles de la boîte et ne suivent pas le
 * thème: un menu est un costume (voir 7.26).
 */
import { useEffect, useRef } from "react";
import { cn } from "../lib/cn";
import type { MenuAction } from "../media/menupad";
import { Art } from "./Art";
import { Picker } from "./Picker";
import { useShell } from "./shell";
import type { XmbCategory } from "./Xmb";

const NIGHT = "#070c16";
const WOOD_DARK = "#101c33";
const WOOD = "#1d2f52";
const WOOD_LIT = "#2c4472";
const AZURE = "#6fd3ff";
const AZURE_DEEP = "#2f7fd0";
const GOLD = "#d9a94c";
const GOLD_LIT = "#f6dc9c";
const BRASS = "#8a6a2e";
const PARCHMENT = "#f2e8c9";

/** Combien de poussières. Vingt-six: le tourbillon attire l'oeil au centre, la
 * pièce n'a pas besoin d'en porter trente comme la taverne. */
const MOTES = 26;

export function Hearthstone({
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

  /* Le panneau suit le curseur, pour la même raison que dans la taverne: une
   * liste plus longue que l'écran laisserait sinon ses dernières entrées hors
   * de portée pour toujours, sans aucune erreur pour le dire. */
  useEffect(() => {
    column.current?.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView({
      block: "nearest",
    });
  }, [row, ray]);

  return (
    <div
      id="menu"
      className={cn(
        "n3-enter fixed inset-0 z-50 flex flex-col overflow-hidden",
        shell.picking?.previewing ? "n3-peek" : "",
      )}
      style={{
        color: PARCHMENT,
        background: [
          // Le halo du tourbillon, froid et haut. C'est lui la source de
          // lumière de la pièce, pas une bougie.
          `radial-gradient(60% 50% at 50% 0%, rgba(111,211,255,.17) 0%, transparent 68%)`,
          // La vignette, plus marquée que dans la taverne: la boîte bleue
          // s'enfonce dans la nuit là où le bois brun restait lisible.
          `radial-gradient(120% 95% at 50% 42%, transparent 28%, rgba(2,5,12,.62) 100%)`,
          `linear-gradient(180deg, #16233f 0%, ${WOOD_DARK} 55%, ${NIGHT} 100%)`,
        ].join(", "),
      }}
    >
      <Grain />
      <Glow />
      <Motes />
      <Plate corner="tl" />
      <Plate corner="tr" />
      <Plate corner="bl" />
      <Plate corner="br" />

      {/* Le fronton: le tourbillon au centre, les onglets en dessous. */}
      <header className="relative z-10 flex flex-col items-center gap-2 pt-4">
        {/* Le couvercle de la boîte: une planche de bois bleu dont la tranche
            du bas est le filet de laiton sur lequel les onglets prennent
            appui. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[46px]"
          style={{
            background: `linear-gradient(180deg, ${WOOD_LIT} 0%, #14223c 88%, #0a1322 100%)`,
            borderBottom: `2px solid ${BRASS}`,
            boxShadow: "inset 0 1px 0 rgba(150,200,255,.14), 0 6px 18px rgba(0,0,0,.6)",
          }}
        />
        <Medallion />
        <div className="flex items-start gap-3">
          {categories.map((choice, index) => (
            <Tab
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

      {/* Le coffre ouvert: les plaques dans leur creux. */}
      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-6 py-3">
        <div
          className="relative flex max-h-full w-full max-w-[640px] flex-col rounded-[14px] p-4"
          style={{
            background: `linear-gradient(180deg, rgba(5,10,20,.66) 0%, rgba(16,28,51,.55) 100%)`,
            border: `2px solid ${BRASS}`,
            outline: "1px solid rgba(0,0,0,.65)",
            boxShadow: [
              "inset 0 4px 16px rgba(0,0,0,.7)",
              // Le reflet du tourbillon au fond du coffre: sans lui, le creux
              // serait noir comme partout, et la source de lumière de la pièce
              // n'éclairerait rien.
              "inset 0 -30px 50px -30px rgba(111,211,255,.16)",
              "inset 0 -1px 0 rgba(150,200,255,.1)",
            ].join(", "),
          }}
        >
          <div ref={column} className="flex max-h-full flex-col gap-3 overflow-y-auto px-1 py-1">
            {items.map((item, index) => (
              <Plaque
                key={item.id}
                item={item}
                tilt={(((index * 7) % 5) - 2) * 0.7}
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
        <span style={{ color: BRASS }}>{footer}</span>
        <span className="flex items-center gap-4">
          <Gem letter="A" what="choisir" tone={AZURE} />
          <button type="button" id="closeMenu" onClick={onClose}>
            <Gem letter="B" what="reprendre" tone={GOLD} />
          </button>
        </span>
      </footer>

      <Picker
        picking={shell.picking}
        costume={{
          panel: WOOD,
          ink: PARCHMENT,
          edge: BRASS,
          accent: AZURE,
          veil: "rgba(5,10,20,.68)",
        }}
      />
    </div>
  );
}

/** Le médaillon du fronton: le tourbillon dans son rond de bois cerclé de
 * laiton.
 *
 * Le vrai porte le logo du jeu; celui-ci ne porte que son mouvement. Trois
 * arcs en tire-bouchon, deux vitesses et deux sens: un seul anneau qui tourne
 * se lit comme une horloge, et le portail disparaît. */
function Medallion() {
  return (
    <span
      aria-hidden="true"
      className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full"
      style={{
        background: `radial-gradient(circle at 38% 32%, ${WOOD_LIT} 0%, ${WOOD} 48%, #0a1322 100%)`,
        border: `3px solid ${BRASS}`,
        boxShadow: [
          // La lueur que le tourbillon jette sur la boîte: un rond d'azur
          // derrière le médaillon, plus qu'un trait lumineux sur lui.
          `0 0 38px rgba(111,211,255,.4)`,
          `0 0 90px rgba(47,127,208,.22)`,
          "0 4px 12px rgba(0,0,0,.6)",
          "inset 0 2px 5px rgba(180,220,255,.22)",
        ].join(", "),
      }}
    >
      <svg viewBox="0 0 64 64" className="h-11 w-11" fill="none" strokeLinecap="round">
        {/* Le noyau: il ne tourne pas, c'est le fond du portail. */}
        <circle cx="32" cy="32" r="7" fill={AZURE} opacity="0.9" />
        <circle cx="32" cy="32" r="11" stroke={AZURE} strokeWidth="2.5" opacity="0.55" />
        {/* Les deux couronnes tournent en sens inverse et pas à la même
            vitesse: c'est le désaccord qui fait la spirale. */}
        <g
          className="n3-swirl"
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
          stroke={AZURE}
        >
          <circle cx="32" cy="32" r="17" strokeWidth="3" strokeDasharray="58 14 22 10" />
          <circle cx="32" cy="32" r="24" strokeWidth="2.5" strokeDasharray="34 12 68 16" />
        </g>
        <g
          className="n3-swirl"
          style={{
            transformBox: "fill-box",
            transformOrigin: "center",
            animationDirection: "reverse",
            animationDuration: "17s",
          }}
          stroke={AZURE_DEEP}
        >
          <circle cx="32" cy="32" r="20.5" strokeWidth="2" strokeDasharray="20 9 44 13" />
          <circle cx="32" cy="32" r="28" strokeWidth="2" strokeDasharray="50 18 26 10" />
        </g>
      </svg>
    </span>
  );
}

/** Un onglet du fronton: un rayon. */
function Tab({
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
        // L'onglet choisi DESCEND d'un cheveu et s'éclaire d'azur, comme si le
        // tourbillon l'avait reconnu.
        lit ? "translate-y-[3px] scale-[1.06]" : "opacity-70",
      )}
      style={{
        background: lit
          ? `linear-gradient(180deg, ${WOOD_LIT} 0%, ${WOOD} 100%)`
          : `linear-gradient(180deg, #182a4a 0%, #101c33 100%)`,
        border: `1px solid ${lit ? AZURE : BRASS}`,
        boxShadow: lit
          ? `0 6px 18px rgba(0,0,0,.55), 0 0 22px rgba(111,211,255,.32), inset 0 1px 0 rgba(180,220,255,.28)`
          : "0 3px 10px rgba(0,0,0,.5), inset 0 1px 0 rgba(180,220,255,.08)",
        color: lit ? AZURE : PARCHMENT,
      }}
    >
      <span className="flex h-6 w-6 [&>svg]:h-full [&>svg]:w-full">{icon}</span>
      <span
        className="text-[11px] uppercase tracking-[0.14em]"
        style={{ textShadow: "0 1px 0 rgba(0,0,0,.85)" }}
      >
        {label}
      </span>
    </button>
  );
}

/** Une plaque de bois bleu: une entrée.
 *
 * Elle penche un peu, d'un angle FIXE tiré de sa place dans la liste: les
 * plaques du menu ne sont pas empilées au cordeau, et c'est ce désordre sage
 * qui les donne posées sur une table. Choisie, elle se redresse. */
function Plaque({
  item,
  tilt,
  here,
  onPoint,
  onChoose,
}: {
  item: XmbCategory["items"][number];
  tilt: number;
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
        // Pas `opacity`, pour la même raison que dans la taverne: une plaque à
        // moitié transparente disparaît dans le fond. Une entrée indisponible
        // est une plaque éteinte, pas une plaque absente.
        item.disabled && "saturate-[.55] brightness-[.72]",
      )}
      style={{
        transform: here ? "rotate(0deg) scale(1.045)" : `rotate(${tilt}deg)`,
        background: here
          ? `linear-gradient(180deg, ${WOOD_LIT} 0%, #24406e 42%, #14223c 100%)`
          : `linear-gradient(180deg, #22355c 0%, #1a2a4a 45%, #101c33 100%)`,
        // Le liseré d'azur sur le laiton, comme le liseré d'or de la taverne:
        // deux traits donnent son épaisseur à une ferrure, un seul reste plat.
        border: `2px solid ${here ? AZURE : BRASS}`,
        outline: `1px solid rgba(0,0,0,.6)`,
        boxShadow: here
          ? [
              "0 10px 26px rgba(0,0,0,.65)",
              "0 0 32px rgba(111,211,255,.38)",
              "inset 0 2px 0 rgba(190,225,255,.38)",
              "inset 0 -3px 10px rgba(0,0,0,.5)",
            ].join(", ")
          : [
              "0 5px 14px rgba(0,0,0,.6)",
              "inset 0 2px 0 rgba(170,210,255,.16)",
              "inset 0 -3px 10px rgba(0,0,0,.45)",
            ].join(", "),
      }}
    >
      {/* Le jeton: l'icône dans une pièce de laiton à noyau d'azur, ou la
          jaquette pour un jeu. */}
      {item.game ? (
        <Art
          index={item.game.index}
          name={item.label}
          has={item.game.art}
          width={96}
          className="shrink-0 rounded-[4px]"
        />
      ) : (
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full [&>svg]:h-6 [&>svg]:w-6"
          style={{
            background: `radial-gradient(circle at 34% 28%, #c9a254 0%, #6e5220 45%, #221806 100%)`,
            border: `2px solid ${here ? GOLD_LIT : BRASS}`,
            color: here ? "#0a1322" : PARCHMENT,
            boxShadow: here
              ? `inset 0 2px 4px rgba(255,240,200,.35), 0 0 14px rgba(111,211,255,.45), 0 2px 6px rgba(0,0,0,.55)`
              : "inset 0 2px 4px rgba(255,240,200,.22), 0 2px 6px rgba(0,0,0,.55)",
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
            textShadow: "0 1px 0 rgba(0,0,0,.85), 0 -1px 0 rgba(170,210,255,.14)",
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
        <span className="shrink-0 font-mono text-[12px]" style={{ color: here ? AZURE : GOLD }}>
          {item.value}
        </span>
      ) : null}
    </button>
  );
}

/** Le grain du bois, teinté nuit: le même motif que la taverne, mais un grain
 * de bois bleu ne se dessine pas en noir pur sans passer pour de la suie. */
function Grain() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.12]"
      aria-hidden="true"
    >
      <defs>
        <pattern id="n3-grain-blue" width="180" height="46" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="#02050c" strokeWidth="1.1">
            <path d="M0 8c40-6 80 6 120 0s50-4 60 2" />
            <path d="M0 21c50 5 70-6 110-2s60 4 70 0" />
            <path d="M0 33c30-5 60 4 100 1s60 3 80-2" />
            <path d="M0 43c60 3 100-4 180 1" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#n3-grain-blue)" />
    </svg>
  );
}

/** La lumière de la pièce, jetée par le tourbillon. */
function Glow() {
  return (
    <span
      aria-hidden="true"
      className="n3-glow pointer-events-none absolute inset-0"
      style={{
        background: `radial-gradient(55% 42% at 50% 0%, rgba(111,211,255,.3) 0%, transparent 70%)`,
      }}
    />
  );
}

/** Les poussières d'arcane.
 *
 * Suite FIXE comme les braises de la taverne, et pour la même raison: un hasard
 * retiré à chaque rendu remettrait toutes les poussières au départ en même
 * temps, ce qui se voit immédiatement. Une sur trois est d'or: l'azur seul est
 * froid à en devenir plat, et la pièce a besoin d'une chaleur quelque part.
 */
function Motes() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: MOTES }, (_, at) => {
        const spread = (at * 37) % 100;
        const delay = ((at * 13) % 80) / 10;
        const life = 8 + ((at * 7) % 50) / 10;
        const drift = ((at * 23) % 60) - 30;
        const size = 2 + ((at * 11) % 3);
        const warm = at % 3 === 0;
        const tone = warm ? GOLD_LIT : AZURE;
        return (
          <span
            key={at}
            className="n3-mote absolute rounded-full"
            style={{
              left: `${spread}%`,
              bottom: `-${4 + (at % 5)}%`,
              width: size,
              height: size,
              background: tone,
              boxShadow: `0 0 ${size * 4}px ${tone}`,
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

/** Une ferrure de laiton rivetée dans un coin.
 *
 * Là où la taverne porte des volutes, la boîte porte des équerres: elle est
 * fabriquée pour voyager, pas pour décorer. Deux rivets, parce qu'une équerre
 * sans rivets est un L mal dessiné. */
function Plate({ corner }: { corner: "tl" | "tr" | "bl" | "br" }) {
  const flip = corner === "tr" || corner === "br" ? "scaleX(-1)" : "";
  const upend = corner === "bl" || corner === "br" ? "scaleY(-1)" : "";
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 120 120"
      className={cn(
        "pointer-events-none absolute h-24 w-24 opacity-70",
        corner.includes("t") ? "top-0" : "bottom-0",
        corner.includes("l") ? "left-0" : "right-0",
      )}
      style={{ transform: `${flip} ${upend}`.trim() || undefined }}
      fill="none"
      stroke={BRASS}
    >
      <path d="M3 3h64v14H17v50H3z" fill={BRASS} opacity="0.28" stroke="none" />
      <path d="M3 3h64v14H17v50H3z" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="3" fill={GOLD} stroke="none" />
      <circle cx="56" cy="10" r="3" fill={GOLD} stroke="none" />
      <circle cx="10" cy="56" r="3" fill={GOLD} stroke="none" />
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
          border: `1px solid ${BRASS}`,
          color: "#0a1322",
          boxShadow: `0 0 10px ${tone}55`,
        }}
      >
        {letter}
      </span>
      {what}
    </span>
  );
}
