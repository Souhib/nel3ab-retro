/** Pointer capture releases each touch even when the finger leaves the button. */
import { useEffect, useRef } from "react";
import { type SwitchAxis, type SwitchInput, type SwitchTarget } from "../media/switch";
import { stickFrom } from "../media/touch";
import { labels } from "../lib/switch-labels";

/** Une case du pavé: une cible tout-ou-rien, ou le puits d'un stick. */
type Case = SwitchTarget | { stick: "l" | "r" };

/* Les quatre boutons de direction par stick ont laissé la place à un PUITS.
 *
 * Ils disaient « poussé à fond » ou « rien »: sur un téléphone, un stick n'avait
 * donc que quatre positions, et aucune diagonale sans tenir deux touches à la
 * fois. Le puits occupe exactement les quatre cases qu'ils prenaient, en 2 sur 2,
 * et rend une valeur continue. Le format d'envoi la portait déjà. */
const groups: Case[][] = [
  ["L", "ZL", "MINUS", "LS", { stick: "l" }, "UP", "LEFT", "DOWN", "RIGHT"],
  ["R", "ZR", "PLUS", "RS", { stick: "r" }, "X", "Y", "B", "A"],
];
const short: Partial<Record<SwitchTarget, string>> = {
  MINUS: "−",
  PLUS: "+",
  UP: "↑",
  DOWN: "↓",
  LEFT: "←",
  RIGHT: "→",
  LS: "L3",
  RS: "R3",
};

/** Le puits d'un stick, poussé au pouce.
 *
 * Par des références et non par un état: la valeur est relue à chaque mouvement
 * du doigt, et rendre la page à chaque pixel ferait ramer ce qu'on essaie de
 * conduire. Le rond qui suit le pouce est écrit directement dans son style,
 * parce que c'est du dessin et pas de la donnée. Même choix que `TouchPad`. */
function Puits({ source, side }: { source: SwitchInput; side: "l" | "r" }) {
  const well = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const axisX: SwitchAxis = side === "l" ? "lx" : "rx";
  const axisY: SwitchAxis = side === "l" ? "ly" : "ry";

  const repos = () => {
    source.pushed.delete(axisX);
    source.pushed.delete(axisY);
    if (knob.current) knob.current.style.transform = "translate(0px, 0px)";
  };
  // Un onglet qu'on quitte lâche le stick. Sans ça, partir en tenant une
  // direction laisse le personnage courir tout seul.
  useEffect(() => repos);

  const bouge = (event: React.PointerEvent) => {
    const box = well.current?.getBoundingClientRect();
    if (!box) return;
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const rayon = box.width / 2;
    const poussee = stickFrom(centre, { x: event.clientX, y: event.clientY }, rayon);
    source.pushed.set(axisX, poussee.x);
    source.pushed.set(axisY, poussee.y);
    if (knob.current) {
      // `stickFrom` rend déjà `y` vers le HAUT, comme une manette; l'écran, lui,
      // compte vers le bas, d'où le signe qu'on remet ici pour le dessin.
      const portee = rayon * 0.5;
      knob.current.style.transform = `translate(${poussee.x * portee}px, ${-poussee.y * portee}px)`;
    }
  };

  return (
    <div
      ref={well}
      id={side === "l" ? "switchStickL" : "switchStickR"}
      className="n3-switch-touch-well"
      aria-label={side === "l" ? "Stick gauche" : "Stick droit"}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        bouge(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 0 && event.pointerType === "mouse") return;
        bouge(event);
      }}
      onPointerUp={repos}
      onPointerCancel={repos}
      onLostPointerCapture={repos}
    >
      <div ref={knob} className="n3-switch-touch-knob" />
    </div>
  );
}

export function SwitchTouchPad({
  source,
  onMenu,
  onLeave,
  onSound,
}: {
  source: SwitchInput;
  onMenu: () => void;
  onLeave: () => void;
  onSound: () => void;
}) {
  useEffect(() => {
    const release = () => {
      source.touched.clear();
      source.pushed.clear();
    };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", release);
    return () => {
      release();
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", release);
    };
  }, [source]);
  return (
    <div className="n3-switch-touch" aria-label="Manette Switch tactile">
      {groups.map((cases, side) => (
        <div key={side === 0 ? "gauche" : "droite"} className="n3-switch-touch-side">
          {cases.map((une) =>
            typeof une === "object" ? (
              <Puits key={`stick-${une.stick}`} source={source} side={une.stick} />
            ) : (
              <button
                key={une}
                aria-label={labels[une]}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  source.touched.add(une);
                }}
                onPointerUp={() => source.touched.delete(une)}
                onPointerCancel={() => source.touched.delete(une)}
                onLostPointerCapture={() => source.touched.delete(une)}
              >
                {short[une] ?? une}
              </button>
            ),
          )}
        </div>
      ))}
      <div className="n3-switch-touch-tools">
        <button onClick={onMenu}>menu</button>
        <button onClick={onSound}>son</button>
        <button onClick={onLeave}>masquer</button>
      </div>
    </div>
  );
}
