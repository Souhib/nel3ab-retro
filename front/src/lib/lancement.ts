/**
 * Ce que le panneau de lancement montre, et le geste qu'il propose.
 *
 * # Pourquoi c'est ici et pas dans `Preparation.tsx`
 *
 * Deux panneaux préparent un jeu: celui des consoles Dolphin et celui des
 * consoles à manette Pro (`SwitchBindings`). Chacun recalculait qui est prêt,
 * qui lance et ce que dit la ligne d'un joueur, et ils ont divergé: la ligne
 * d'un joueur prêt disait « Manette Pro · prêt » dans une salle Xbox 360, et
 * l'en-tête d'une préparation GameCube disait « Wii » (audit T03, T04, P6,
 * 22 novembre 2026). Les deux lisent maintenant ce module.
 *
 * # Un geste par personne
 *
 * - Le chef lance avec son propre choix: « Je suis prêt » puis « Lancer le
 *   jeu » disaient deux fois la même chose. Le salon accepte le choix du chef
 *   avec le lancement (`launch` avec `pad`).
 * - Les autres confirment: « Je suis prêt ».
 * - Un absent ne bloque plus personne: après `ATTENTE_SANS_MS`, le chef peut
 *   lancer sans lui, et il garde sa place.
 */
import type { Participant, Preparation } from "../client";
import { consoleName } from "./consoles";
import { deviceLabel } from "./faces";
import { de, PREPARATION } from "./mots";
import { padLabel, slotLabel, type Slot } from "./saves";

/** Après combien de temps le chef peut lancer sans un joueur.
 *
 * Le même que le salon (`ATTENTE_SANS`, vingt secondes), compté comme lui
 * depuis l'ARRIVÉE du dernier absent (`attenteDesAbsents`). La page compte
 * depuis qu'ELLE voit arriver chacun, donc toujours après le salon: elle ne
 * propose jamais un geste que le salon refuserait pour cause de hâte. */
export const ATTENTE_SANS_MS = 20_000;

/** Quand cette page a vu arriver chaque joueur d'une préparation. */
export type Arrivees = {
  readonly id: string | undefined;
  readonly vus: ReadonlyMap<string, number>;
};

/** Retient l'arrivée des nouveaux joueurs, et garde celle des autres.
 *
 * Une autre préparation repart de zéro. Rend le MÊME objet quand rien n'a
 * changé: le salon renvoie la salle entière à chaque mouvement, et un état
 * React neuf à chaque message redessinerait le panneau pour rien. */
export function retenirArrivees(
  avant: Arrivees | null,
  pending: Pick<Preparation, "id" | "players">,
  maintenant: number,
): Arrivees {
  const memes = avant !== null && avant.id === pending.id;
  const nouveaux = pending.players.filter((one) => !memes || !avant.vus.has(one.claim));
  if (memes && nouveaux.length === 0) return avant;
  const vus = new Map(memes ? avant.vus : []);
  for (const one of nouveaux) vus.set(one.claim, maintenant);
  return { id: pending.id, vus };
}

/** Depuis combien de temps on attend, pour « Lancer sans attendre ».
 *
 * Depuis l'arrivée du DERNIER absent: quelqu'un qui s'assoit à 19 s se prépare
 * peut-être encore à 20 s (relecture du 22 novembre 2026). Un absent que la
 * page n'a pas encore vu arrive maintenant. */
export function attenteDesAbsents(
  pending: Pick<Preparation, "starter" | "players">,
  arrivees: Arrivees,
  maintenant: number,
): number {
  const absents = pending.players.filter((one) => one.claim !== pending.starter && !one.ready);
  if (absents.length === 0) return 0;
  const dernier = Math.max(...absents.map((one) => arrivees.vus.get(one.claim) ?? maintenant));
  return Math.max(0, maintenant - dernier);
}

/** La console dont l'écran des touches dessine les commandes.
 *
 * Celle du jeu PRÉPARÉ pendant une préparation, sinon celle du jeu en cours.
 * L'écran recevait « wii » en dur dès qu'une préparation existait: une
 * préparation GameCube montrait les commandes d'un jeu Wii (audit T04). La Wii
 * ne reste que le repli d'un jeu préparé que la salle ne connaît pas. */
export function consoleDesTouches(
  enPreparation: boolean,
  consolePreparee: string | undefined,
  consoleEnCours: string | undefined,
): string {
  return enPreparation ? (consolePreparee ?? "wii") : (consoleEnCours ?? "gc");
}

/** Ce que l'écran de chargement dit de la sauvegarde.
 *
 * Le salon écrit « la sauvegarde de Bo » pour tout le monde; celui qui a lancé
 * lit son propre mot, « ma sauvegarde » (audit T06). `moi` est l'attribution
 * de cette page. */
