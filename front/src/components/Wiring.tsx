/**
 * Les deux manettes, côte à côte, allumées en direct.
 *
 * À gauche ce que le JEU reçoit, à droite ce qu'on APPUIE. L'écart entre les
 * deux est toute l'information: une touche qui s'allume à droite et pas à gauche
 * dit que la correspondance manque, ce qu'aucun tableau de libellés ne montre
 * aussi vite.
 */
import { useEffect, useRef, useState } from "react";

import { cn } from "../lib/cn";
import { paintBench } from "../lib/bench";
import { EMULATED, STANDARD_PAD } from "../lib/padmap";
import type { Pad } from "../lib/saves";
import { downward, heldOn, upward, type Tilt } from "../lib/wiring";
import { BUTTON, MOVED, readPad, type ButtonName } from "../media/pad";
import type { InputState } from "../media/input";
import { Bench } from "./Bench";
import { PadMapView } from "./PadMap";

/** Ce qui est allumé sur le schéma de la manette ÉMULÉE.
 *
 * Passe par `readPad`, celui-là même que la boucle d'entrée utilise: deux
 * lectures de la même manette finiraient par ne pas s'allumer au même moment, et
 * l'écran perdrait ce pour quoi on l'ouvre.
 *
 * Fait pour être appelé dans la boucle d'affichage, qui lit une seule fois.
 */

