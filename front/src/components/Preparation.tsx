import { useState, type ReactNode } from "react";
import type { Game, Preparation as Pending } from "../client";
import type { InputState, InputStream } from "../media/input";
import { PADS, slotLabel, type Pad, type Slot } from "../lib/saves";
import {
  ATTENTE_SANS_MS,
  choixAppareil,
  gestesDuLancement,
  lancerEnChef,
  ligneJoueur,
  nomAppareil,
  titrePreparation,
} from "../lib/lancement";
import { pastille, SANS_REPONSE } from "../lib/mots";
import { useAttente } from "../lib/useAttente";
import { SetupProfiles } from "./SetupProfiles";
import { GameCard } from "./GameCard";

/**
 * Le panneau de lancement d'un jeu Dolphin, en un seul bloc.
 *
 * Le jeu et sa console, la sauvegarde, l'état de chaque joueur, puis UN geste
 * par personne: le chef lance avec son choix, les autres confirment le leur.
 * Ce que chacun voit est calculé par `lib/lancement`, que la préparation des
 * consoles Pro lit aussi (`usePreparationPro`, plus bas): les deux disaient
 * deux choses différentes.
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
  const run = async (geste: () => Promise<void>) => {
    setWorking(true);
    setNotice("");
    try {
      await geste();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : SANS_REPONSE);
    } finally {
      setWorking(false);
    }
  };
  const act = (action: Record<string, unknown>) => run(() => send({ ...action, id: pending.id }));
  /** Le lancement du chef, compris aussi d'un salon d'avant (`lancerEnChef`). */
  const lancer = (sansAttendre: boolean) =>
    run(() =>
      lancerEnChef(send, {
        id: pending.id,
        pad: selected,
        ...(sansAttendre ? { sans_attendre: true as const } : {}),
      }),
    );
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
            <span>{pastille(p.port)}</span>
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
                onClick={() => void lancer(false)}
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
                onClick={() => void lancer(true)}
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

/** Ce que la préparation d'une salle Pro rend au panneau des touches de la
 * trame Pro (`SwitchBindings`), qui l'héberge. */
export type PreparationPro = {
  /** Le joueur de cette page a confirmé son choix : le réglage se fige. */
  pret: boolean;
  /** Un geste attend la réponse du salon : le réglage se fige aussi. */
  occupe: boolean;
  /** Les morceaux du panneau, chacun à la place qu'il avait ; rien hors d'une
   * préparation. */
  vue: {
    /** Au-dessus du titre : « Avant de jouer · Xbox 360 ». */
    surtitre: string;
    /** Le nom du jeu préparé. */
    titre: string | undefined;
    /** « Annuler le lancement » pour qui l'a lancée, rien pour les autres. */
    annuler: ReactNode;
    /** La sauvegarde et la ligne de chaque joueur, en tête du corps. */
    joueurs: ReactNode;
    /** Le geste de chacun, au pied du panneau ; rien pour qui regarde. */
    pied: ReactNode;
  } | null;
};

/**
 * La préparation à plusieurs d'une salle à manette Pro (Switch, Xbox 360).
 *
 * Elle vivait dans `SwitchBindings`, mêlée au réglage des touches de la trame
 * Pro. Elle en sort ici le 23 novembre 2026, sans rien changer à ce que la
 * page montre, pour que deux chantiers changent chacun sa moitié : le réglage
 * appartient au chantier des manettes, la préparation à celui des menus. Le
 * panneau pose les morceaux de `vue` là où ils étaient (en-tête, tête du
 * corps, pied), et partage sa ligne d'état (`dire`).
 *
 * Ce que chacun voit est calculé par `lib/lancement`, comme pour `Preparation`.
 * La manette Pro est l'appareil 4.
 */
