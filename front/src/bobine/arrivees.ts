/**
 * Qui vient de se brancher, et qui vient de partir.
 *
 * La salle n'envoie pas d'événement « untel arrive »: elle envoie un état, deux
 * fois par seconde au plus. Une arrivée, c'est donc une DIFFÉRENCE entre deux
 * états: une prise libre qui devient tenue. Ce module fait cette différence et
 * rien d'autre, sans DOM ni horloge, pour qu'un test puisse la vérifier.
 *
 * Trois façons d'arriver, et elles ne méritent pas le même geste:
 * - « premiere »: quelqu'un de connu qui ne s'est jamais branché dans cette
 *   salle. Bobine vient lui brancher sa manette;
 * - « retour »: quelqu'un de connu déjà vu. La fiche claque dans la prise, et
 *   c'est tout: refaire la scène à chaque retour la rendrait vite pénible;
 * - « fantome »: une prise tenue sans nom connu (un rechargement, un joueur que
 *   le salon ne nomme pas encore). Même geste que le retour.
 *
 * Le premier état reçu ne produit AUCUNE arrivée. Ouvrir la page sur une salle
 * pleine n'est pas voir quatre personnes arriver.
 *
 * Qui décide de « première » ou « retour »: le SALON d'abord. Il le lit dans le
 * journal des parties et l'envoie avec la prise (`Seat.premiere`), le même pour
 * toutes les pages de la salle. Sans réponse du salon (personne sans identité,
 * journal illisible, salon d'avant le 21 novembre 2026), la mémoire de ce
 * navigateur décide, comme avant: un autre appareil peut alors rejouer la scène
 * une fois de plus.
 */

export type Occupation = {
  /** Une case par prise, vraie si elle est tenue. */
  tenues: readonly boolean[];
  /** Le nom de qui tient chaque prise, quand le salon le connaît. */
  noms: ReadonlyMap<number, string>;
  /** Ce que le salon dit de chaque prise tenue: première fois ou non. Une
   * prise absente veut dire « le salon ne sait pas ». */
  premieres?: ReadonlyMap<number, boolean>;
};

export type Arrivee = {
  port: number;
  nom: string | null;
  facon: "premiere" | "retour" | "fantome";
};

export type Depart = { port: number };

export function differences(
  avant: Occupation | null,
  apres: Occupation,
  dejaVus: ReadonlySet<string>,
): { arrivees: Arrivee[]; departs: Depart[] } {
  if (avant === null) return { arrivees: [], departs: [] };
  const arrivees: Arrivee[] = [];
  const departs: Depart[] = [];
  const ports = Math.max(avant.tenues.length, apres.tenues.length);
  for (let slot = 0; slot < ports; slot += 1) {
    const port = slot + 1;
    const etait = avant.tenues[slot] ?? false;
    const est = apres.tenues[slot] ?? false;
    const ancien = avant.noms.get(port) ?? null;
    const nom = apres.noms.get(port) ?? null;
    if (!etait && est) {
      arrivees.push({ port, nom, facon: facon(nom, apres.premieres?.get(port), dejaVus) });
      continue;
    }
    if (etait && !est) {
      departs.push({ port });
      continue;
    }
    // Une prise qui change de main sans passer par « libre » entre deux états:
    // c'est un départ et une arrivée, vus en une fois.
    if (etait && est && nom !== null && ancien !== null && nom !== ancien) {
      departs.push({ port });
      arrivees.push({ port, nom, facon: facon(nom, apres.premieres?.get(port), dejaVus) });
    }
  }
  return { arrivees, departs };
}

function facon(
  nom: string | null,
  salon: boolean | undefined,
  dejaVus: ReadonlySet<string>,
): Arrivee["facon"] {
  if (nom === null) return "fantome";
  if (salon !== undefined) return salon ? "premiere" : "retour";
  return dejaVus.has(nom) ? "retour" : "premiere";
}
