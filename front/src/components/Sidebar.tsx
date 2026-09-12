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
import { ConnectionDiagnostic } from "./ConnectionDiagnostic";
import { Crown } from "./Crown";
import { Instruments } from "./Instruments";
import { Volume } from "./Settings";

export type Mode = "normal" | "details";

export function Sidebar({
  idle,
  mode,
  onMode,
  owner,
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
  suggestHalf,
  onTakeHalf,
  onKeepFull,
  onFold,
}: {
  idle: boolean;
  mode: Mode;
  onMode: (mode: Mode) => void;
  owner?: Person | null;
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
  onComplain: () => Promise<void>;
  /** Vrai quand la liaison a raté deux fenêtres d'affilée et que cette page
   * n'est pas déjà en format réduit. */
  suggestHalf: boolean;
  /** Basculer en format réduit. */
  onTakeHalf: () => void;
  /** Garder la pleine taille, et ne plus se faire proposer. */
  onKeepFull: () => void;
  /** Replier la colonne. Un BOUTON et pas seulement Échap.
   *
   * Sur un téléphone il n'y a pas de touche Échap, donc la colonne visible n'a
   * plus aucune sortie: elle prend la moitié de l'écran et rien ne la referme.
   * Signalé le 18 août 2026, et c'est un piège que j'avais fabriqué en la
   * repliant d'office sans laisser de porte dans l'autre sens. */
  onFold?: () => void;
}) {
  const heldCount = busy.filter(Boolean).length;
  const watching = people.filter((person) => person.seat == null && person.seat_pending === false);
  const pending = people.filter((person) => person.seat == null && person.seat_pending !== false);

  return (
    <>
      <div className="flex gap-1">
        {onFold ? (
          <button
            type="button"
            id="foldColumn"
            onClick={onFold}
            title="replier la colonne"
            className="border border-rule px-2 py-1 text-[13px] text-faint transition-colors hover:border-rule-bright"
          >
            ✕
          </button>
        ) : null}
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
                    {held || isMine
                      ? who
                        ? `${who}${isMine ? " (toi)" : ""}`
                        : "\u00a0"
                      : "personne"}
                    {who && held && owner?.seat === port ? (
                      <>
                        {" "}
                        <Crown />
                      </>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </section>

          <section
            aria-label="spectateurs"
            className="flex flex-col gap-2 border-t border-rule pt-2"
          >
            <span className="text-[10px] uppercase tracking-[0.2em] text-indigo/70">
              spectateurs · {watching.length}
            </span>
            {watching.length ? (
              watching.map((person) => (
                <div
                  key={person.login ?? person.name}
                  className="flex items-center gap-2 text-[12px] text-muted"
                >
                  <span
                    className="h-6 w-6 shrink-0 rounded-full border border-rule bg-panel text-center leading-6"
                    aria-hidden="true"
                  >
                    {person.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate">{person.name}</span>
                  {owner?.login && owner.login === person.login ? <Crown /> : null}
                </div>
              ))
            ) : (
              <p className="text-[11px] text-faint">personne pour l'instant</p>
            )}
          </section>

          {pending.length ? (
            <section
              aria-label="attributions en attente"
              className="border-t border-rule pt-2 text-[11px] text-muted"
            >
              {pending.map((person) => (
                <p key={person.login ?? person.name}>
                  {person.name} {owner?.login && owner.login === person.login ? <Crown /> : null}
                  {" · manette à confirmer"}
                </p>
              ))}
              <p>Si vous jouez déjà, rechargez votre page pour retrouver votre nom.</p>
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
            {heldCount === 0
              ? "personne ne tient de manette"
              : `${heldCount} manette${heldCount > 1 ? "s" : ""} tenue${heldCount > 1 ? "s" : ""}`}
            . Échap ouvre le menu.
          </p>

          {idle ? null : (
            <p id="saveReminder" className="text-[11px] leading-relaxed text-faint">
              Pense à sauvegarder dans le jeu: une salle que tout le monde quitte ferme la partie.
            </p>
          )}

          {suggestHalf ? <Rough onTake={onTakeHalf} onKeep={onKeepFull} /> : null}

          {!idle && shot && !shot.padOnly ? (
            <ConnectionDiagnostic video={shot.video} onReduce={onTakeHalf} />
          ) : null}
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

function Complain({ onComplain }: { onComplain: () => Promise<void> }) {
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

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
    <>
      <button
        type="button"
        id="complain"
        onClick={async () => {
          setPending(true);
          setError("");
          try {
            await onComplain();
            setSaid(true);
            setHeld(true);
          } catch (reason) {
            setError(
              reason instanceof Error ? reason.message : "Signalement non confirmé. Réessaie.",
            );
          } finally {
            setPending(false);
          }
        }}
        disabled={held || pending}
        className={cn(
          "border px-2 py-1 text-[11px] uppercase tracking-[0.14em] transition-colors",
          said && "border-good text-good",
          held && !said && "border-rule text-faint",
          !held && "border-rule text-faint hover:border-alert hover:text-alert",
        )}
      >
        {pending
          ? "envoi…"
          : said
            ? "signalement enregistré"
            : held
              ? "déjà signalé"
              : "signaler un problème"}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

/**
 * « Ton image saute. Tu veux la version légère ? »
 *
 * Posée là où la personne regarde déjà les places, et pas en travers de
 * l'image: une bannière qui recouvre le jeu au moment où le jeu va mal est une
 * bannière qui agace.
 *
 * Deux boutons et pas un. Refuser doit être aussi facile qu'accepter, parce que
 * quelqu'un peut préférer une image nette avec quelques saccades à une image
 * molle sans aucune, et parce qu'un refus est ce qui fait taire la proposition.
 */
function Rough({ onTake, onKeep }: { onTake: () => void; onKeep: () => void }) {
  return (
    <div id="rough" className="flex flex-col gap-2 border border-alert/60 bg-panel p-2">
      <p className="text-[11px] leading-relaxed text-muted">
        Ton image saute depuis vingt secondes. Le format réduit demande environ 2,6 fois moins de
        débit.
      </p>
      <div className="flex gap-1">
        <button
          type="button"
          id="takeHalf"
          onClick={onTake}
          className="flex-1 border border-alert px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-alert transition-colors hover:bg-alert/10"
        >
          passer en réduit
        </button>
        <button
          type="button"
          id="keepFull"
          onClick={onKeep}
          className="border border-rule px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-faint transition-colors hover:border-rule-bright"
        >
          non merci
        </button>
      </div>
    </div>
  );
}
