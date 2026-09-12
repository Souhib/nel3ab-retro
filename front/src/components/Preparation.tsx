import { useState } from "react";
import type { Game, Preparation as Pending } from "../client";
import type { InputState, InputStream } from "../media/input";
import { PADS, padLabel, slotLabel, type Pad, type Slot } from "../lib/saves";
import { SetupProfiles } from "./SetupProfiles";
import { GameCard } from "./GameCard";

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
   * sortir — Échap et le clic sur le fond ne pouvaient rien, puisque c'est la
   * préparation elle-même qui monte le panneau. C'était le seul endroit de la
   * page dont on ne pouvait pas sortir. */
  onLater?: () => void;
}) {
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const player = pending.players.find((p) => p.claim === input.attribution());
  const starter = pending.starter === input.attribution();
  const allReady = pending.players.length > 0 && pending.players.every((p) => p.ready);
  const ready = player?.ready ?? false;
  const occupied = state.capturing !== null || state.lesson !== null;
  const act = async (action: Record<string, unknown>) => {
    setWorking(true);
    setNotice("");
    try {
      await send({ ...action, id: pending.id });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Le salon ne répond pas.");
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="n3-preparation" aria-label="Préparation des manettes">
      <div className="n3-preparation-heading">
        <div>
          <span className="n3-eyebrow">Avant de jouer · Wii</span>
          <h3>{game?.name ?? "Préparation du jeu"}</h3>
          <p>Sauvegarde : {slotLabel(pending.save as Slot)}</p>
          <p>
            Chacun choisit sa configuration. Le jeu démarre quand tout le monde est prêt et que le
            lancement est confirmé.
          </p>
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
              {p.ready ? `${padLabel(p.pad as Pad)} · prêt` : "choisit sa configuration"}
            </small>
          </div>
        ))}
      </div>
      {player ? (
        <>
          <div className="n3-preparation-choice">
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
            <button
              type="button"
              className="n3-action primary"
              disabled={working || occupied}
              onClick={() => void act({ action: "choose", pad: selected, ready: !ready })}
            >
              {ready ? "Modifier ma configuration" : "Je suis prêt"}
            </button>
            {starter ? (
              <button
                type="button"
                id="launchPrepared"
                className="n3-action primary"
                disabled={!allReady || working}
                onClick={() => void act({ action: "launch" })}
              >
                Lancer le jeu
              </button>
            ) : null}
          </div>
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
        <p>Tu regardes la préparation. Prends une manette pour participer.</p>
      )}
      {notice ? <p role="status">{notice}</p> : null}
      {game ? <GameCard game={game} kind={selected} compact /> : null}
    </section>
  );
}
