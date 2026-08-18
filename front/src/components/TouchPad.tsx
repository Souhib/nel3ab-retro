/**
 * La manette à l'écran, pour jouer depuis un téléphone.
 *
 * # Ce qu'elle dessine, et pourquoi dans cet ordre
 *
 * Une GameCube tient dans deux pouces: le stick à gauche, les quatre boutons à
 * droite, les gâchettes en haut, Start au milieu. La croix directionnelle est
 * volontairement petite et en bas à gauche, parce qu'elle ne sert presque
 * jamais en jeu et souvent dans les menus.
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

/** Le rayon du stick, en pixels. Assez grand pour un pouce, assez petit pour
 * tenir sur un écran de téléphone tenu en travers. */
const STICK = 56;

export function TouchPad({ touch, onLeave }: { touch: Touch; onLeave: () => void }) {
  const knob = useRef<HTMLDivElement>(null);
  const well = useRef<HTMLDivElement>(null);

  // Un onglet qu'on quitte lâche tout. Sans ça, passer sur une autre
  // application en tenant une direction laisse le personnage courir.
  useEffect(() => {
    const drop = () => {
      touch.releaseAll();
      if (knob.current) knob.current.style.transform = "translate(0px, 0px)";
    };
    document.addEventListener("visibilitychange", drop);
    window.addEventListener("blur", drop);
    return () => {
      document.removeEventListener("visibilitychange", drop);
      window.removeEventListener("blur", drop);
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
    const pushed = stickFrom(centre, { x: event.clientX, y: event.clientY }, STICK);
    touch.push(pushed.x, pushed.y);
    if (knob.current) {
      // Le pouce voit où il pousse. Écrit directement dans le style plutôt que
      // par un état: c'est du dessin, pas de la donnée.
      knob.current.style.transform = `translate(${pushed.x * STICK}px, ${-pushed.y * STICK}px)`;
    }
  };

  return (
    <div
      id="touchpad"
      className="pointer-events-none absolute inset-0 z-30 select-none"
      style={{ touchAction: "none" }}
    >
      {/* Le stick, sous le pouce gauche. */}
      <div
        ref={well}
        id="touchStick"
        className="pointer-events-auto absolute bottom-6 left-6 flex items-center justify-center rounded-full border border-rule-bright/70 bg-panel/50"
        style={{ width: STICK * 2, height: STICK * 2, touchAction: "none" }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          move(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 0 && event.pointerType === "mouse") return;
          move(event);
        }}
        onPointerUp={() => {
          touch.push(0, 0);
          if (knob.current) knob.current.style.transform = "translate(0px, 0px)";
        }}
        onPointerCancel={() => {
          touch.push(0, 0);
          if (knob.current) knob.current.style.transform = "translate(0px, 0px)";
        }}
      >
        <div
          ref={knob}
          className="h-12 w-12 rounded-full border border-indigo/70 bg-indigo/30 transition-transform duration-75"
        />
      </div>

      {/* La croix, plus petite: elle sert surtout dans les menus. */}
      <div className="pointer-events-auto absolute bottom-8 left-44 grid grid-cols-3 grid-rows-3 gap-1">
        <Key at="col-start-2" name="D_UP" label="▲" hold={hold} />
        <Key at="col-start-1 row-start-2" name="D_LEFT" label="◀" hold={hold} />
        <Key at="col-start-3 row-start-2" name="D_RIGHT" label="▶" hold={hold} />
        <Key at="col-start-2 row-start-3" name="D_DOWN" label="▼" hold={hold} />
      </div>

      {/* Les quatre boutons, sous le pouce droit, disposés comme sur la console. */}
      <div className="pointer-events-auto absolute right-8 bottom-8 grid grid-cols-3 grid-rows-3 gap-1">
        <Key at="col-start-2 row-start-1" name="Y" label="Y" hold={hold} />
        <Key at="col-start-1 row-start-2" name="X" label="X" hold={hold} />
        <Key at="col-start-3 row-start-2" name="B" label="B" hold={hold} />
        <Key at="col-start-2 row-start-3" name="A" label="A" big hold={hold} />
      </div>

      {/* Les gâchettes, là où les index tombent. */}
      <div className="pointer-events-auto absolute top-4 left-6 flex gap-2">
        <Key name="L" label="L" wide hold={hold} />
      </div>
      <div className="pointer-events-auto absolute top-4 right-6 flex gap-2">
        <Key name="Z" label="Z" wide hold={hold} />
        <Key name="R" label="R" wide hold={hold} />
      </div>

      <div className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
        <Key name="START" label="START" wide hold={hold} />
        <button
          type="button"
          id="hideTouch"
          onClick={onLeave}
          className="rounded border border-rule px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-faint"
        >
          cacher
        </button>
      </div>
    </div>
  );
}

/** Un bouton, dessiné et tenu.
 *
 * L'état pressé vient de `:active`, donc appuyer ne provoque aucun rendu. C'est
 * la moitié invisible de « React ne touche pas au chemin des commandes ».
 */
function Key({
  name,
  label,
  at = "",
  big = false,
  wide = false,
  hold,
}: {
  name: ButtonName;
  label: string;
  at?: string;
  big?: boolean;
  wide?: boolean;
  hold: (button: ButtonName) => Record<string, unknown>;
}) {
  const size = big
    ? "h-16 w-16 text-[17px]"
    : wide
      ? "h-11 px-4 text-[13px]"
      : "h-12 w-12 text-[15px]";
  return (
    <button
      type="button"
      id={`touch-${name}`}
      {...hold(name)}
      className={`${at} ${size} rounded-full border border-rule-bright/70 bg-panel/70 font-mono text-text active:border-indigo active:bg-indigo/40`}
      style={{ touchAction: "none" }}
    >
      {label}
    </button>
  );
}
