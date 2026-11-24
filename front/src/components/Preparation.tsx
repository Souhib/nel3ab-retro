import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Game, Participant, Preparation as Pending } from "../client";
import type { InputState, InputStream } from "../media/input";
import { PADS, slotLabel, type Pad, type Slot } from "../lib/saves";
import {
  ATTENTE_SANS_MS,
  choixAppareil,
  comptePrets,
  gestesDuLancement,
  lancerEnChef,
  ligneDuJeu,
  ligneJoueur,
  nomAppareil,
  scenePret,
  titreDuBloc,
  titrePreparation,
} from "../lib/lancement";
import { pastille, PREPARATION, SANS_REPONSE } from "../lib/mots";
import { useAttente } from "../lib/useAttente";
import { useArbitre } from "./Cadre";
import "./menu/menu.css";
import "./preparation.css";

/** Aïn salue un joueur qui se dit prêt, puis tous quand le dernier le dit
 * (scène « pret », `scenePret`), par l'arbitre de la salle (K10). Au coin
 * au bureau, à la tête de la barre au téléphone : là où sa maison est
 * montée. */
export function useScenePret(players: readonly Participant[] | null): void {
  const arbitre = useArbitre();
  const avant = useRef<readonly Participant[] | null>(null);
  useEffect(() => {
    const precedent = avant.current;
    avant.current = players;
    if (!arbitre || players === null) return;
    const mode = scenePret(precedent, players);
    if (mode === null) return;
    const hote = document.querySelector('[data-hote="coin"]') ? "coin" : "barre";
    arbitre.demander({ scene: "pret", par: "menus", hote, contexte: { mode } });
  }, [arbitre, players]);
}

/** Aïn salue chaque joueur qui se dit prêt ; la ligne parlée de la salle le
 * dit aussi, une fois : « Bo est prêt. » (P10). Le compte du chef ne parle
 * pas : il change chaque seconde. */
function useAnnoncePrets(
  players: readonly Participant[],
  annoncer: ((texte: string) => void) | undefined,
): void {
  const avant = useRef<readonly Participant[] | null>(null);
  useEffect(() => {
    const precedent = avant.current;
    avant.current = players;
    if (!annoncer || precedent === null) return;
    const etait = new Map(precedent.map((p) => [p.claim, p.ready]));
    for (const p of players)
      if (p.ready && etait.get(p.claim) === false)
        annoncer(`${p.name ?? pastille(p.port)} est prêt.`);
  }, [players, annoncer]);
}

/**
 * La préparation à plusieurs, en un bloc non modal (P1 à P9, 24 novembre
 * 2026), pour toutes les consoles.
 *
 * Elle vivait dans le dialogue des touches (`Bindings`, `SwitchBindings`) :
 * un calque modal qui couvrait l'image, bloquait l'entrée du jeu et ne se
 * fermait qu'avec « Plus tard ». Elle se pose maintenant en tête de la
 * colonne au bureau, et dans la feuille d'une salle tenue en main ; le jeu
 * continue, visible, et les touches restent au jeu. « Essayer mes touches »
 * ouvre le réglage du chantier des manettes (`ouvrirReglage`) au lieu de le
 * porter.
 *
 * Le titre dit qui lance, la ligne du jeu dit la console et la sauvegarde,
 * puis vient la liste des joueurs et UN geste par personne : le chef lance
 * avec son choix, les autres confirment le leur, qui regarde lit le compte.
 * Ce que chacun voit est calculé par `lib/lancement`.
 */
