/**
 * La colonne, en deux modes.
 *
 * **Normal**: qui joue, qui regarde, le son. Ce qu'on veut savoir pendant une
 * soirée à quatre, et rien d'autre.
 *
 * **Détails**: les mesures. Elles ont expliqué quatre blocages différents et
 * elles restent à un clic, mais les avoir en permanence sous les yeux fait une
 * colonne que personne ne lit.
 *
 * Les réglages n'y sont plus: ils vivent dans le menu, qui est fait pour ça. Une
 * colonne qui porte à la fois l'état de la salle et sept boutons de réglage ne
 * porte bien ni l'un ni l'autre.
 */
import type { Person } from "../client";
import { cn } from "../lib/cn";
import type { Snapshot } from "../media/session";
import { PLAYER_COLOURS } from "../media/players";
import { Instruments } from "./Instruments";
import { Volume } from "./Settings";

export type Mode = "normal" | "details";

export function Sidebar({
  mode,
  onMode,
  people,
  players,
  busy,
  names,
  mine,
  shot,
  volume,
  onVolume,
  onSound,
  seated: iAmSeated,
  onWatch,
  onPlay,
  onLeave,
}: {
  mode: Mode;
  onMode: (mode: Mode) => void;
  people: Person[];
  players: number;
  busy: boolean[];
  names: Map<number, string>;
  mine: number | null;
  shot: Snapshot | null;
  volume: number;
  onVolume: (volume: number) => void;
  onSound: () => void;
  /** Vrai quand cette page tient une manette en ce moment. */
  seated: boolean;
  /** Rendre sa place et continuer à regarder. */
  onWatch: () => void;
  /** Reprendre la première place libre. */
  onPlay: () => void;
  /** Sortir de la salle. */
  onLeave: () => void;
}) {
  const seated = people.filter((person) => person.seat !== null);
  const watching = people.filter((person) => person.seat === null);

  return (
    <>
      <div className="flex gap-1">
        {(["normal", "details"] as Mode[]).map((choice) => (
          <button
            key={choice}
            type="button"
            id={`mode-${choice}`}
            onClick={() => onMode(choice)}
            className={cn(
              "flex-1 border px-2 py-1 text-[11px] uppercase tracking-[0.14em] transition-colors",
              mode === choice
                ? "border-indigo text-indigo"
                : "border-rule text-faint hover:border-rule-bright",
            )}
          >
            {choice === "normal" ? "salle" : "détails"}
          </button>
        ))}
      </div>

      {mode === "normal" ? (
        <>
          <section className="flex flex-col gap-2 border-t border-rule pt-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-indigo/70">joueurs</span>
            {Array.from({ length: players }, (_, slot) => slot + 1).map((port) => {
              const held = busy[port - 1] ?? false;
              const isMine = port === mine;
              const who = names.get(port);
              return (
                <div key={port} className="flex items-baseline gap-2">
                  {/* Une pastille de la couleur du port, la même que sur la
                      prise: c'est ce qui relie un nom à un personnage à
                      l'écran. */}
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      background: held ? PLAYER_COLOURS[port - 1] : "transparent",
                      border: held ? "none" : "1px solid var(--rule-bright)",
                    }}
                  />
                  <span className="font-mono text-[10px] text-faint">P{port}</span>
                  <span
                    className={cn(
                      "truncate text-[12px]",
                      isMine ? "text-indigo" : held ? "text-text" : "text-faint",
                    )}
                  >
                    {isMine ? `${who ?? "toi"} (toi)` : (who ?? (held ? "occupée" : "libre"))}
                  </span>
                </div>
              );
            })}
          </section>

          {watching.length > 0 ? (
            <section className="flex flex-col gap-1 border-t border-rule pt-2">
              <span className="text-[10px] uppercase tracking-[0.2em] text-indigo/70">
                {watching.length === 1 ? "spectateur" : "spectateurs"}
              </span>
              <p className="text-[12px] text-muted">
                {watching.map((person) => person.name).join(", ")}
              </p>
            </section>
          ) : null}

          {/* Rendre sa place, ou sortir. Ici plutôt que seulement dans le
              menu: quelqu'un qui veut céder sa manette le veut tout de suite, et
              le menu couvre l'écran. */}
          <section className="flex gap-1 border-t border-rule pt-2">
            <button
              type="button"
              id={iAmSeated ? "watchOnly" : "takePad"}
              onClick={iAmSeated ? onWatch : onPlay}
              className="flex-1 border border-rule px-2 py-1 text-[11px] text-muted transition-colors hover:border-indigo hover:text-indigo"
            >
              {iAmSeated ? "rendre la manette" : "prendre une manette"}
            </button>
            <button
              type="button"
              id="leaveRoom"
              onClick={onLeave}
              className="border border-rule px-2 py-1 text-[11px] text-faint transition-colors hover:border-indigo hover:text-indigo"
            >
              quitter
            </button>
          </section>

          <section className="flex flex-col gap-1 border-t border-rule pt-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-indigo/70">son</span>
            {shot?.sound.state === "running" ? (
              <Volume value={volume} onChange={onVolume} />
            ) : (
              <button
                type="button"
                id="sound"
                onClick={onSound}
                className="border border-indigo/60 px-2 py-1.5 text-[12px] text-indigo hover:bg-indigo/10"
              >
                activer le son
              </button>
            )}
          </section>

          <p className="border-t border-rule pt-2 text-[11px] leading-relaxed text-faint">
            {seated.length === 0
              ? "personne ne tient de manette"
              : `${seated.length} manette${seated.length > 1 ? "s" : ""} tenue${seated.length > 1 ? "s" : ""}`}
            . Échap ouvre le menu.
          </p>
        </>
      ) : (
        <div id="stats">{shot ? <Instruments shot={shot} /> : null}</div>
      )}
    </>
  );
}
