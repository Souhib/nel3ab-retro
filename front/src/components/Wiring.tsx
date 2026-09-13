/** Deux lectures du même appui: la correspondance et les indices physiques. */
import { useEffect, useRef } from "react";
import { modelSnapshot } from "../media/lesson";
import { identityOf } from "../media/describe";
import { EMULATED, physicalMap } from "../lib/padmap";
import type { Pad } from "../lib/saves";
import { paintWiring } from "../lib/wiring";
import type { InputState } from "../media/input";
import { controlsFor, type ControlKey } from "../media/pad";
import { PadMapView } from "./PadMap";

export function Wiring({
  state,
  pad,
  selected,
  onSelect,
}: {
  state: InputState;
  pad: Pad;
  selected: ControlKey;
  onSelect: (key: ControlKey) => void;
}) {
  const room = useRef<HTMLDivElement>(null);
  const held = state.pads.find((one) => one.index === state.using) ?? null;
  const identity = identityOf(state);
  const emulated = EMULATED[pad]!;
  const physical = physicalMap(identity);
  const pieceFor = (key: string) => (key === "y" ? "x" : key === "cy" ? "cx" : key);
  const waiting = state.lesson?.control ?? state.capturing?.control;
  useEffect(() => {
    let frame = 0;
    const paint = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const live = state.using === null ? null : (pads[state.using] ?? null);
      const values = live ? modelSnapshot(pads, live) : null;
      if (room.current)
        paintWiring(
          room.current,
          values && live
            ? {
                buttons: values.buttons.map((value, index) => ({
                  value,
                  pressed: pads.some(
                    (candidate) => candidate?.id === live.id && candidate.buttons[index]?.pressed,
                  ),
                  touched: value > 0,
                })),
                axes: values.axes,
                timestamp: Math.max(
                  ...[...pads]
                    .filter((one) => one?.id === live.id)
                    .map((one) => one?.timestamp ?? 0),
                ),
              }
            : null,
          state.profile,
        );
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [state.using, state.profile]);

  return (
    <div ref={room} className="flex min-w-0 flex-col gap-4">
      <div className="n3-controller-pair">
        <PadMapView
          map={emulated}
          title="Après correspondance"
          note={emulated.name}
          selected={pieceFor(selected)}
          waiting={waiting ? pieceFor(waiting) : null}
          labels={Object.fromEntries(controlsFor("wii", pad).map((one) => [one.key, one.label]))}
          onSelect={(key) => onSelect(key as ControlKey)}
        />
        <PadMapView
          map={physical}
          title="Ta manette"
          note={identity?.name ?? "En attente de connexion"}
          rawLabels={!identity?.standard}
        />
      </div>
      <p className="text-corps leading-relaxed text-muted">
        {held
          ? identity?.standard
            ? "Appuie pour tester. À droite, ton appui ; à gauche, la commande associée. Clique une commande à gauche pour la modifier."
            : "L’adaptateur ne décrit pas la position de ses boutons. À droite, les indices bruts servent de repères ; le diagnostic montre toutes ses entrées."
          : "Branche une manette, puis appuie sur un bouton pour la faire apparaître. Tu peux aussi configurer le clavier."}
      </p>
    </div>
  );
}