export function sauvegardeAnnoncee(
  annonce: { save: string; saveSlot?: number; starter?: string },
  moi: string | null | undefined,
): string {
  const mienne = annonce.saveSlot === 2 && moi != null && annonce.starter === moi;
  return mienne ? slotLabel(2) : annonce.save;
}

/** La sauvegarde qu'un changement d'appareil Wii relancera, d'après l'annonce
 * d'un lancement.
 *
 * « Ma sauvegarde » (2) est celle de qui lance: le salon la résout par la
 * session qui envoie `begin`. Elle n'est donc la bonne que si cette page a
 * lancé; depuis une autre page, relancer 2 ouvrirait la sauvegarde d'une autre
 * personne. `null`: la page ne sait pas, et demande de passer par la
 * bibliothèque. `undefined`: l'annonce n'en dit rien, la page garde ce qu'elle
 * savait. */
export function sauvegardeRelancee(
  annonce: { saveSlot?: number; starter?: string },
  moi: string | null | undefined,
): Slot | null | undefined {
  if (annonce.saveSlot === 0 || annonce.saveSlot === 1) return annonce.saveSlot;
  if (annonce.saveSlot !== 2) return undefined;
  return moi != null && annonce.starter === moi ? 2 : null;
}

/** Ce qu'un salon d'avant le 22 novembre 2026 répond à un chef qui lance sans
 * avoir confirmé: il ignore le `pad` du lancement. */
const REFUS_SANS_CONFIRMATION = "Chaque joueur doit confirmer sa configuration.";

/** Le lancement du chef, compris aussi par un salon d'avant.
 *
 * Pendant une mise en service, la page (servie par le worker reconstruit) peut
 * être neuve et le salon encore ancien. Ce salon refuse un chef qui n'a pas
 * confirmé, et le chef n'a plus de bouton « Je suis prêt »: aucun jeu préparé
 * ne se lançait (vérification finale du 22 novembre 2026). Face à ce refus,
 * la page confirme le choix du chef puis relance, comme une page d'avant. Un
 * salon d'aujourd'hui a déjà confirmé ce choix au premier lancement: le second
 * passage ne change rien chez lui, et son refus se redit tel quel.
 *
 * « Sans attendre » n'existe pas chez un salon d'avant: son refus se dit. */
export async function lancerEnChef(
  send: (action: Record<string, unknown>) => Promise<void>,
  lancement: { id: string | undefined; pad: number; sans_attendre?: true },
): Promise<void> {
  try {
    await send({ action: "launch", ...lancement });
  } catch (error) {
    const ancien = error instanceof Error && error.message === REFUS_SANS_CONFIRMATION;
    if (!ancien || lancement.sans_attendre) throw error;
    await send({ action: "choose", id: lancement.id, pad: lancement.pad, ready: true });
    await send({ action: "launch", ...lancement });
  }
}

/** L'en-tête: la console du jeu préparé, jamais une console écrite en dur. */
export function titrePreparation(console: string | undefined): string {
  const nom = consoleName(console);
  return nom ? `Avant de jouer · ${nom}` : "Avant de jouer";
}

/** Le nom de l'appareil d'une place, dans la salle de ce jeu.
 *
 * `deviceLabel` connaît la salle: « manette Xbox 360 » pour une Xbox 360.
 * `padLabel` est le repli d'une console inconnue de la page. */
export function nomAppareil(pad: number | null | undefined, console: string | undefined): string {
  if (pad === null || pad === undefined) return "appareil à choisir";
  return deviceLabel(pad, console) ?? padLabel(pad);
}

/** Ce que la ligne d'un joueur dit de lui. */
export function ligneJoueur(joueur: Participant, console: string | undefined): string {
  return joueur.ready ? `${nomAppareil(joueur.pad, console)} · prêt` : "se prépare";
}

/** Des noms en une phrase: « Bo », « Bo et Cleo », « Bo, Cleo et Dami ». */
export function enUneListe(noms: readonly string[]): string {
  if (noms.length <= 1) return noms[0] ?? "";
  return `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}`;
}

/** Le geste principal du panneau, pour cette personne. */
export type Geste =
  | { quoi: "lancer"; label: string; actif: boolean }
  | { quoi: "pret"; label: string; actif: true };

export type Gestes = {
  /** Rien pour qui regarde sans place. */
  principal: Geste | null;
  /** Lancer sans les absents, quand le délai est passé. */
  sansAttendre: { label: string; note: string } | null;
  /** Une phrase sur ce qu'on attend, ou rien. */
  attente: string | null;
};