// Un crochet exporté à côté d'un composant prive ce fichier du rechargement à
// chaud de Vite : en développement, une retouche de ce fichier perd l'état des
// composants affichés. Rien ne change pour la page construite, et la
// partition range la préparation Pro ici, chez le chantier des menus, qui la
// réécrira.
// oxlint-disable-next-line only-export-components
export function usePreparationPro({
  pending,
  game,
  input,
  send,
  capture,
  dire,
}: {
  pending: Pending | null;
  game?: Game | null;
  input: InputStream;
  send: (action: Record<string, unknown>) => Promise<void>;
  /** Une commande du réglage attend d'être actionnée : le pied attend aussi. */
  capture: boolean;
  /** Écrit dans la ligne d'état du panneau, que le réglage partage. */
  dire: (texte: string) => void;
}): PreparationPro {
  const [busy, setBusy] = useState(false);
  const me = pending?.players.find((p) => p.claim === input.attribution());
  const ready = me?.ready ?? false;
  const starter = pending?.starter === input.attribution();
  /** Depuis quand le chef attend: depuis l'arrivée du dernier absent, compté
   * comme dans `Preparation` (`useAttente`). */
  const attendu = useAttente(pending ?? null, input.attribution());
  const run = async (geste: () => Promise<void>) => {
    setBusy(true);
    dire("");
    try {
      await geste();
    } catch (e) {
      dire(e instanceof Error ? e.message : SANS_REPONSE);
    } finally {
      setBusy(false);
    }
  };
  const act = (action: Record<string, unknown>) => run(() => send({ ...action, id: pending?.id }));
  /** Le lancement du chef, compris aussi d'un salon d'avant (`lancerEnChef`).
   * La manette Pro est l'appareil 4. */
  const lancer = (sansAttendre: boolean) =>
    run(() =>
      lancerEnChef(send, {
        id: pending?.id,
        pad: 4,
        ...(sansAttendre ? { sans_attendre: true as const } : {}),
      }),
    );
  if (!pending) return { pret: ready, occupe: busy, vue: null };
  const gestes = gestesDuLancement(pending, input.attribution(), attendu, game?.console);
  const principal = gestes.principal;
  return {
    pret: ready,
    occupe: busy,
    vue: {
      surtitre: titrePreparation(game?.console ?? undefined),
      titre: game?.name,
      annuler: starter ? (
        <button disabled={busy} onClick={() => void act({ action: "cancel" })}>
          Annuler le lancement
        </button>
      ) : null,
      joueurs: (
        <section className="n3-preparation">
          <p>
            Sauvegarde : {slotLabel(pending.save as Slot)}. Chacun teste ses commandes et charge son
            profil.
          </p>
          <div className="n3-preparation-players">
            {pending.players.map((p) => (
              <div key={p.claim} data-ready={p.ready}>
                <span>{pastille(p.port)}</span>
                <strong>{p.name ?? ""}</strong>
                <small>
                  {p.claim === pending.starter && !p.ready
                    ? "lance le jeu"
                    : ligneJoueur(p, game?.console ?? undefined)}
                </small>
              </div>
            ))}
          </div>
        </section>
      ),
      pied: principal ? (
        <footer>
          {principal.quoi === "lancer" ? (
            <>
              <button
                id="launchPrepared"
                disabled={busy || capture || !principal.actif}
                onClick={() => void lancer(false)}
              >
                {principal.label}
              </button>
              {gestes.sansAttendre ? (
                <button
                  id="launchWithout"
                  disabled={busy}
                  title={gestes.sansAttendre.note}
                  onClick={() => void lancer(true)}
                >
                  {gestes.sansAttendre.label}
                </button>
              ) : null}
              <span>
                {gestes.sansAttendre?.note ??
                  (gestes.attente
                    ? `${gestes.attente} Sans réponse au bout de ${Math.round(ATTENTE_SANS_MS / 1000)} s, tu pourras lancer sans attendre.`
                    : "")}
              </span>
            </>
          ) : (
            <>
              <button
                disabled={busy || capture}
                onClick={() => void act({ action: "choose", pad: 4, ready: !ready })}
              >
                {principal.label}
              </button>
              <span>{gestes.attente ?? "Le chef lance le jeu quand chacun est prêt."}</span>
            </>
          )}
        </footer>
      ) : null,
    },
  };
}
