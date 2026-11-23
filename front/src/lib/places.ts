/**
 * Les places START 1P à 4P, sans DOM : ce que chaque place montre, ce que
 * son nom accessible dit, et ce qu'un toucher y fait.
 *
 * # Trois gestes, et ils ne se ressemblent pas
 *
 * - une place LIBRE ne coûte rien à personne : un toucher la prend ;
 * - une place TENUE, nommée ou non, ouvre la carte de cette place
 *   (`components/CartePlace`) : on y demande la place à qui la tient, ou on
 *   la reprend quand personne n'y est nommé. Rien ne se prend à quelqu'un
 *   d'un seul toucher : c'est le seul geste de la page qui se voit sur
 *   l'écran d'un autre ;
 * - SA place ouvre aussi sa carte : « Rendre ma place » y est, et rien qui
 *   quitterait la salle en pleine partie.
 *
 * Le double toucher qui reprenait une place sans nom (`Seats`, jusqu'au
 * 23 novembre 2026) devient un bouton de la carte : il disait la même chose
 * par un état caché de cinq secondes.
 */
import type { FormePanneau, Hote } from "./cadre";
import { initialesDeLaSalle } from "./etiquette";
import { PLACES } from "./mots";

export type EtatPlace = "free" | "busy" | "mine";

/** Une place telle que le panneau la montre. */
export type Place = {
  port: number;
  /** `data-state`, lu par les pilotes de navigateur. */
  etat: EtatPlace;
  /** Le nom de qui la tient, quand le salon le connaît ; jamais inventé. */
  nom: string | null;
  /** Ses trois initiales dans la salle, doublons résolus ; `null` sans nom. */
  lettres: string | null;
  /** Qui la tient choisit le jeu : la couronne. Jamais sur une place libre. */
  chef: boolean;
  /** Le micro de cette place capte-t-il sa voix. */
  micro: boolean;
};

export type EntreePlaces = {
  /** Combien de places la console a (4, ou moins). */
  places: number;
  /** Une case par place, vraie quand elle est tenue. */
  tenues: readonly boolean[];
  noms: ReadonlyMap<number, string>;
  micros: readonly boolean[];
  /** La place de qui choisit le jeu, selon le salon. */
  chef: number | null | undefined;
  /** Ma place, ou `null` quand je regarde. */
  mienne: number | null;
};

/** Les places, une par numéro, dans l'ordre. */
export function lesPlaces(e: EntreePlaces): Place[] {
  const tenusNommes = new Map<number, string>();
  for (const [port, nom] of e.noms) {
    if (port === e.mienne || e.tenues[port - 1] === true) tenusNommes.set(port, nom);
  }
  const lettres = initialesDeLaSalle(tenusNommes);
  return Array.from({ length: e.places }, (_, slot) => {
    const port = slot + 1;
    const etat: EtatPlace = port === e.mienne ? "mine" : e.tenues[slot] === true ? "busy" : "free";
    const nom = etat === "free" ? null : (tenusNommes.get(port) ?? null);
    return {
      port,
      etat,
      nom,
      lettres: lettres.get(port) ?? null,
      // La couronne marque une personne : sans nom ou sur une place libre, le
      // salon désigne une place que personne n'occupe pour la page.
      chef: etat !== "free" && nom !== null && port === e.chef,
      micro: e.micros[slot] ?? false,
    };
  });
}

/** Le nom accessible d'une place : la place, qui, ce que fait un toucher. */
export function nomDePlace(p: Place): string {
  if (p.etat === "free") return PLACES.libre(p.port);
  const details: string[] = [];
  if (p.chef) details.push(p.etat === "mine" ? PLACES.tuChoisis : PLACES.choisit);
  if (!p.micro) details.push(PLACES.microCoupe);
  const suite = details.length > 0 ? `, ${details.join(", ")}` : "";
  if (p.etat === "mine") return `${PLACES.aToi(p.port)}${suite}`;
  if (p.nom === null) return PLACES.tenue(p.port);
  return `${PLACES.aQuelquun(p.port, p.nom)}${suite} : ${PLACES.demander}`;
}

/** Ce que fait un toucher sur une place. */
export function gesteDe(p: Place): "prendre" | "carte" {
  return p.etat === "free" ? "prendre" : "carte";
}

/** La phrase du rôle, sous la rangée : ce que je fais ici, et ce qu'un
 * toucher peut changer. `libres` compte les places que je pourrais prendre. */
export function phraseDuRole(mienne: number | null, libres: number): string {
  if (mienne !== null) return PLACES.roleJoue(mienne);
  return libres > 0 ? PLACES.roleLibre : PLACES.rolePlein;
}

/** Les formes de la rangée, une par forme du panneau que le cadre calcule. */
export type FormePlaces = "rangee" | "deux-rangees" | "debout" | "petite";

export function formeDesPlaces(forme: Exclude<FormePanneau, "absent">): FormePlaces {
  switch (forme) {
    case "sous":
      return "rangee";
    case "colonne":
      return "deux-rangees";
    case "debout":
      return "debout";
    case "petit":
      return "petite";
  }
}

/**
 * Échap ferme-t-il la carte d'une place ? Seulement quand le focus est dans
 * la carte ou sur la place qui l'a ouverte : ailleurs, Échap garde son sens
 * (le menu du jeu depuis la zone de jeu).
 */
export function echapFermeLaCarte(
  focus: Element | null,
  carte: Element | null,
  place: Element | null,
): boolean {
  if (focus === null || carte === null) return false;
  return carte.contains(focus) || (place !== null && place === focus);
}

/** Le temps que le salon laisse à qui tient une place pour répondre à une
 * reprise, en secondes : `ANSWER_WITHIN` de
 * `control/nel3ab_control/api/controllers/recovery.py`. La carte le dit
 * AVANT la demande ; pendant, elle lit le temps restant que le salon envoie. */
export const REPRISE_REPONSE_S = 20;

/** Où une arrivée ou un départ se joue : là où le cadre le dit
 * (`ouEstLaMascotte`), sauf sur l'écran éteint. Au repos, « Choisir un jeu »
 * est au centre du plateau, et la scène d'arrivée s'y posait dessus
 * (cadre.mjs, mascotte-hors-image, 23 novembre 2026). Une arrivée parle des
 * places : elle se joue au bord du panneau quand il est sous l'image, dans
 * la barre d'un téléphone, sinon dans le coin de la colonne. */
export function hoteDesPlaces(
  cadre: Hote | null,
  { tenu, panneauSous }: { tenu: boolean; panneauSous: boolean },
): Hote | null {
  if (cadre !== "plateau") return cadre;
  if (tenu) return "barre";
  return panneauSous ? "bord-panneau" : "coin";
}
