/**
 * La manette à l'écran, pour jouer depuis un téléphone.
 *
 * # La première version se marchait dessus
 *
 * Elle plaçait ses groupes à des distances FIXES du bord: la croix à 176 pixels
 * de la gauche, les quatre boutons à 32 de la droite. Sur un ordinateur ça
 * tenait; sur un vrai téléphone tenu en travers, vu le 18 août 2026, la zone de
 * jeu ne faisait que quelques centaines de pixels et les deux groupes se
 * recouvraient au milieu de l'image, par-dessus le texte du jeu.
 *
 * Tout est donc dimensionné en `vmin` maintenant, avec des bornes: un bouton ne
 * descend jamais sous 34 pixels — la taille d'un doigt — et ne dépasse jamais 56,
 * où il deviendrait une cible pour la souris. Les groupes sont ancrés aux QUATRE
 * COINS, et le milieu reste libre parce que c'est là qu'est le jeu.
 *
 * # Ce qu'elle dessine, et pourquoi là
 *
 * Les deux pouces tiennent les coins du bas: le stick à gauche, les quatre
 * boutons à droite, comme sur la console. La croix directionnelle monte à gauche
 * au-dessus du stick, parce qu'elle ne sert presque jamais en jeu et souvent
 * dans les menus, et que le pouce gauche atteint les deux. Les gâchettes sont
 * aux coins du haut, là où les index tombent.
 *
 * # Elle ne repasse pas par React
 *
 * Les événements de pointeur écrivent dans le module `media/touch`, que la
 * boucle d'entrée lit cent fois par seconde. Rien ici ne provoque de rendu en
 * jouant: un rendu par appui ferait exactement ce que ce projet interdit depuis
 * le début, remettre React sur le chemin des commandes.
 *
 * # Les détails qui font la différence entre jouable et pénible
 *
 * - `touch-action: none` partout, sinon un glissement du pouce fait défiler la
 *   page au lieu de pousser le stick;
 * - la capture du pointeur sur le stick, pour que le doigt puisse sortir du
 *   cercle sans que le mouvement s'arrête net;
 * - `pointercancel` relâche, parce qu'un appel entrant ou une notification
 *   annule les pointeurs et laisserait sinon un bouton enfoncé pour toujours;
 * - aucun retour visuel calculé en JavaScript: l'état pressé est du CSS
 *   (`:active`), donc il coûte zéro rendu.
 */
import { useEffect, useRef } from "react";
import type { ButtonName } from "../media/pad";
import { stickFrom, type Touch } from "../media/touch";

/** Le rayon du stick, en pixels d'écran.
 *
 * Lu une fois au montage plutôt que calculé en CSS, parce que la conversion des
 * coordonnées du pointeur en position de stick en a besoin comme d'un nombre. Le
 * `clamp` reproduit ce que ferait la feuille de style: un pouce a besoin d'au
 * moins 44 pixels de course, et au-delà de 68 le stick mange l'image.
 */
function stickRadius(): number {
  const smaller = Math.min(window.innerWidth, window.innerHeight);
  return Math.max(44, Math.min(68, smaller * 0.17));
}

