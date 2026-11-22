import { useState } from "react";
import type { Game, Preparation as Pending } from "../client";
import type { InputState, InputStream } from "../media/input";
import { PADS, slotLabel, type Pad, type Slot } from "../lib/saves";
import {
  ATTENTE_SANS_MS,
  choixAppareil,
  gestesDuLancement,
  ligneJoueur,
  nomAppareil,
  titrePreparation,
} from "../lib/lancement";
import { SANS_REPONSE } from "../lib/mots";
import { useAttente } from "../lib/useAttente";
import { SetupProfiles } from "./SetupProfiles";
import { GameCard } from "./GameCard";

/**
 * Le panneau de lancement d'un jeu Dolphin, en un seul bloc.
 *
 * Le jeu et sa console, la sauvegarde, l'état de chaque joueur, puis UN geste
 * par personne: le chef lance avec son choix, les autres confirment le leur.
 * Ce que chacun voit est calculé par `lib/lancement`, que le panneau des
 * consoles Pro lit aussi: les deux disaient deux choses différentes.
 */
export function Preparation({
  pending,
  game,
  input,
  state,
  selected,
  onSelect,
  send,
  onLater,
}: {
  pending: Pending;
  game?: Game;
  input: InputStream;
  state: InputState;
  selected: Pad;
  onSelect: (kind: Pad) => void;
  send: (action: Record<string, unknown>) => Promise<void>;
  /** Masquer la préparation sans la quitter, pour qui ne l'a pas lancée.
   *
   * Le panneau est MODAL: il couvre le menu, le bouton « quitter la salle » et
   * l'image, et il bloque l'entrée du jeu. Tant qu'il n'existait que le bouton
   * d'annulation de l'initiateur, les autres n'avaient aucune commande pour en
   * sortir. Échap et le clic sur le fond ne pouvaient rien, puisque c'est la
   * préparation elle-même qui monte le panneau. C'était le seul endroit de la
   * page dont on ne pouvait pas sortir. */
  onLater?: () => void;
}) {
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const moi = input.attribution();
  /** Depuis quand le chef attend: depuis l'arrivée du dernier absent, vue
   * par CETTE page (`useAttente`). */
  const attendu = useAttente(pending, moi);
  const player = pending.players.find((p) => p.claim === moi);
  const starter = pending.starter === moi;
  const ready = player?.ready ?? false;
  const occupied = state.capturing !== null || state.lesson !== null;
  const console = game?.console;
  const gestes = gestesDuLancement(pending, moi, attendu, console);
  const attend = starter && gestes.principal?.actif === false && gestes.sansAttendre === null;
  const act = async (action: Record<string, unknown>) => {
    setWorking(true);
    setNotice("");
    try {
      await send({ ...action, id: pending.id });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : SANS_REPONSE);
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="n3-preparation" aria-label="Préparation du lancement">
      <div className="n3-preparation-heading">
        <div>
          <span className="n3-eyebrow">{titrePreparation(console)}</span>
          <h3>{game?.name ?? "Préparation du jeu"}</h3>
          <p>Sauvegarde : {slotLabel(pending.save as Slot)}</p>
        </div>
        {starter ? (
          <button
            type="button"
            className="n3-action"
            disabled={working}
            onClick={() => void act({ action: "cancel" })}
          >
            Annuler le lancement
          </button>
        ) : onLater ? (
          <button type="button" id="laterPreparation" className="n3-action" onClick={onLater}>
            Plus tard
          </button>
        ) : null}
      </div>
      <div className="n3-preparation-players">
        {pending.players.map((p) => (
          <div key={p.claim} data-ready={p.ready}>
            <span>P{p.port}</span>
            <strong>{p.name ?? ""}</strong>
            <small>
              {p.claim === pending.starter && !p.ready ? "lance le jeu" : ligneJoueur(p, console)}
            </small>
          </div>
        ))}
      </div>
      {player && gestes.principal ? (
        <>
          <div className="n3-preparation-choice">
            {choixAppareil(pending.allowed) ? (
              <label>
                Ma configuration pour ce jeu
                <select
                  aria-label="Ma configuration pour ce jeu"
                  autoFocus
                  value={selected}
                  disabled={ready || working || occupied}
                  onChange={(e) => {
                    onSelect(Number(e.target.value) as Pad);
                    setNotice("");
                  }}
                >
                  {PADS.filter((p) => pending.allowed.includes(p.id)).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="n3-preparation-appareil">
                Ton appareil : {nomAppareil(pending.allowed[0], console)}
              </p>
            )}
            {gestes.principal.quoi === "lancer" ? (
              <button
                type="button"
                id="launchPrepared"
                className="n3-action primary"
                disabled={!gestes.principal.actif || working}
                onClick={() => void act({ action: "launch", pad: selected })}
              >
                {gestes.principal.label}
              </button>
            ) : (
              <button
                type="button"
                className="n3-action primary"
                disabled={working || occupied}
                onClick={() => void act({ action: "choose", pad: selected, ready: !ready })}
              >
                {gestes.principal.label}
              </button>
            )}
          </div>
          {gestes.attente ? <p role="status">{gestes.attente}</p> : null}
          {gestes.sansAttendre ? (
            <div className="n3-preparation-sans">
              <button
                type="button"
                id="launchWithout"
                className="n3-action"
                disabled={working}
                onClick={() => void act({ action: "launch", pad: selected, sans_attendre: true })}
              >
                {gestes.sansAttendre.label}
              </button>
              <p>{gestes.sansAttendre.note}</p>
            </div>
          ) : attend ? (
            <p>
              Sans réponse au bout de {Math.round(ATTENTE_SANS_MS / 1000)} s, tu pourras lancer sans
              attendre.
            </p>
          ) : null}
          <SetupProfiles
            game={game}
            input={input}
            state={state}
            selected={selected}
            allowed={pending.allowed}
            onSelect={onSelect}
            disabled={ready || working || occupied}
          />
        </>
      ) : (
        <p>Tu regardes la préparation. Prends une place pour participer.</p>
      )}
      {notice ? <p role="status">{notice}</p> : null}
      {game ? <GameCard game={game} kind={selected} compact /> : null}
    </section>
  );
}