/**
 * Le geste de chacun, d'après la préparation et le temps écoulé.
 *
 * `moi` est l'attribution de cette page; `attenduMs` le temps depuis que la page
 * voit cette préparation. `console` nomme l'appareil donné à un absent.
 */
export function gestesDuLancement(
  pending: Preparation,
  moi: string | null,
  attenduMs: number,
  console?: string,
): Gestes {
  const joueur = pending.players.find((one) => one.claim === moi);
  if (!joueur) return { principal: null, sansAttendre: null, attente: null };
  const chef = pending.players.find((one) => one.claim === pending.starter);
  const absents = pending.players.filter((one) => one.claim !== pending.starter && !one.ready);
  const nomsAbsents = enUneListe(absents.map((one) => one.name ?? `place ${one.port}`));
  if (pending.starter === moi) {
    const pret = absents.length === 0;
    return {
      principal: { quoi: "lancer", label: "Lancer le jeu", actif: pret },
      sansAttendre:
        !pret && attenduMs >= ATTENTE_SANS_MS
          ? {
              label: `Lancer sans attendre ${nomsAbsents}`,
              note: `${nomsAbsents} ${absents.length > 1 ? "gardent leur" : "garde sa"} place, avec ${
                pending.allowed.length > 1
                  ? `${absents.length > 1 ? "leur" : "son"} choix ou la `
                  : "la "
              }${nomAppareil(pending.allowed[0], console)}.`,
            }
          : null,
      attente: pret ? null : `En attente ${de(nomsAbsents)}.`,
    };
  }
  return {
    principal: {
      quoi: "pret",
      label: joueur.ready ? "Modifier ma configuration" : "Je suis prêt",
      actif: true,
    },
    sansAttendre: null,
    attente: joueur.ready ? `${chef?.name ?? "Le chef"} lance le jeu.` : null,
  };
}

/** Une liste d'appareils n'a de sens qu'avec plus d'un choix.
 *
 * Une préparation GameCube proposait une liste à une seule option, « manette
 * GameCube », puis une seconde liste qui semblait choisir la même chose
 * (audit P6). Avec un seul appareil, on le nomme. */
export const choixAppareil = (allowed: readonly number[]): boolean => allowed.length > 1;

/** La scène « pret » d'Aïn à jouer entre deux annonces de la préparation :
 * « un » quand un joueur vient de dire qu'il est prêt, « tous » quand le
 * dernier le dit, `null` sinon.
 *
 * Seul un passage de non prêt à prêt compte, entre deux messages lus par
 * CETTE page : une page qui arrive quand tous sont prêts n'a rien vu passer,
 * et le même message deux fois ne joue rien. */
export function scenePret(
  avant: readonly Participant[] | null,
  apres: readonly Participant[],
): "un" | "tous" | null {
  if (avant === null) return null;
  const etait = new Map(avant.map((p) => [p.claim, p.ready]));
  if (!apres.some((p) => p.ready && etait.get(p.claim) === false)) return null;
  return apres.every((p) => p.ready) ? "tous" : "un";
}

/** Le titre du bloc de préparation : qui lance le prochain jeu (P4, P8).
 *
 * Il remplace « Avant de jouer · Console » en capitales : la console va dans
 * la ligne du jeu (`ligneDuJeu`), et le titre dit ce qui se passe. */
export function titreDuBloc(pending: Preparation, moi: string | null): string {
  if (pending.starter === moi) return PREPARATION.moi;
  const chef = pending.players.find((p) => p.claim === pending.starter);
  return PREPARATION.lance(chef?.name ?? PREPARATION.quelquun);
}

/** La ligne sous le titre : la console du jeu préparé et sa sauvegarde
 * (P4, P5). Une console inconnue de la page ne se nomme pas. */
export function ligneDuJeu(console: string | undefined, save: number): string {
  const sauvegarde = PREPARATION.sauvegarde(slotLabel(save as Slot));
  const nom = consoleName(console);
  return nom ? `${nom} · ${sauvegarde}` : sauvegarde;
}

/** Ce que dit le bouton START d'une place pendant une préparation (P3) :
 * « pret » ou « choisit », par numéro de place. Une place hors de la
 * préparation n'y figure pas. */
export function etatParPlace(pending: Preparation): ReadonlyMap<number, "pret" | "choisit"> {
  return new Map(pending.players.map((p) => [p.port, p.ready ? "pret" : "choisit"]));
}

/** Le compte de qui regarde (P9) : « 1 joueur sur 2 est prêt. » */
export function comptePrets(pending: Preparation): string {
  return PREPARATION.prets(pending.players.filter((p) => p.ready).length, pending.players.length);
}