export function TouchPad({
  touch,
  onLeave,
  onColumn,
}: {
  touch: Touch;
  /** Cacher la manette. */
  onLeave: () => void;
  /** Montrer ou cacher la colonne de droite.
   *
   * Ici plutôt que seulement dans le menu: sur un téléphone la colonne est
   * repliée d'office, et sans ce bouton il faudrait connaître Échap pour la
   * retrouver. Personne ne tape Échap sur un téléphone. */
  onColumn: () => void;
}) {
  const knob = useRef<HTMLDivElement>(null);
  const well = useRef<HTMLDivElement>(null);
  const radius = useRef(stickRadius());

  // Un onglet qu'on quitte lâche tout. Sans ça, passer sur une autre
  // application en tenant une direction laisse le personnage courir.
  useEffect(() => {
    const drop = () => {
      touch.releaseAll();
      if (knob.current) knob.current.style.transform = "translate(0px, 0px)";
    };
    const resize = () => {
      radius.current = stickRadius();
    };
    document.addEventListener("visibilitychange", drop);
    window.addEventListener("blur", drop);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("visibilitychange", drop);
      window.removeEventListener("blur", drop);
      window.removeEventListener("resize", resize);
      drop();
    };
  }, [touch]);

  const hold = (button: ButtonName) => ({
    onPointerDown: (event: React.PointerEvent) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      touch.press(button);
    },
    onPointerUp: () => touch.release(button),
    onPointerCancel: () => touch.release(button),
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  });

  const move = (event: React.PointerEvent) => {
    const box = well.current?.getBoundingClientRect();
    if (!box) return;
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const pushed = stickFrom(centre, { x: event.clientX, y: event.clientY }, radius.current);
    touch.push(pushed.x, pushed.y);
    if (knob.current) {
      // Le pouce voit où il pousse. Écrit directement dans le style plutôt que
      // par un état: c'est du dessin, pas de la donnée.
      const reach = radius.current * 0.55;
      knob.current.style.transform = `translate(${pushed.x * reach}px, ${-pushed.y * reach}px)`;
    }
  };

  const rest = () => {
    touch.push(0, 0);
    if (knob.current) knob.current.style.transform = "translate(0px, 0px)";
  };

  return (
    <div
      id="touchpad"
      className="pointer-events-none absolute inset-0 z-30 select-none"
      style={{ touchAction: "none" }}
    >
      {/* Les gâchettes, aux coins du haut, là où les index tombent. */}
      <div className="pointer-events-auto absolute top-2 left-2">
        <Key name="L" label="L" wide hold={hold} />
      </div>
      <div className="pointer-events-auto absolute top-2 right-2 flex gap-2">
        <Key name="Z" label="Z" wide hold={hold} />
        <Key name="R" label="R" wide hold={hold} />
      </div>

      {/* Start et les deux gestes de la page, en haut au milieu et discrets:
          ils ne se cherchent qu'une fois, et ils ne doivent pas se trouver
          sous un pouce qui joue. */}
      <div className="pointer-events-auto absolute top-2 left-1/2 flex -translate-x-1/2 gap-2">
        <Key name="START" label="START" wide hold={hold} />
        <Small id="showColumn" label="menu" onClick={onColumn} />
        <Small id="hideTouch" label="cacher" onClick={onLeave} />
      </div>

      {/* La croix, au-dessus du stick: le pouce gauche atteint les deux, et
          elle sert surtout dans les menus. */}
      <div
        className="pointer-events-auto absolute left-2 grid grid-cols-3 grid-rows-3 gap-0.5"
        style={{ bottom: "calc(var(--n3-stick) * 2 + 1.25rem)" }}
      >
        <Key at="col-start-2" name="D_UP" label="▲" small hold={hold} />
        <Key at="col-start-1 row-start-2" name="D_LEFT" label="◀" small hold={hold} />
        <Key at="col-start-3 row-start-2" name="D_RIGHT" label="▶" small hold={hold} />
        <Key at="col-start-2 row-start-3" name="D_DOWN" label="▼" small hold={hold} />
      </div>

      {/* Le stick, sous le pouce gauche. */}
      <div
        ref={well}
        id="touchStick"
        className="pointer-events-auto absolute bottom-3 left-2 flex items-center justify-center rounded-full border border-rule-bright/70 bg-panel/40"
        style={{
          width: "calc(var(--n3-stick) * 2)",
          height: "calc(var(--n3-stick) * 2)",
          touchAction: "none",
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          move(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 0 && event.pointerType === "mouse") return;
          move(event);
        }}
        onPointerUp={rest}
        onPointerCancel={rest}
      >
        <div
          ref={knob}
          className="rounded-full border border-indigo/70 bg-indigo/30 transition-transform duration-75"
          style={{ width: "var(--n3-stick)", height: "var(--n3-stick)" }}
        />
      </div>

      {/* Les quatre boutons, sous le pouce droit, disposés comme sur la console:
          A gros et en bas, les trois autres autour. */}
      <div className="pointer-events-auto absolute right-3 bottom-3 grid grid-cols-3 grid-rows-3 gap-1">
        <Key at="col-start-2 row-start-1" name="Y" label="Y" hold={hold} />
        <Key at="col-start-1 row-start-2" name="X" label="X" hold={hold} />
        <Key at="col-start-3 row-start-2" name="B" label="B" hold={hold} />
        <Key at="col-start-2 row-start-3" name="A" label="A" big hold={hold} />
      </div>
    </div>
  );
}

/** Un bouton de manette, dessiné et tenu.
 *
 * L'état pressé vient de `:active`, donc appuyer ne provoque aucun rendu. C'est
 * la moitié invisible de « React ne touche pas au chemin des commandes ».
 */
function Key({
  name,
  label,
  at = "",
  big = false,
  small = false,
  wide = false,
  hold,
}: {
  name: ButtonName;
  label: string;
  at?: string;
  big?: boolean;
  small?: boolean;
  wide?: boolean;
  hold: (button: ButtonName) => Record<string, unknown>;
}) {
  const size = big
    ? { width: "var(--n3-key-big)", height: "var(--n3-key-big)" }
    : small
      ? { width: "var(--n3-key-small)", height: "var(--n3-key-small)" }
      : { width: "var(--n3-key)", height: "var(--n3-key)" };
  return (
    <button
      type="button"
      id={`touch-${name}`}
      {...hold(name)}
      className={`${at} flex items-center justify-center rounded-full border border-rule-bright/70 bg-panel/70 font-mono text-[13px] text-text active:border-indigo active:bg-indigo/40`}
      style={{
        ...(wide ? { height: "var(--n3-key)", padding: "0 0.9rem" } : size),
        touchAction: "none",
      }}
    >
      {label}
    </button>
  );
}

/** Un geste de la PAGE et non de la manette: plus petit, plus terne, et sans
 * capture de pointeur. Les distinguer à l'oeil évite de cacher la manette en
 * visant Start. */
function Small({ id, label, onClick }: { id: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      className="rounded-full border border-rule px-3 text-[11px] uppercase tracking-[0.14em] text-faint"
      style={{ height: "var(--n3-key)", touchAction: "none" }}
    >
      {label}
    </button>
  );
}
