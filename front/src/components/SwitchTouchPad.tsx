/** Pointer capture releases each touch even when the finger leaves the button. */
import { useEffect } from "react";
import { type SwitchInput, type SwitchTarget } from "../media/switch";
import { labels } from "../lib/switch-labels";
const groups: SwitchTarget[][] = [
  ["L", "ZL", "MINUS", "ly+", "lx-", "ly-", "lx+", "UP", "LEFT", "DOWN", "RIGHT", "LS"],
  ["R", "ZR", "PLUS", "X", "Y", "B", "A", "ry+", "rx-", "ry-", "rx+", "RS"],
];
const short: Partial<Record<SwitchTarget, string>> = {
  MINUS: "−",
  PLUS: "+",
  "ly+": "L ↑",
  "ly-": "L ↓",
  "lx-": "L ←",
  "lx+": "L →",
  "ry+": "R ↑",
  "ry-": "R ↓",
  "rx-": "R ←",
  "rx+": "R →",
  UP: "↑",
  DOWN: "↓",
  LEFT: "←",
  RIGHT: "→",
  LS: "L3",
  RS: "R3",
};
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
    const release = () => source.touched.clear();
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
      {groups.map((targets) => (
        <div key={targets[0]} className="n3-switch-touch-side">
          {targets.map((target) => (
            <button
              key={target}
              aria-label={labels[target]}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                source.touched.add(target);
              }}
              onPointerUp={() => source.touched.delete(target)}
              onPointerCancel={() => source.touched.delete(target)}
              onLostPointerCapture={() => source.touched.delete(target)}
            >
              {short[target] ?? target}
            </button>
          ))}
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