export function Wiring({
  state,
  pad,
  onUse,
  className,
}: {
  state: InputState;
  /** La manette que la SALLE présente. Le schéma de gauche part de là. */
  pad: Pad;
  onUse: (index: number | null) => void;
  className?: string;
}) {
  const held = state.pads.find((one) => one.index === state.using) ?? null;
  const room = useRef<HTMLDivElement | null>(null);
  /**
   * La manette émulée qu'on REGARDE, qui n'est pas forcément celle qui joue.
   *
   * Changer ici ne change rien à la salle, et c'est délibéré: la manette que
   * Dolphin présente est un réglage de la SALLE, qui fait redémarrer la partie de
   * tout le monde. Ce sélecteur ne fait que regarder.
   *
   * Il n'y a d'ailleurs rien à changer. La page envoie toujours la même trame; la
   * GameCube, la Wiimote et la guitare en sont trois LECTURES. Tenir un bouton et
   * basculer entre les trois montre ce qu'il devient dans chacune, sans qu'aucune
   * assignation ne bouge — ce qu'aucun tableau ne peut faire voir.
   */
  const [looking, setLooking] = useState<Pad>(pad);
  useEffect(() => setLooking(pad), [pad]);
  const emulated = EMULATED[looking] ?? EMULATED[0]!;

  // La coque DROITE, dessinée d'après ce qu'on TIENT. C'est la manette
  // générique du banc d'essai — la même toujours, comme sur hardwaretester —
  // avec ses indices bruts aux places de la norme. Les coques par marque
  // (`DUALSHOCK`, `XBOX`) existent encore dans les données, mais l'écran
  // montre UNE manette à droite, quelle que soit celle qu'on branche: c'est le
  // point du banc d'essai, on reconnaît la sienne au comportement.
  const physical = STANDARD_PAD;

  // La boucle qui allume ET qui incline. Hors de React, et arrêtée quand l'écran
  // se ferme: soixante lectures par seconde d'un objet déjà en mémoire ne
  // coûtent rien, soixante rendus React en coûteraient.
  useEffect(() => {
    const at = state.using;
    if (at === null) return;
    let alive = true;

    /** Incline un stick: le capot suit l'axe, la garde reste en place. C'est ce
     * qui fait un banc d'essai — on pousse, et on le VOIT. */
    const tilt = (root: Element, tag: string, push: Tilt) => {
      for (const piece of root.querySelectorAll<SVGGElement>(`[data-stick="${tag}"]`)) {
        const body = piece.querySelector<SVGGElement>(".n3-stick-body");
        if (!body) continue;
        const travel = Number(body.dataset["drive"] ?? 0);
        const dx = Math.max(-1, Math.min(1, push.along)) * travel;
        const dy = Math.max(-1, Math.min(1, push.down)) * travel;
        body.setAttribute("transform", `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
      }
    };

    const paint = () => {
      if (!alive) return;
      requestAnimationFrame(paint);
      const live = navigator.getGamepads?.()[at];
      const root = room.current;
      if (!root) return;
      if (!live) {
        for (const piece of root.querySelectorAll<SVGGElement>("[data-part]")) {
          piece.dataset["lit"] = "non";
        }
        for (const body of root.querySelectorAll<SVGGElement>(".n3-stick-body")) {
          body.removeAttribute("transform");
        }
        return;
      }
      const reading = readPad(live, state.profile);
      const on = new Set(heldOn(live, state.profile));
      for (const name of Object.keys(BUTTON) as ButtonName[]) {
        if ((reading.buttons & BUTTON[name]) !== 0) on.add(name);
      }
      if (Math.abs(reading.x) > MOVED || Math.abs(reading.y) > MOVED) on.add("x");
      if (Math.abs(reading.cx) > MOVED || Math.abs(reading.cy) > MOVED) on.add("cx");
      for (const piece of root.querySelectorAll<SVGGElement>("[data-part]")) {
        piece.dataset["lit"] = on.has(piece.dataset["part"] ?? "") ? "oui" : "non";
      }
      const axes = live.axes ?? [];
      // Le côté émulé s'incline de la lecture du profil (x, cx); le côté
      // physique des axes du navigateur (a0: stick gauche, a2: droit).
      //
      // Les deux ne comptent PAS le vertical dans le même sens, et c'est la
      // seule chose à savoir ici: `readPad` rend ce qui part sur le fil, où le
      // haut est positif, tandis que le navigateur et SVG comptent vers le bas.
      // Nommer le repère à l'appel est ce qui empêche de les confondre.
      tilt(root, "x", upward(reading.x, reading.y));
      tilt(root, "cx", upward(reading.cx, reading.cy));
      tilt(root, "a0", downward(axes[0] ?? 0, axes[1] ?? 0));
      tilt(root, "a2", downward(axes[2] ?? 0, axes[3] ?? 0));

      // Le banc, en chiffres bruts: ce que le navigateur annonce, sans le
      // traduire. C'est ce qu'on lit quand le schéma ne suffit pas.
      paintBench(root, live);
    };
    requestAnimationFrame(paint);
    return () => {
      alive = false;
    };
  }, [state.using, state.profile]);

  return (
    <div ref={room} className={cn("flex flex-col gap-3", className)}>
      {state.pads.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] uppercase tracking-[0.16em] text-faint">manette lue</span>
          {state.pads.map((one) => (
            <button
              key={one.index}
              type="button"
              id={`wire-${one.index}`}
              onClick={() => onUse(one.index)}
              title={one.id}
              className={cn(
                "max-w-[14rem] truncate border px-2 py-0.5 text-[11px]",
                state.using === one.index
                  ? "border-indigo text-indigo"
                  : "border-rule text-muted hover:border-rule-bright",
              )}
            >
              {one.id.split("(")[0]?.trim() || `manette ${one.index + 1}`}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] uppercase tracking-[0.16em] text-faint">côté Dolphin</span>
        {EMULATED.map((map, at) => (
          <button
            key={map.id}
            type="button"
            id={`emulated-${map.id}`}
            onClick={() => setLooking(at as Pad)}
            className={cn(
              "flex items-center gap-1.5 border px-2 py-0.5 text-[11px]",
              looking === at
                ? "border-indigo text-indigo"
                : "border-rule text-muted hover:border-rule-bright",
            )}
          >
            {map.name}
            {/* Celle qui joue VRAIMENT, marquée. Sans ça on croirait avoir changé
                la salle en changeant de schéma. */}
            {at === pad ? <span className="text-[9px] text-good">en salle</span> : null}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <PadMapView
          map={emulated}
          title="ce que le jeu reçoit"
          note={looking === pad ? emulated.name : `${emulated.name} · aperçu`}
        />
        <PadMapView
          map={physical}
          title="ce que tu appuies"
          note={held ? held.id.split("(")[0]?.trim() || held.id : "aucune manette"}
        />
      </div>

      <p className="text-[11px] text-muted">
        {looking !== pad
          ? "aperçu: la salle présente une autre manette. Ce que tu appuies ne change pas, seule sa LECTURE change."
          : state.padLayout === "unknown"
            ? "cette manette n'annonce pas de disposition standard: le schéma de droite ne peut pas être juste. Ses touches s'allument quand même, à leur indice."
            : "appuie: la pièce s'allume à droite, et son équivalent à gauche. Une pièce qui s'allume seulement à droite n'est pas encore assignée."}
      </p>

      {/* Les chiffres, sous les deux schémas et sur toute la largeur. Un schéma
          répond à « est-ce que ça marche »; ces nombres-là répondent à « pourquoi
          ça marche mal », et ils ne tiennent pas dans une demi-colonne. */}
      {held ? (
        <Bench
          name={held.id.split("(")[0]?.trim() || held.id}
          id={held.id}
          index={state.using}
          layout={state.padLayout ?? "inconnue"}
          buttons={held.buttons}
          axes={held.axes}
          className="border-t border-rule pt-3"
        />
      ) : null}
    </div>
  );
}
