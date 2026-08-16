/**
 * The games, and the two clicks it takes to change one.
 *
 * Changing the game stops the emulator: whatever everybody else in the room was
 * playing is gone, with no save state and no undo. So the first click arms and
 * the second boots, and the arming forgets itself after five seconds. That is
 * the same shape as taking somebody's pad, for the same reason.
 */
import { useEffect, useState } from "react";
import type { Game } from "../client";
import { cn } from "../lib/cn";

const ARMED_FOR_MS = 5000;

export function Library({
  games,
  running,
  canChoose,
  onChoose,
}: {
  games: Game[];
  running: number | null;
  canChoose: boolean;
  onChoose: (index: number) => boolean;
}) {
  const [armed, setArmed] = useState<number | null>(null);
  const [booting, setBooting] = useState(false);

  useEffect(() => {
    if (armed === null) return;
    const timer = window.setTimeout(() => setArmed(null), ARMED_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const click = (index: number) => {
    if (index === running || booting) return;
    if (armed !== index) {
      setArmed(index);
      return;
    }
    setArmed(null);
    if (onChoose(index)) setBooting(true);
  };

  if (games.length === 0) {
    return <p className="text-[12px] text-faint">aucun jeu dans la bibliothèque</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {games.map((game) => {
        const isRunning = game.index === running;
        const isArmed = game.index === armed;
        return (
          <button
            key={game.index}
            id={`game${game.index}`}
            type="button"
            // Read by the browser test that pins "one click arms, the second
            // boots". A class name would have said the same thing until a style
            // changed under it.
            data-armed={isArmed}
            disabled={isRunning || booting || !canChoose}
            onClick={() => click(game.index)}
            className={cn(
              "flex items-center gap-2 border px-2.5 py-1.5 text-left text-[12px] transition-colors",
              isRunning && "border-indigo/50 bg-indigo/10 text-indigo",
              isArmed && "border-alert bg-alert/10 text-alert",
              !isRunning &&
                !isArmed &&
                "border-rule text-muted hover:border-rule-bright hover:text-text",
              !canChoose && !isRunning && "opacity-40",
            )}
          >
            <span className="font-mono text-[10px] text-faint">{isRunning ? "▶" : "·"}</span>
            <span className="truncate">
              {isArmed ? `${game.name} — quitter la partie ?` : game.name}
            </span>
          </button>
        );
      })}
      <p className="text-[11px] text-faint">
        {booting
          ? "le jeu démarre, la page se reconnecte toute seule"
          : !canChoose
            ? "prends une manette pour changer de jeu"
            : armed === null
              ? "changer de jeu arrête la partie en cours"
              : "reclique pour confirmer"}
      </p>
    </div>
  );
}
