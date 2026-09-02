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
import { Art } from "./Art";
import { Picker } from "./Picker";
import { useShell, useSwipe } from "./shell";
import { cn } from "../lib/cn";

/** Une entrée dans la colonne d'un rayon. */
export type XmbItem = {
  id: string;
  label: string;
  /** La ligne sous le titre, quand il y a quelque chose à expliquer. */
  hint?: string;
  /** Le SUJET auquel cette entrée appartient: « son », « manettes »…
   *
   * Affiché à côté du nom du rayon plutôt qu'en séparateur dans la liste. Les
   * trois coques indexent la sélection sur la POSITION visuelle — une colonne
   * qui glisse, une grille de quatre, une file horizontale — et un titre inséré
   * entre deux entrées casserait ce calcul dans les trois. L'adjacence fait le
   * groupement; cette ligne dit lequel. */
  group?: string;
  /** Ce que ça vaut en ce moment, à droite: « 70 », « sombre », « en cours ». */
  value?: string;
  icon: React.ReactNode;
  /** Le jeu que cette entrée désigne, quand c'en est un.
   *
   * Sa place dans la bibliothèque, parce que c'est par là qu'on demande sa
   * jaquette, et ce que le worker a dit de cette jaquette: il en sert une, ou
   * non. Les entrées qui ne sont pas des jeux gardent leur icône. */
  game?: { index: number; art: boolean };
  /** Le studio, tel que le disque le dit. */
  by?: string;
  /** La phrase que l'éditeur a écrite sur le disque. */
  note?: string;
  /** Vrai quand l'entrée existe mais ne se choisit pas. Elle reste visible, avec
   * sa raison: une entrée qui disparaît laisse quelqu'un chercher. */
  disabled?: boolean;
  /** Entrée, ou X sur la manette. */
  onEnter?: () => void;
  /** Gauche et droite sur une entrée qui porte une valeur. */
  onAdjust?: (by: 1 | -1) => void;
  /** Les valeurs possibles, quand il y en a une liste courte.
   *
   * Une liste plutôt qu'un `onAdjust` qui tourne en rond, et la différence
   * compte: avec sept ambiances, tourner en rond veut dire appuyer sept fois
   * sans jamais voir ce qui existe. Ouvre un sélecteur. */
  picks?: { id: string; label: string; hint?: string }[];
  /** Laquelle est en cours, par son identifiant. */
  picked?: string;
  /** Ce qu'on fait du choix, à la validation. */
  onPick?: (id: string) => void;
  /** Vrai quand le choix se VOIT sur l'image du jeu.
   *
   * Deux conséquences: il s'applique en se promenant dans la liste plutôt qu'à
   * la validation, et le menu s'efface pour laisser voir ce qu'on règle. Régler
   * la taille de l'image derrière un menu qui la cache est un réglage qu'on fait
   * à l'aveugle, et qu'on refait donc trois fois. */
  preview?: boolean;
  /** Une valeur continue, à faire glisser. */
  slide?: {
    value: number;
    min: number;
    max: number;
    step: number;
    /** Comment l'écrire à l'écran. */
    say: (value: number) => string;
    /** Appelé à chaque déplacement, pas seulement à la validation: un volume
     * qu'on règle sans l'entendre ne se règle pas. Annuler remet l'ancienne. */
    onSet: (value: number) => void;
  };
};

export type XmbCategory = {
  id: string;
  label: string;
  icon: React.ReactNode;
  items: XmbItem[];
};

