/**
 * Les quatre prises, et qui est assis dedans.
 *
 * Deux sources, et elles ne se recouvrent pas. Qu'une prise soit TENUE vient du
 * worker, parce que c'est lui qui applique les boutons et donc le seul qui
 * puisse avoir raison là-dessus. Le NOM à côté vient du plan de contrôle, ce qui
 * explique qu'une salle dont le plan de contrôle est arrêté affiche « occupée »
 * plutôt que rien (ADR D12).
 *
 * Une prise est un bloc numéroté et pas un avatar: les ports sont numérotés sur
 * la console elle-même, et le joueur 2 est le joueur 2 parce que le tuyau
 * s'appelle `p2` (ADR D3). Plus joli montrerait une chose que la machine ne sait
 * pas.
 */
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";

/** Combien de temps l'armement se souvient de lui-même. */
const ARMED_FOR_MS = 5000;

export function Seats({
  players,
  busy,
  names,
  mine,
  displaced,
  onTake,
}: {
  players: number;
  busy: boolean[];
  names: Map<number, string>;
  mine: number | null;
  displaced: boolean;
  onTake: (port: number) => void;
}) {
  const ports = Array.from({ length: players }, (_, slot) => slot + 1);
  const [armed, setArmed] = useState<number | null>(null);

  useEffect(() => {
    if (armed === null) return;
    const timer = window.setTimeout(() => setArmed(null), ARMED_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  /* Un clic sur une prise libre ne prend rien à personne, donc il agit tout de
     suite. Un clic sur une prise tenue arrête la partie de quelqu'un d'autre,
     donc il arme et n'agit qu'au second. La différence n'est pas une question de
     symétrie: l'un des deux gestes se voit sur l'écran d'un autre. */
  const click = (port: number) => {
    if (port === mine) return;
    if (!busy[port - 1]) return onTake(port);
    if (armed !== port) return setArmed(port);
    setArmed(null);
    onTake(port);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* `id` et `data-state` sont lus par les pilotes de navigateur. Une classe
          ou un attribut `title` disait la même chose jusqu'au jour où un style
          change sous eux, ce qui est arrivé. */}
      <div id="ports" className="grid grid-cols-4 gap-1.5">
        {ports.map((port) => {
          const isMine = port === mine;
          const held = busy[port - 1] ?? false;
          const isArmed = port === armed;
          const name = names.get(port);
          return (
            <button
              key={port}
              type="button"
              id={`port${port}`}
              data-state={isMine ? "mine" : held ? "busy" : "free"}
              data-armed={isArmed}
              disabled={isMine}
              onClick={() => click(port)}
              title={
                isMine
                  ? "c'est la tienne"
                  : held
                    ? "prendre cette manette arrête la partie de celui qui la tient"
                    : "prendre cette manette"
              }
              className={cn(
                "flex flex-col gap-1 border px-2 py-1.5 text-left transition-colors",
                isMine && "border-indigo bg-indigo/10",
                isArmed && "border-alert bg-alert/10",
                !isMine && !isArmed && "border-rule bg-panel hover:border-rule-bright",
              )}
            >
              <span className="font-mono text-[10px] text-faint">P{port}</span>
              <span
                className={cn(
                  "truncate text-[12px]",
                  isArmed
                    ? "text-alert"
                    : isMine
                      ? "text-indigo"
                      : held
                        ? "text-text"
                        : "text-faint",
                )}
              >
                {isArmed
                  ? "PRENDRE ?"
                  : isMine
                    ? (name ?? "toi")
                    : held
                      ? (name ?? "occupée")
                      : "libre"}
              </span>
            </button>
          );
        })}
      </div>
      {displaced ? (
        <p id="displaced" className="text-[11px] text-alert">
          quelqu'un a pris ton port
        </p>
      ) : mine === null ? (
        <p className="text-[11px] text-faint">
          {armed === null
            ? "clique une prise pour t'asseoir"
            : "reclique pour la prendre à celui qui la tient"}
        </p>
      ) : null}
    </div>
  );
}
