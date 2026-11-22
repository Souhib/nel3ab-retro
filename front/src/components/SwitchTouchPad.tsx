/**
 * La manette Pro à l'écran : salles Switch, Switch 2 et Xbox 360.
 *
 * La même trame pour les trois, et une face par console (`lib/faces`) : une
 * salle Xbox 360 écrit LB, LT, Back et Start et range A en bas, comme son
 * configurateur. Avant le 22 novembre 2026, ce pavé parlait Switch partout et
 * rangeait sa croix en grille, « gauche » à droite de « haut ».
 *
 * La place des touches vient du même calcul que la manette GameCube (`Pave`).
 * La capture du pointeur relâche chaque appui même quand le doigt sort de la
 * touche.
 */
import { useEffect } from "react";
import type { SwitchAxis, SwitchButton, SwitchInput } from "../media/switch";
import { SWITCH_FACE, faceOf } from "../lib/faces";
import { Pave } from "./TouchPad";

export function SwitchTouchPad({
  source,
  console: code,
  bar = 0,
  soundOff = false,
  onMenu,
  onLeave,
  onSound,
}: {
  source: SwitchInput;
  /** La console de la salle, pour nommer les touches comme sa manette. Une
   * salle Pro inconnue retombe sur la manette Pro de la Switch. */
  console?: string;
  /** La largeur d'une bande noire à côté de l'image, en pixels. */
  bar?: number;
  soundOff?: boolean;
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
  const found = faceOf(code);
  const face = found?.frame === "pro" ? found : SWITCH_FACE;
  const axes = (side: "l" | "r"): [SwitchAxis, SwitchAxis] =>
    side === "l" ? ["lx", "ly"] : ["rx", "ry"];
  return (
    <Pave<SwitchButton>
      face={face}
      bar={bar}
      press={(key) => source.touched.add(key)}
      release={(key) => source.touched.delete(key)}
      soundOff={soundOff}
      onSound={onSound}
      onMenu={onMenu}
      onLeave={onLeave}
      stickOf={(side) => {
        const [x, y] = axes(side);
        return {
          id: side === "l" ? "switchStickL" : "switchStickR",
          label: side === "l" ? "Stick gauche" : "Stick droit",
          // La course est le rayon du puits dessiné: le bord est le plafond.
          radius: (box) => box.width / 2,
          onPush: (px, py) => {
            source.pushed.set(x, px);
            source.pushed.set(y, py);
          },
          onRest: () => {
            source.pushed.delete(x);
            source.pushed.delete(y);
          },
        };
      }}
    />
  );
}
