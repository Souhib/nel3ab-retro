/**
 * Le menu, dans la forme du XMB de la PlayStation 3.
 *
 * # Ce qui fait un XMB, et ce qu'on reprend
 *
 * Une **croix**. Une rangée horizontale de rayons, et sous le rayon choisi une
 * colonne verticale d'entrées. Le point où les deux se croisent ne bouge jamais:
 * c'est le contenu qui glisse dessous. Gauche et droite changent de rayon, haut
 * et bas changent d'entrée, et à chaque fois c'est le monde qui se déplace, pas
 * le curseur. C'est ce qui donne sa sensation à ce menu, et c'est reproductible;
 * le reste est de la peinture.
 *
 * Les icônes sont les nôtres (voir `XmbIcons`): celles de Sony ne le sont pas.
 *
 * # Le fond, et la règle qu'il enfreint
 *
 * Ce projet interdit les dégradés et les effets, parce qu'ils tirent l'oeil hors
 * de l'image du jeu. Ici il n'y a pas d'image: on a quitté la partie pour venir
 * lire une liste. La raison de la règle ne s'applique pas à cet écran-là, donc
 * la règle non plus. Le dégradé et l'onde viennent quand même de la couleur du
 * thème, pour que les sept ambiances restent vraies.
 */
import { useEffect, useRef } from "react";
import type { MenuAction } from "../media/menupad";
import { useShell } from "./shell";
import { cn } from "../lib/cn";

/** Une entrée dans la colonne d'un rayon. */
export type XmbItem = {
  id: string;
  label: string;
  /** La ligne sous le titre, quand il y a quelque chose à expliquer. */
  hint?: string;
  /** Ce que ça vaut en ce moment, à droite: « 70 », « sombre », « en cours ». */
  value?: string;
  icon: React.ReactNode;
  /** Vrai quand l'entrée existe mais ne se choisit pas. Elle reste visible, avec
   * sa raison: une entrée qui disparaît laisse quelqu'un chercher. */
  disabled?: boolean;
  /** Entrée, ou X sur la manette. */
  onEnter?: () => void;
  /** Gauche et droite sur une entrée qui porte une valeur. */
  onAdjust?: (by: 1 | -1) => void;
};

export type XmbCategory = {
  id: string;
  label: string;
  icon: React.ReactNode;
  items: XmbItem[];
};

/** Où la croix se pose, en proportion de la hauteur. Un peu au-dessus du milieu,
 * comme sur la console: la colonne a besoin de plus de place que la rangée. */
const CROSS = 0.4;
/** Pas entre deux rayons et entre deux entrées, en pixels. */
const ACROSS = 148;
const DOWN = 74;

