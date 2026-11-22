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
import { padLabel } from "./saves";

/** Après combien de temps le chef peut lancer sans un joueur.
 *
 * Le même que le salon (`ATTENTE_SANS`, vingt secondes). La page compte depuis
 * qu'ELLE voit la préparation, donc toujours après le salon: elle ne propose
 * jamais un geste que le salon refuserait pour cause de hâte. */
export const ATTENTE_SANS_MS = 20_000;

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
      attente: pret ? null : `En attente de ${nomsAbsents}.`,
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
