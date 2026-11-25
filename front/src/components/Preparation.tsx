import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Game, Participant, Preparation as Pending } from "../client";
import type { InputState, InputStream } from "../media/input";
import { PADS, type Pad } from "../lib/saves";
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
} from "../lib/lancement";
import { pastille, PREPARATION, SANS_REPONSE } from "../lib/mots";
import { useAttente } from "../lib/useAttente";
import { secouer, sonMenu } from "../retro";
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

/** Un refus du salon (une préparation, une fermeture) : Aïn joue « refus »
 * par l'arbitre, le son d'erreur sonne si les sons du menu sont allumés
 * (`sonMenu` les lit), et le bloc qui l'écrit tremble au niveau « tout »
 * (effet « secousse », `secouer`, qui refuse tout ancêtre de l'image). Seul
 * un refus NOUVEAU joue : le même texte rendu deux fois ne rejoue rien, un
 * texte effacé puis revenu rejoue. */
export function useSceneRefus(refus: string, bloc?: () => HTMLElement | null): void {
  const arbitre = useArbitre();
  const leBloc = useRef(bloc);
  leBloc.current = bloc;
  // L'effet ne repart que si le texte change : c'est la règle du refus
  // nouveau, sans mémoire à tenir.
  useEffect(() => {
    if (refus === "") return;
    sonMenu("erreur");
    const ou = leBloc.current?.();
    if (ou) secouer(ou);
    if (!arbitre) return;
    const hote = document.querySelector('[data-hote="coin"]') ? "coin" : "barre";
    arbitre.demander({ scene: "refus", par: "menus", hote });
  }, [arbitre, refus]);
}

/** Le même refus, posé DANS la salle : un crochet appelé au corps d'`App`
 * vivrait hors du `Cadre` qui tient l'arbitre, et la scène ne jouerait pas.
 * Le refus d'un geste du menu s'écrit dans le menu : c'est lui qui tremble. */
export function SceneRefus({ refus }: { refus: string }): null {
  useSceneRefus(refus, () => document.getElementById("menu"));
  return null;
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
 * Elle vivait dans le dialogue des touches (`Bindings`, `SwitchBindings`,
 * retirés le 24 novembre 2026 avec `usePreparationPro`, qui portait la
 * moitié Pro) :
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
/** Le focus d'un choix du bloc reste au-dessus de la rangée de gestes collée
 * (P2). Le défilement natif du focus ne bouge rien tant que l'élément tient
 * dans la colonne, même sous une barre collée ; et l'avis du clavier, qui
 * naît du même focus, pousse ensuite la colonne vers le bas (parcours.mjs,
 * garde-focus, 24 novembre 2026). D'où un contrôle au focus ET après chaque
 * rendu : il ne fait défiler que si l'étiquette touche la rangée.
 * `scrollIntoView` compte la marge que `preparation.css` lui donne, faite de
 * la hauteur de la rangée (`--hauteur-gestes`). */
function garderAuDessusDesGestes(bloc: HTMLElement | null): void {
  const ici = document.activeElement;
  if (!bloc || !(ici instanceof HTMLElement) || !bloc.contains(ici)) return;
  if (ici.closest(".n3-prep-actions")) return;
  const gestes = bloc.querySelector(".n3-prep-actions")?.getBoundingClientRect();
  const cible = ici.closest("label") ?? ici;
  if (!gestes || cible.getBoundingClientRect().bottom <= gestes.top) return;
  // La rangée tient sur une à trois lignes selon la largeur et les gestes :
  // la marge suit sa hauteur du moment.
  bloc.style.setProperty("--hauteur-gestes", `${Math.ceil(gestes.height)}px`);
  cible.scrollIntoView?.({ block: "nearest" });
}

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
  const bloc = useRef<HTMLElement | null>(null);
  // Après chaque rendu : l'avis du clavier né du focus a pu pousser le bloc.
  useLayoutEffect(() => garderAuDessusDesGestes(bloc.current));
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
  useSceneRefus(notice, () => bloc.current);
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
    <section
      id="preparation"
      className="n3-prep"
      aria-labelledby="preparationTitre"
      ref={bloc}
      onFocus={() => garderAuDessusDesGestes(bloc.current)}
    >
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
