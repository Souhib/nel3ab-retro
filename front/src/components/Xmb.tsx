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
import { useEffect, useState } from "react";
import type { MenuAction } from "../media/menupad";
import { Art } from "./Art";
import { Picker } from "./Picker";
import { PlaceDesSurcouches } from "./Surcouche";
import { useMenuDialogue, useShell, useSwipe } from "./shell";
import { phrase, piedDuMenu, type Appareil } from "../lib/appareil";
import { cn } from "../lib/cn";
import { compteUtile, dispositionXmb } from "../lib/menu-xmb";
import { Reperes, Touche } from "./Reperes";

/** Une entrée dans la colonne d'un rayon. */
export type XmbItem = {
  id: string;
  label: string;
  /** La ligne sous le titre, quand il y a quelque chose à expliquer. */
  hint?: string;
  details?: React.ReactNode;
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
  game?: { index: number; art: boolean; console?: string };
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

/* Où la croix se pose, le pas entre deux rubriques et la hauteur d'une entrée
   vivent dans `lib/menu-xmb`: ils dépendent de l'écran depuis que le menu doit
   tenir sur un téléphone (audit M12). */

/** Le masque qui fait DISPARAÎTRE une entrée sous la bande des rayons.
 *
 * `z-10` met la rangée devant, mais l'ordre de peinture n'est pas l'opacité:
 * elle n'a aucun fond et ses boutons portent `bg-transparent`, si bien qu'une
 * entrée qui remonte se voit au travers. Mesuré le 13 septembre 2026 sur une
 * vraie salle: au rang 7 sur 14, le texte « volume » croise l'ICÔNE du rayon
 * sur 32×17 px. Trois sondes ont cherché la collision sur le LIBELLÉ, qu'il ne
 * fait que frôler sur 3 px, et ont conclu que tout allait bien.
 *
 * Un masque et non un rectangle opaque, et c'est mesuré aussi: le fond du menu
 * porte un dégradé et une onde animée qui passent exactement là. Une capture de
 * la bande pèse 42 657 octets avec le décor contre 3 830 sans, donc un
 * rectangle plat y découperait une balafre visible. Le masque occulte sans rien
 * peindre, et le décor reste entier.
 *
 * Les bornes sont des CONSTANTES, pas des pourcentages: la fenêtre de colonne
 * commence à `croix - 110px` et la bande à `croix - 34px`, toutes deux ancrées
 * au croisement. La bande occupe donc 76 à 148 px sous le haut de la fenêtre,
 * quelle que soit la hauteur de l'écran. Le fondu de douze pixels de chaque
 * côté évite la coupe nette, qui se lit comme un défaut d'affichage.
 */
const BANDE =
  "linear-gradient(to bottom, #000 0, #000 66px, transparent 78px," +
  " transparent 146px, #000 158px, #000 100%)";

/** La taille de la fenêtre, relue quand elle change (un téléphone qu'on
 * tourne). Un état et non une lecture au rendu: tourner le téléphone ne rend
 * pas le menu tout seul. */
function useFenetre() {
  const [taille, setTaille] = useState(() => ({ largeur: innerWidth, hauteur: innerHeight }));
  useEffect(() => {
    const lire = () => setTaille({ largeur: innerWidth, hauteur: innerHeight });
    addEventListener("resize", lire);
    return () => removeEventListener("resize", lire);
  }, []);
  return taille;
}

export function Xmb({
  categories,
  onClose,
  onQuitte = onClose,
  idle = false,
  footer,
  onPad,
  paused,
  appareil = "clavier",
  sortie,
}: {
  categories: XmbCategory[];
  onClose: () => void;
  /** Fermer pour de bon, quand le navigateur a déjà fermé le dialogue. */
  onQuitte?: () => void;
  idle?: boolean;
  footer?: React.ReactNode;
  /** Donne au menu de quoi recevoir la manette, et la lui rend en partant. */
  onPad?: (handler: ((action: MenuAction) => void) | null) => void;
  /** Vrai quand un écran est ouvert PAR-DESSUS le menu, comme celui des touches.
   * Le menu reste affiché derrière, mais il ne doit plus rien recevoir: sinon
   * réassigner une flèche ferait aussi défiler la liste dessous. */
  paused?: boolean;
  /** Ce que la personne tient: les aides le nomment (audit T02). */
  appareil?: Appareil;
  /** Ce que fait la sortie: reprendre, fermer, ou remonter d'un dossier. */
  sortie?: string;
}) {
  const shell = useShell(categories, 1, onClose, paused);
  const { items, ray, row } = shell;
  const dialogue = useMenuDialogue(shell, paused ?? false, onQuitte);
  const { largeur, hauteur } = useFenetre();
  const d = dispositionXmb({
    largeur,
    hauteur,
    nombre: categories.length,
    choisi: ray,
    tactile: appareil === "tactile",
  });
  const groupe = items[row]?.group;
  /** « 3/14 » seulement quand des entrées sont cachées sous le bas de la liste. */
  const compte = compteUtile(d, hauteur, items.length) ? `${row + 1}/${items.length}` : "";
  const sortieDite = sortie ?? (idle ? "Fermer le menu" : "Reprendre la partie");

  /* La manette conduit la même croix que le clavier, par le même chemin. Le
     gestionnaire est reposé à chaque rendu parce qu'il ferme sur l'état courant;
     c'est une affectation, pas un abonnement, donc ça ne coûte rien. */
  useEffect(() => {
    onPad?.(shell.act);
    return () => onPad?.(null);
  });

  /* Il y avait ici un effet de recentrage, mort DEUX FOIS: la référence
     `list` n'était attachée à aucun élément, donc toujours nulle, et aucun
     élément de la page ne porte `data-cursor` — le rendu pose
     `data-selected`. Il ne servirait de toute façon à rien: la colonne ne
     défile pas, elle GLISSE par un `translateY`, et `scrollIntoView` n'a
     aucune prise sur une transformation. Supprimé plutôt que réparé. */

  const drag = useSwipe(shell.act);

  return (
    <dialog
      {...dialogue}
      {...drag}
      style={{ touchAction: "none" }}
      className={cn("n3-menu n3-enter bg-ink", shell.picking?.previewing ? "n3-peek" : "")}
    >
      {/* Le fond va jusqu'aux bords, hors de la zone sûre: posé dedans, il
          laissait une bande de fond uni sous l'encoche (relecture du
          22 novembre 2026). Enfant direct du dialogue, `.n3-peek` l'efface
          comme le reste. */}
      <Backdrop />
      {/* Inerte derrière un sélecteur: Tab reste dans le sélecteur. Une boîte
          pleine et non `display: contents`: `.n3-peek` efface les enfants
          directs par l'opacité, et une boîte sans boîte n'en a pas. */}
      <div className="n3-menu-zone absolute inset-0" inert={shell.picking !== null}>
        {/* Le sujet de l'entrée choisie et où on en est dans la liste, au-dessus
            des rubriques. Il était collé au nom de la rubrique choisie, ce qui
            n'allait plus quand les quatre noms se lisent: il débordait sur les
            voisins. Couché, il n'y a pas la place au-dessus: la rubrique
            choisie et l'entrée suffisent. La colonne est découpée par le bas:
            sans « 3/14 », RIEN ne disait qu'il y avait d'autres entrées
            dessous. */}
        {!d.bas && (groupe || compte) ? (
          <p
            id="menuSujet"
            className="absolute whitespace-nowrap text-note uppercase tracking-[0.14em] text-muted"
            // Au-dessus de la fenêtre de la liste et non juste au-dessus de la
            // rangée: les entrées d'avant le curseur s'y montrent, et la
            // légende les chevauchait (vu sur la capture à 390 px).
            style={{ top: d.croixY - 136, left: d.colonne.gauche }}
          >
            {groupe ?? ""}
            {groupe && compte ? " · " : ""}
            {compte}
          </p>
        ) : null}

        {/* La rangée des rubriques est le PREMIER PLAN, et c'est ce que fait la
            console: la barre est devant, le fond d'écran et la colonne passent
            derrière. Sans `z-10` elle est peinte avant la colonne, donc dessous,
            et l'entrée juste au-dessus du curseur recouvre le nom de la rubrique.
            Large, elle glisse pour que la rubrique choisie reste au croisement;
            étroite, elle reste fixe et partage l'écran en parts égales. */}
        <div
          className="pointer-events-none absolute left-0 z-10 transition-transform duration-200 ease-out"
          style={{ top: d.croixY - 34, transform: `translateX(${d.rangee}px)` }}
        >
          {categories.map((choice, index) => (
            <button
              key={choice.id}
              type="button"
              id={`ray-${choice.id}`}
              data-selected={index === ray}
              aria-current={index === ray ? "true" : undefined}
              // Hors de la tabulation: les flèches y mènent, et le curseur, qui
              // a le focus, est toujours une entrée de la liste.
              tabIndex={-1}
              onClick={() => shell.goTo(index)}
              className={cn(
                "pointer-events-auto absolute flex flex-col items-center gap-1 border-0 bg-transparent transition-all duration-200",
                // La COULEUR seule dit ce qui n'est pas choisi, plus l'opacité.
                // Les deux se cumulaient: `--muted` tient 5,95:1 à plein, et une
                // moitié d'opacité par-dessus le fait tomber à 2,26:1.
                index === ray ? "text-text" : "text-muted",
              )}
              style={{ left: `${index * d.pas}px`, width: d.rubrique }}
            >
              <span
                className={cn(
                  "transition-all duration-200",
                  index === ray ? (d.bas ? "h-9 w-9" : "h-12 w-12") : "h-8 w-8",
                )}
              >
                {choice.icon}
              </span>
              {/* Les QUATRE noms, et plus seulement celui de la rubrique
                  choisie. Le XMB de la console ne nomme que la choisie, et ce
                  menu l'avait suivi; quelqu'un qui l'ouvrait pour la première
                  fois devait se promener pour découvrir ce qui existait, et
                  « touches et manettes » passait inaperçu (audit T13). */}
              <span
                data-nom
                className={cn(
                  "whitespace-nowrap text-note uppercase transition-colors duration-200",
                  d.etroit ? "tracking-[0.06em]" : "tracking-[0.2em]",
                )}
              >
                {choice.label}
              </span>
            </button>
          ))}
        </div>

        {/* La colonne de la rubrique choisie. Elle glisse pour que l'entrée
            choisie reste juste sous le croisement.

            BORNÉE, en haut et en bas: la fenêtre commence AU-DESSUS du
            croisement (les entrées d'avant passent derrière la rangée, qui les
            masque) et s'arrête au-dessus du pied. Ce qui sort est coupé net, ce
            qui est dedans est entier, et la colonne garde son glissement. */}
        <div
          className="absolute overflow-hidden"
          style={{
            top: d.croixY - 110,
            bottom: d.pied,
            left: d.colonne.gauche,
            width: d.colonne.largeur,
            // La bande des rubriques AVALE ce qui passe derrière elle.
            maskImage: BANDE,
            WebkitMaskImage: BANDE,
          }}
        >
          <div
            role="group"
            aria-label={shell.category?.label}
            className="absolute inset-x-0 top-0 transition-transform duration-200 ease-out"
            // 156 px: la distance entre le haut de la fenêtre et le croisement,
            // plus 46 px. La sélection retombe donc juste sous la rangée.
            style={{ transform: `translateY(${156 - row * d.rang}px)` }}
          >
            {items.map((item, index) => {
              const here = index === row;
              return (
                <button
                  key={item.id}
                  type="button"
                  id={`item-${item.id}`}
                  data-selected={here}
                  // Le curseur EST le focus: une seule entrée dans la
                  // tabulation, celle qui est choisie (audit A11Y-02).
                  tabIndex={here ? 0 : -1}
                  aria-current={here ? "true" : undefined}
                  // `aria-disabled` et non `disabled`: une entrée grisée reste
                  // focalisable, sinon le curseur s'y poserait sans le focus,
                  // et Entrée activerait l'entrée d'avant. Le choix l'ignore
                  // (`useShell`), et son aide dit pourquoi.
                  aria-disabled={item.disabled ? "true" : undefined}
                  onClick={() => shell.choose(index)}
                  className="absolute flex w-full items-center gap-4 border-0 bg-transparent px-2 text-left transition-all duration-200"
                  style={{ top: `${index * d.rang}px`, height: `${d.rang}px` }}
                >
                  {item.game ? (
                    <Art
                      index={item.game.index}
                      name={item.label}
                      has={item.game.art}
                      console={item.game.console}
                      width={d.etroit ? (here ? 72 : 56) : here ? 90 : 72}
                      className="shrink-0 rounded-[3px] transition-all duration-200"
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
                    {/* Sur un téléphone, le nom court sur deux lignes au lieu
                        d'être coupé: « GameC… » ne disait plus de quelle
                        console il s'agissait (audit M12). */}
                    <span
                      data-libelle
                      className={cn(
                        d.etroit ? "line-clamp-2 break-words leading-snug" : "truncate",
                        here
                          ? d.etroit
                            ? "text-fort text-text"
                            : "text-titre text-text"
                          : d.etroit
                            ? "text-corps text-muted"
                            : "text-fort text-muted",
                        item.disabled && "text-faint",
                      )}
                    >
                      {item.label}
                    </span>
                    {/* Étroit, la valeur passe sous le nom au lieu de lui
                        prendre la droite: à 320 px, « appareil des jeux Wii »
                        et « commandes tactiles » restaient coupés malgré leurs
                        deux lignes (relecture du 22 novembre 2026). Sur
                        l'entrée choisie, elle partage la ligne de l'aide, pour
                        que l'entrée garde sa hauteur de deux lignes plus deux. */}
                    {(() => {
                      const aide =
                        item.by && item.hint ? `${item.by} · ${item.hint}` : (item.hint ?? item.by);
                      const valeur = d.etroit ? item.value : undefined;
                      if (!here) {
                        return valeur ? (
                          <span data-valeur className="truncate font-mono text-corps text-faint">
                            {valeur}
                          </span>
                        ) : null;
                      }
                      if (!aide && !valeur) return null;
                      return (
                        <span
                          className={cn(
                            "text-corps text-faint",
                            d.etroit ? "line-clamp-2 leading-snug" : "truncate",
                          )}
                        >
                          {valeur ? (
                            <span data-valeur className="font-mono text-indigo">
                              {valeur}
                            </span>
                          ) : null}
                          {valeur && aide ? " · " : ""}
                          {aide}
                        </span>
                      );
                    })()}
                  </span>
                  {item.value && !d.etroit ? (
                    <span
                      data-valeur
                      className={cn(
                        "shrink-0 font-mono text-corps",
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
        </div>

        {/* Le pied: les gestes de l'appareil qu'on tient, et une vraie sortie.
            Il disait « ← → rayon · ↑ ↓ entrée · A choisit » à tout le monde:
            au clavier, A ne choisit rien; au téléphone, il n'y a pas d'Échap
            (audit T02, M12). */}
        <footer
          className={cn(
            "absolute inset-x-0 bottom-0 flex gap-x-6 gap-y-2 px-6 text-corps text-faint",
            appareil === "tactile"
              ? d.bas
                ? "items-center justify-between py-2"
                : "flex-col items-stretch py-4"
              : d.etroit
                ? "flex-wrap items-center justify-end py-3"
                : "items-center justify-between py-5",
          )}
        >
          {!d.etroit && appareil !== "tactile" ? <span>{footer}</span> : null}
          <span
            className={cn(
              "flex flex-wrap items-center gap-x-4 gap-y-1",
              appareil === "tactile" && !d.bas ? "justify-center" : "",
            )}
          >
            {appareil === "tactile" ? (
              phrase(piedDuMenu(appareil))
            ) : (
              <Reperes liste={piedDuMenu(appareil).filter((one) => one.fait !== "retour")} />
            )}
          </span>
          <button
            type="button"
            id="closeMenu"
            onClick={onClose}
            className={cn(
              "flex items-center justify-center gap-2",
              appareil === "tactile" ? "n3-action primary min-h-11" : "hover:text-indigo",
            )}
          >
            {appareil === "tactile" ? null : (
              <Touche>{appareil === "manette" ? "B" : "Échap"}</Touche>
            )}
            {sortieDite}
          </button>
        </footer>
      </div>
      <Picker
        picking={shell.picking}
        appareil={appareil}
        costume={{
          panel: "var(--panel)",
          ink: "var(--text)",
          edge: "var(--rule-bright)",
          accent: "var(--indigo)",
          // Sur la plaque des deux régies (couleurs de regie.css, rapports
          // calculés le 22 novembre 2026): --indigo, le signal, tient 6,35:1
          // la nuit et 8,55:1 le jour, donc il porte du texte; --muted, la
          // légende, 6,25:1 et 7,41:1. `lib/regie.test.ts` exige 4,5:1 sur
          // chaque surface.
          accentInk: "var(--indigo)",
          dim: "var(--muted)",
        }}
      />
      <PlaceDesSurcouches />
    </dialog>
  );
}

/**
 * Le fond: un dégradé et une onde lente.
 *
 * C'est la seule décoration de tout le projet, et elle est assumée: la règle qui
 * l'interdit ailleurs protège l'image du jeu, et il n'y a pas d'image ici. Les
 * couleurs viennent de la régie, donc l'onde suit la nuit et le jour.
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
