/**
 * Trois crans de texte, et rien entre les deux.
 *
 * La colonne portait quatre tailles mêlées — 10, 11, 12 et 13 px — sans qu'aucune
 * ne dise ce qu'elle voulait dire. L'état des quatre manettes, qui est ce qu'on
 * regarde le plus souvent de cette page, était le plus petit de tous.
 *
 * Trois crans désormais: 12 px pour les ÉTIQUETTES en capitales, 13 px pour le
 * COURANT, 15 px pour l'IDENTITÉ, c'est-à-dire qui tient quelle manette.
 *
 * Pourquoi pas plus gros: la colonne fait 304 px de large par défaut, 256 au
 * moins (`lib/column`), et défile (`overflow-y-auto`). Tout grossir ne la
 * déborderait pas, ça pousserait les places sous la ligne de flottaison, ce qui
 * est pire que du petit texte. Les
 * étiquettes en capitales, espacées de 0,2em, montent donc d'un seul cran.
 */
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
import { Canape } from "../bobine/Canape";
import type { Person } from "../client";
import { cn } from "../lib/cn";
import type { Snapshot } from "../media/session";
import { PLAYER_COLOURS } from "../media/players";
import { ConnectionDiagnostic } from "./ConnectionDiagnostic";
import { Crown } from "./Crown";
import { Instruments } from "./Instruments";
import { Volume } from "./Settings";
import type { GardeSignalement } from "../lib/garde-signalement";
import { Signaler } from "./Signaler";

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
  garde,
  onTakeHalf,
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
  /** Le garde de vingt secondes de la page, partagé avec le bandeau de l'image. */
  garde: GardeSignalement;
  /** Basculer en format réduit, depuis le diagnostic replié.
   *
   * La PROPOSITION de format réduit a quitté la colonne le 22 novembre 2026:
   * elle vit sur l'image (`EtatSalle`), le seul endroit visible aussi sur un
   * téléphone, où la colonne est repliée d'office (audit E2). */
  onTakeHalf: () => void;
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
            className="border border-rule px-2 py-1 text-corps text-faint transition-colors hover:border-rule-bright"
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
              "flex-1 border px-2 py-1 text-corps uppercase tracking-[0.14em] transition-colors",
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
            <span className="n3-etiquette">joueurs</span>
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
                  <span className="font-mono text-corps text-faint">P{port}</span>
                  <span
                    className={cn(
                      "truncate text-fort",
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
            <span className="n3-etiquette">spectateurs · {watching.length}</span>
            {watching.length ? <Canape noms={watching.map((person) => person.name)} /> : null}
            {watching.length ? (
              watching.map((person) => (
                <div
                  key={person.id ?? person.name}
                  className="flex items-center gap-2 text-corps text-muted"
                >
                  <span
                    className="h-6 w-6 shrink-0 rounded-full border border-rule bg-panel text-center leading-6"
                    aria-hidden="true"
                  >
                    {person.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate">{person.name}</span>
                  {owner?.id && owner.id === person.id ? <Crown /> : null}
                </div>
              ))
            ) : (
              <p className="text-corps text-faint">personne pour l'instant</p>
            )}
          </section>

          {pending.length ? (
            <section
              aria-label="attributions en attente"
              className="border-t border-rule pt-2 text-corps text-muted"
            >
              {pending.map((person) => (
                <p key={person.id ?? person.name}>
                  {person.name} {owner?.id && owner.id === person.id ? <Crown /> : null}
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
              className="flex-1 border border-rule px-2 py-1 text-corps text-muted transition-colors hover:border-indigo hover:text-indigo"
            >
              {iAmSeated ? "rendre la manette" : "prendre une manette"}
            </button>
            <button
              type="button"
              id="leaveRoom"
              onClick={onLeave}
              className="border border-rule px-2 py-1 text-corps text-faint transition-colors hover:border-indigo hover:text-indigo"
            >
              quitter
            </button>
            {/* Vers la LISTE des salles, à la racine du domaine.
                Une adresse absolue, et non relative au préfixe de cette salle:
                le salon est le même pour toutes et vit à la racine. Voir
                `lib/base`, qui explique quelles adresses se préfixent.
                « Quitter » ne fait que rendre la place et revenir à l'accueil de
                CETTE salle; d'ici, on ne pouvait pas retourner en choisir une
                autre sans réécrire l'adresse à la main. */}
            <a
              href="/"
              id="backToLobby"
              className="border border-rule px-2 py-1 text-corps text-faint transition-colors hover:border-indigo hover:text-indigo"
            >
              les salles
            </a>
          </section>

          <section className="flex flex-col gap-1 border-t border-rule pt-2">
            <span className="n3-etiquette">son</span>
            {shot?.sound.state === "running" ? (
              <Volume value={volume} onChange={onVolume} />
            ) : (
              <button
                type="button"
                id="sound"
                onClick={onSound}
                className="border border-indigo/60 px-2 py-1.5 text-corps text-indigo hover:bg-indigo/10"
              >
                activer le son
              </button>
            )}
          </section>

          <p className="border-t border-rule pt-2 text-corps leading-relaxed text-faint">
            {heldCount === 0
              ? "personne ne tient de manette"
              : `${heldCount} manette${heldCount > 1 ? "s" : ""} tenue${heldCount > 1 ? "s" : ""}`}
            . Échap ouvre le menu.
          </p>

          {idle ? null : (
            <p id="saveReminder" className="text-corps leading-relaxed text-faint">
              Pense à sauvegarder dans le jeu: une salle que tout le monde quitte ferme la partie.
            </p>
          )}

          {!idle && shot && !shot.padOnly ? (
            <ConnectionDiagnostic video={shot.video} onReduce={onTakeHalf} />
          ) : null}
          <Signaler onComplain={onComplain} garde={garde} />
        </>
      ) : (
        <div id="stats">{shot ? <Instruments shot={shot} /> : null}</div>
      )}
    </>
  );
}