export function Preparation({
  pending,
  game,
  input,
  state,
  selected,
  onSelect,
  send,
  onEssayer,
  enCours = null,
  annoncer,
}: {
  pending: Pending;
  game?: Game;
  input: Pick<InputStream, "attribution">;
  state: Pick<InputState, "capturing" | "lesson" | "port">;
  selected: Pad;
  onSelect: (kind: Pad) => void;
  send: (action: Record<string, unknown>) => Promise<void>;
  /** « Essayer mes touches » : le réglage des touches, à côté de l'image. */
  onEssayer?: () => void;
  /** Le jeu qui tourne pendant la préparation : l'annulation le garde (P6). */
  enCours?: string | null;
  /** La ligne parlée de la salle, seule région polie (P10). */
  annoncer?: (texte: string) => void;
}) {
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const moi = input.attribution();
  /** Depuis quand le chef attend: depuis l'arrivée du dernier absent, vue
   * par CETTE page (`useAttente`). */
  const attendu = useAttente(pending, moi);
  useScenePret(pending.players);
  useAnnoncePrets(pending.players, annoncer);
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
      const refus = error instanceof Error ? error.message : SANS_REPONSE;
      // Un refus s'écrit dans le bloc, comme un état, et se dit une fois.
      setNotice(refus);
      annoncer?.(refus);
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
    <section id="preparation" className="n3-prep" aria-labelledby="preparationTitre">
      <h2 id="preparationTitre" className="n3-prep-titre">
        {titreDuBloc(pending, moi)}
      </h2>
      <p className="n3-prep-jeu">
        {game ? <strong>{game.name}</strong> : null}
        <span>{ligneDuJeu(console, pending.save)}</span>
      </p>
      <ul className="n3-prep-joueurs" aria-label="Joueurs">
        {pending.players.map((p) => (
          <li key={p.claim} data-ready={p.ready}>
            <span className="n3-prep-place">{pastille(p.port)}</span>
            <strong>{p.name ?? ""}</strong>
            <small>
              {p.claim === pending.starter && !p.ready ? "lance le jeu" : ligneJoueur(p, console)}
            </small>
          </li>
        ))}
      </ul>
      {player && gestes.principal ? (
        <>
          {choixAppareil(pending.allowed) ? (
            <fieldset className="n3-prep-choix" disabled={ready || working || occupied}>
              <legend className="n3-prep-question">{PREPARATION.avecQuoi}</legend>
              {PADS.filter((p) => pending.allowed.includes(p.id)).map((p) => (
                <label key={p.id} className="n3-menu-pastille">
                  <input
                    type="radio"
                    name={`appareil-${pending.id}`}
                    value={p.id}
                    checked={selected === p.id}
                    onChange={() => {
                      onSelect(p.id);
                      setNotice("");
                    }}
                  />
                  <span className="n3-menu-point" aria-hidden="true" />
                  {nomAppareil(p.id, console)}
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="n3-prep-appareil">
              {PREPARATION.appareil(nomAppareil(pending.allowed[0], console))}
            </p>
          )}
          {gestes.attente ? <p className="n3-prep-note">{gestes.attente}</p> : null}
          {gestes.sansAttendre ? (
            <p className="n3-prep-note">{gestes.sansAttendre.note}</p>
          ) : attend ? (
            <p className="n3-prep-note">
              Sans réponse au bout de {Math.round(ATTENTE_SANS_MS / 1000)} s, tu pourras lancer sans
              attendre.
            </p>
          ) : null}
          {notice ? <p className="n3-prep-refus">{notice}</p> : null}
          {/* La rangée des gestes reste collée au bas du bloc (P2). */}
          <div className="n3-prep-actions">
            {gestes.principal.quoi === "lancer" ? (
              <button
                type="button"
                id="launchPrepared"
                className="rt-boite rt-bouton rt-bouton-plein n3-prep-bouton"
                disabled={!gestes.principal.actif || working}
                onClick={() => void lancer(false)}
              >
                <i className="rt-ombre" aria-hidden="true" />
                {gestes.principal.label}
              </button>
            ) : (
              <button
                type="button"
                id="pretPrepared"
                className="rt-boite rt-bouton rt-bouton-plein n3-prep-bouton"
                disabled={working || occupied}
                onClick={() => void act({ action: "choose", pad: selected, ready: !ready })}
              >
                <i className="rt-ombre" aria-hidden="true" />
                {gestes.principal.label}
              </button>
            )}
            {gestes.sansAttendre ? (
              <button
                type="button"
                id="launchWithout"
                className="rt-boite rt-bouton n3-prep-bouton"
                disabled={working}
                onClick={() => void lancer(true)}
              >
                <i className="rt-ombre" aria-hidden="true" />
                {gestes.sansAttendre.label}
              </button>
            ) : null}
            {/* Dans la rangée et non au-dessus : la rangée colle au bas de
                la colonne, et un lien posé plus haut passait dessous en
                paysage (salle-telephone, 844x390). */}
            {onEssayer ? (
              <button
                type="button"
                id="essayerTouches"
                className="rt-boite rt-bouton n3-prep-bouton"
                disabled={ready}
                onClick={onEssayer}
              >
                <i className="rt-ombre" aria-hidden="true" />
                {PREPARATION.essayer}
              </button>
            ) : null}
            {starter ? (
              <button
                type="button"
                id="cancelPrepared"
                className="rt-boite rt-bouton n3-prep-bouton"
                disabled={working}
                onClick={() => void act({ action: "cancel" })}
              >
                <i className="rt-ombre" aria-hidden="true" />
                {enCours ? PREPARATION.garder(enCours) : PREPARATION.annuler}
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <p className="n3-prep-note">
          {comptePrets(pending)} {state.port === null ? PREPARATION.regarde : null}
        </p>
      )}
    </section>
  );
}

/** La préparation en une ligne, dans la bande d'une salle tenue en main
 * (P8) : qui lance et quel jeu, et un bouton qui ouvre le bloc entier dans
 * la feuille de la salle. Ni le jeu ni la manette à l'écran ne bougent. */
export function PreparationEnBref({
  pending,
  game,
  moi,
  onOuvrir,
}: {
  pending: Pending;
  game?: Game;
  moi: string | null;
  onOuvrir: () => void;
}) {
  const joueur = pending.players.find((p) => p.claim === moi);
  const choisir = joueur !== undefined && !joueur.ready && pending.starter !== moi;
  const titre = titreDuBloc(pending, moi);
  return (
    <div id="preparationEnBref" className="n3-prep-bref">
      <p>{game ? `${titre}, ${game.name}` : titre}</p>
      <button
        type="button"
        id="ouvrirPreparation"
        className="rt-boite rt-bouton n3-prep-bouton"
        onClick={onOuvrir}
      >
        <i className="rt-ombre" aria-hidden="true" />
        {choisir ? PREPARATION.choisir : PREPARATION.voir}
      </button>
    </div>
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
 *
 * Depuis le 24 novembre 2026, la salle ne monte plus `SwitchBindings` pendant
 * une préparation : le bloc `Preparation` sert toutes les consoles. Ce crochet
 * ne vit plus que dans la branche `pending` de `SwitchBindings` et dans son
 * aperçu ; il part avec elle quand le chantier des manettes retire l'ancien
 * dialogue.
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
  useScenePret(pending?.players ?? null);
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
