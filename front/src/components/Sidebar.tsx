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
import { useEffect, useState } from "react";
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
  onComplain,
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
  /** « Ça saccade, maintenant. »
   *
   * Le geste qui manquait le plus. Une plainte arrive le lendemain avec une
   * heure approximative, et il a fallu deux fois demander une capture d'écran à
   * quelqu'un qui jouait. Ce bouton pose un repère à l'instant exact, avec ce
   * que la page voyait à ce moment-là. */
  onComplain: () => void;
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

          <Complain onComplain={onComplain} />
        </>
      ) : (
        <div id="stats">{shot ? <Instruments shot={shot} /> : null}</div>
      )}
    </>
  );
}

/**
 * Le bouton qui pose un repère dans le journal.
 *
 * Il DIT qu'il a compris, et c'est la moitié de son intérêt: un bouton de
 * signalement sans retour se presse cinq fois de suite par quelqu'un qui n'est
 * pas sûr d'avoir cliqué, et le journal reçoit cinq repères là où il en fallait
 * un. Le retour dure trois secondes, assez pour être lu sans rester en travers
 * de la partie.
 */
/** Combien de temps le bouton reste désarmé, en millisecondes.
 *
 * La même valeur que le garde du salon, qui refuse un deuxième repère avant
 * vingt secondes. Deux repères si rapprochés porteraient de toute façon presque
 * la même trace: chacun emporte les deux minutes qui précèdent.
 */
const COMPLAIN_EVERY = 20_000;

function Complain({ onComplain }: { onComplain: () => void }) {
  /** Vrai depuis le clic, remis à faux quand le salon accepterait un autre
   * repère. Deux durées et pas une: le remerciement est court parce qu'il ne
   * doit pas rester en travers de la partie, mais le bouton reste désarmé
   * aussi longtemps que le serveur refuse.
   *
   * Sans ça, le bouton dit « noté » à quatre secondes alors que le salon vient
   * de jeter le repère, et un contrôle qui annonce ce qu'il n'a pas fait est
   * pire qu'un contrôle absent. */
  const [said, setSaid] = useState(false);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!said) return;
    const thanks = window.setTimeout(() => setSaid(false), 3000);
    return () => window.clearTimeout(thanks);
  }, [said]);

  useEffect(() => {
    if (!held) return;
    const guard = window.setTimeout(() => setHeld(false), COMPLAIN_EVERY);
    return () => window.clearTimeout(guard);
  }, [held]);

  return (
    <button
      type="button"
      id="complain"
      onClick={() => {
        onComplain();
        setSaid(true);
        setHeld(true);
      }}
      disabled={held}
      className={cn(
        "border px-2 py-1 text-[11px] uppercase tracking-[0.14em] transition-colors",
        said && "border-good text-good",
        held && !said && "border-rule text-faint",
        !held && "border-rule text-faint hover:border-alert hover:text-alert",
      )}
    >
      {said ? "noté, l'instant est marqué" : held ? "déjà signalé" : "ça saccade"}
    </button>
  );
}