/**
 * Pourquoi cette coque n'atténue plus RIEN par l'opacité.
 *
 * Trois corrections faites le 2 septembre 2026 se sont contredites, et chaque
 * fois pour la même raison: deux mécanismes d'atténuation qui se multiplient.
 *
 * 1. Un fondu au-dessus du curseur, hérité d'un problème de superposition déjà
 *    réglé autrement, multipliait l'opacité de chaque entrée: 0,17 à deux rangs,
 *    soit 1,20:1.
 * 2. Le libellé d'un rayon portait une opacité, et son bouton une autre: deux
 *    fois 0,50 font 0,25, soit 1,38:1.
 * 3. Une entrée non choisie était à la fois `--muted` ET à moitié transparente.
 *    `--muted` tient 5,95:1 à plein et n'a donc presque aucune marge: 2,26:1.
 *
 * Aucun de ces produits n'est visible dans le fichier où on l'écrit. Il a fallu
 * un pilote qui mesure le contraste EFFECTIF dans le rendu, en accumulant les
 * opacités des ancêtres et en empilant les fonds.
 *
 * D'où la règle, la même que celle que la coque Wii avait déjà imposée pour une
 * autre raison: on atténue par la COULEUR, jamais par l'alpha. Trois niveaux,
 * tous lisibles — `--text` 16,40:1, `--muted` 5,95:1, `--faint` 4,50:1 — et une
 * hiérarchie qui ne peut plus se multiplier par accident.
 */

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

  const drag = useSwipe(shell.act);

  return (
    <div
      id="menu"
      {...drag}
      style={{ touchAction: "none" }}
      className={cn(
        "n3-enter fixed inset-0 z-50 overflow-hidden bg-ink",
        shell.picking?.previewing ? "n3-peek" : "",
      )}
    >
      <Backdrop />

      {/* La rangée des rayons est le PREMIER PLAN, et c'est ce que fait la
          console: la barre est devant, le fond d'écran et la colonne passent
          derrière. Sans `z-10` elle est peinte avant la colonne, donc dessous,
          et l'entrée juste au-dessus du curseur recouvre le nom du rayon.
          Vu sur une captation de vraie XMB, pas déduit: la barre y masque tout
          ce qui la croise. */}
      {/* La rangée des rayons. Elle glisse pour que le rayon choisi reste au
          croisement, qui ne bouge jamais. */}
      <div
        className="pointer-events-none absolute z-10 left-[18%] transition-transform duration-200 ease-out"
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
              // La COULEUR seule dit ce qui n'est pas choisi, plus l'opacité.
              // Les deux se cumulaient: `--muted` tient 5,95:1 à plein, et une
              // moitié d'opacité par-dessus le fait tomber à 2,26:1. Deux
              // mécanismes d'atténuation qui se multiplient donnent un résultat
              // que ni l'un ni l'autre n'annonce.
              index === ray ? "text-text" : "text-muted",
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
                // Seul le rayon CHOISI porte son nom, comme sur la console.
                //
                // Les autres ont été nommés pendant une journée, pour qu'on sache
                // ce que quatre icônes ouvrent. Ça se défend, et ce n'est pas ce
                // menu-ci: le XMB dit où on est, pas ce qui existe ailleurs, et
                // c'est le déplacement du croisement qui l'apprend. Nommer les
                // quatre poussait la colonne hors de sa place pour leur laisser
                // le passage.
                //
                // Ce que ça coûte, dit plutôt que tu: quelqu'un qui ouvre ce menu
                // pour la première fois doit se promener pour découvrir les
                // quatre rayons. C'est le prix de la forme, assumé.
                "whitespace-nowrap text-[11px] uppercase tracking-[0.2em] transition-opacity duration-200",
                index === ray ? "opacity-100" : "opacity-0",
              )}
            >
              {choice.label}
              {index === ray && items[row]?.group ? (
                <span className="opacity-55"> · {items[row].group}</span>
              ) : null}
            </span>
          </button>
        ))}
      </div>

      {/* La colonne du rayon choisi. Elle glisse pour que l'entrée choisie reste
          juste sous le croisement. */}
      <div
        // Sous le croisement, à 18 %, comme la console.
        //
        // Elle a été poussée à 37 % pendant une journée pour régler une
        // superposition avec la rangée des rayons. C'était traiter le symptôme:
        // la superposition venait d'avoir rendu VISIBLES les libellés des rayons
        // non choisis, ce que le XMB ne fait pas. Rendus à leur invisibilité, la
        // colonne retrouve sa place et il n'y a plus rien à régler.
        className="absolute left-[18%] w-[62%] transition-transform duration-200 ease-out"
        style={{
          top: `calc(${CROSS * 100}% + 46px)`,
          transform: `translateY(${-row * DOWN}px)`,
        }}
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
              className="absolute flex w-full items-center gap-4 border-0 bg-transparent px-2 text-left transition-all duration-200"
              // L'opacité en STYLE et non en classe: elle est CALCULÉE, et une
              // classe Tailwind ne peut pas porter une valeur qui varie. Dans le
              // même objet que la position, parce que deux attributs `style` sur
              // un même élément ne sont pas une erreur en JSX: le second écrase
              // le premier, en silence.
              style={{
                top: `${index * DOWN}px`,
                height: `${DOWN}px`,
                // Plus d'opacité du tout sur une entrée: elle se distingue par
                // sa TAILLE et sa COULEUR, qui sont trois niveaux tous lisibles
                // — `--text` 16,40:1, `--muted` 5,95:1, `--faint` 4,50:1.
              }}
            >
              {item.game ? (
                <Art
                  index={item.game.index}
                  name={item.label}
                  has={item.game.art}
                  width={here ? 90 : 72}
                  className="rounded-[3px] transition-all duration-200"
                />
              ) : (
                <span
                  className={cn(
                    "shrink-0 transition-all duration-200",
                    here ? "h-9 w-9" : "h-7 w-7",
                  )}
                >
                  {item.icon}
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  className={cn(
                    "truncate",
                    here ? "text-[17px] text-text" : "text-[14px] text-muted",
                    item.disabled && "text-faint",
                  )}
                >
                  {item.label}
                </span>
                {here && (item.hint ?? item.by) ? (
                  <span className="truncate text-[12px] text-faint">
                    {item.by && item.hint ? `${item.by} · ${item.hint}` : (item.hint ?? item.by)}
                  </span>
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
      <Picker
        picking={shell.picking}
        costume={{
          panel: "var(--panel)",
          ink: "var(--text)",
          edge: "var(--rule-bright)",
          accent: "var(--indigo)",
        }}
      />
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