export function Xmb({
  categories,
  onClose,
  footer,
  onPad,
  paused,
}: {
  categories: XmbCategory[];
  onClose: () => void;
  footer?: React.ReactNode;
  /** Donne au menu de quoi recevoir la manette, et la lui rend en partant. */
  onPad?: (handler: ((action: MenuAction) => void) | null) => void;
  /** Vrai quand un écran est ouvert PAR-DESSUS le menu, comme celui des touches.
   * Le menu reste affiché derrière, mais il ne doit plus rien recevoir: sinon
   * réassigner une flèche ferait aussi défiler la liste dessous. */
  paused?: boolean;
}) {
  const shell = useShell(categories, 1, onClose, paused);
  const { items, ray, row } = shell;
  const list = useRef<HTMLDivElement>(null);

  /* La manette conduit la même croix que le clavier, par le même chemin. Le
     gestionnaire est reposé à chaque rendu parce qu'il ferme sur l'état courant;
     c'est une affectation, pas un abonnement, donc ça ne coûte rien. */
  useEffect(() => {
    onPad?.(shell.act);
    return () => onPad?.(null);
  });

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[data-cursor="true"]')?.scrollIntoView({
      block: "nearest",
    });
  }, [row, ray]);

  return (
    <div id="menu" className="fixed inset-0 z-50 overflow-hidden bg-ink">
      <Backdrop />

      {/* La rangée des rayons. Elle glisse pour que le rayon choisi reste au
          croisement, qui ne bouge jamais. */}
      <div
        className="pointer-events-none absolute left-[18%] transition-transform duration-200 ease-out"
        style={{ top: `calc(${CROSS * 100}% - 34px)`, transform: `translateX(${-ray * ACROSS}px)` }}
      >
        {categories.map((choice, index) => (
          <button
            key={choice.id}
            type="button"
            id={`ray-${choice.id}`}
            data-selected={index === ray}
            onClick={() => shell.goTo(index)}
            className={cn(
              "pointer-events-auto absolute flex w-[120px] flex-col items-center gap-1 border-0 bg-transparent transition-all duration-200",
              index === ray ? "text-text opacity-100" : "text-muted opacity-45",
            )}
            style={{ left: `${index * ACROSS}px` }}
          >
            <span
              className={cn("transition-all duration-200", index === ray ? "h-12 w-12" : "h-8 w-8")}
            >
              {choice.icon}
            </span>
            <span
              className={cn(
                "text-[11px] uppercase tracking-[0.2em] transition-opacity duration-200",
                index === ray ? "opacity-100" : "opacity-0",
              )}
            >
              {choice.label}
            </span>
          </button>
        ))}
      </div>

      {/* La colonne du rayon choisi. Elle glisse pour que l'entrée choisie reste
          juste sous le croisement. */}
      <div
        className="absolute left-[18%] w-[62%] transition-transform duration-200 ease-out"
        style={{ top: `calc(${CROSS * 100}% + 46px)`, transform: `translateY(${-row * DOWN}px)` }}
      >
        {items.map((item, index) => {
          const here = index === row;
          return (
            <button
              key={item.id}
              type="button"
              id={`item-${item.id}`}
              data-selected={here}
              disabled={item.disabled}
              onClick={() => shell.choose(index)}
              className={cn(
                "absolute flex w-full items-center gap-4 border-0 bg-transparent px-2 text-left transition-all duration-200",
                here ? "opacity-100" : "opacity-40",
                item.disabled && "opacity-25",
              )}
              style={{ top: `${index * DOWN}px`, height: `${DOWN}px` }}
            >
              <span
                className={cn("shrink-0 transition-all duration-200", here ? "h-9 w-9" : "h-7 w-7")}
              >
                {item.icon}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  className={cn(
                    "truncate",
                    here ? "text-[17px] text-text" : "text-[14px] text-muted",
                  )}
                >
                  {item.label}
                </span>
                {here && item.hint ? (
                  <span className="truncate text-[12px] text-faint">{item.hint}</span>
                ) : null}
              </span>
              {item.value ? (
                <span
                  className={cn(
                    "shrink-0 font-mono text-[13px]",
                    here ? "text-indigo" : "text-faint",
                  )}
                >
                  {item.value}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <footer className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-4 px-8 py-5 text-[12px] text-faint">
        <span>{footer}</span>
        <span className="flex gap-4">
          <span>← → rayon</span>
          <span>↑ ↓ entrée</span>
          <span>A choisit</span>
          <button type="button" id="closeMenu" onClick={onClose} className="hover:text-indigo">
            Échap reprend la partie
          </button>
        </span>
      </footer>
    </div>
  );
}

/**
 * Le fond: un dégradé et une onde lente.
 *
 * C'est la seule décoration de tout le projet, et elle est assumée: la règle qui
 * l'interdit ailleurs protège l'image du jeu, et il n'y a pas d'image ici. Les
 * couleurs viennent du thème, donc l'onde est verte en phosphore et crème en
 * famicom.
 */
function Backdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 20% 35%, color-mix(in srgb, var(--indigo) 22%, transparent), transparent 70%)",
        }}
      />
      <svg
        className="absolute inset-x-0 opacity-40"
        style={{ top: "28%", height: "44%", width: "100%" }}
        viewBox="0 0 1200 300"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M0 150 C 200 90, 400 210, 600 150 S 1000 90, 1200 150"
          fill="none"
          stroke="var(--indigo)"
          strokeWidth="1.5"
          opacity="0.5"
        >
          <animate
            attributeName="d"
            dur="14s"
            repeatCount="indefinite"
            values="M0 150 C 200 90, 400 210, 600 150 S 1000 90, 1200 150;
                    M0 150 C 200 210, 400 90, 600 150 S 1000 210, 1200 150;
                    M0 150 C 200 90, 400 210, 600 150 S 1000 90, 1200 150"
          />
        </path>
        <path
          d="M0 170 C 250 120, 450 220, 700 170 S 1050 120, 1200 170"
          fill="none"
          stroke="var(--indigo)"
          strokeWidth="1"
          opacity="0.3"
        >
          <animate
            attributeName="d"
            dur="19s"
            repeatCount="indefinite"
            values="M0 170 C 250 120, 450 220, 700 170 S 1050 120, 1200 170;
                    M0 170 C 250 220, 450 120, 700 170 S 1050 220, 1200 170;
                    M0 170 C 250 120, 450 220, 700 170 S 1050 120, 1200 170"
          />
        </path>
      </svg>
    </div>
  );
}
