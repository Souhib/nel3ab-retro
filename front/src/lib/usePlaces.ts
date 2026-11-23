/**
 * Les arrivées et les départs aux places, et ce que la salle en fait : la
 * place qui s'allume (effet « arrive »), la scène de la mascotte par l'arbitre
 * de la salle (K10), et une phrase dite une fois.
 *
 * Remplace `useBranchements` de la Bobine (23 novembre 2026). La différence
 * entre deux états reste celle de `lib/arrivees` : la salle envoie un état
 * deux fois par seconde au plus, jamais un événement « untel arrive ».
 *
 * # Ce qui ne se joue pas
 *
 * - le premier état reçu : ouvrir la page sur une salle pleine n'est pas voir
 *   quatre personnes arriver ;
 * - tant que la salle n'est pas `stable` (un jeu qui démarre, une liaison
 *   qui n'est pas bonne) : un démarrage libère et reprend les places, et la
 *   mascotte jouerait des départs et des arrivées pour rien. La référence
 *   repart alors de zéro, comme un premier état ;
 * - plusieurs départs d'un coup : une salle qui ferme n'est pas quatre
 *   personnes qui s'en vont. Les places s'éteignent, la mascotte ne joue pas.
 *
 * # React hors du chemin d'image
 *
 * Tout se calcule sur l'état de la salle lu deux fois par seconde. Les
 * animations sont des attributs posés une fois (`data-joue`, `data-part`)
 * et retirés par un minuteur ; aucune boucle d'image ici.
 */
import { useEffect, useRef, useState } from "react";
import { pourTransition, type Scene } from "../mascotte";
import { sonMenu } from "../retro/sons";
import { differences, type Occupation } from "./arrivees";
import type { Hote } from "./cadre";
import { memoireDesVus } from "./memoire-des-vus";
import { ARRIVEES } from "./mots";
import type { Arbitre } from "./scenes-salle";

/** Combien de temps une place qui arrive porte `data-joue` : l'effet du socle
 * dure 1,3 s, et en mouvement réduit « 3P prêt ! » reste 2,2 s sans bouger. */
export const VIENT_MS = 2200;
/** Combien de temps une place qui part reste allumée en s'éteignant. */
export const PART_MS = 420;

/** La nature d'une phrase : une phrase « urgente » ne s'écrit jamais lettre
 * par lettre (effet « lettres » du socle). Une arrivée ou un départ sont
 * ordinaires. */
export type Nature = "ordinaire" | "urgente";
export type Annoncer = (phrase: string, nature: Nature) => void;

export type SuiviDesPlaces = {
  /** Les places tenues, la mienne comprise, et leurs noms. */
  occupation: Occupation;
  /** Ma place, ou `null` quand je regarde. */
  mienne: number | null;
  /** Les noms de ceux qui regardent sans place. */
  regardent: readonly string[];
  /** La salle, pour séparer les mémoires d'une salle à l'autre. */
  salle: string;
  /** Faux pendant un démarrage de jeu ou une liaison qui n'est pas bonne. */
  stable: boolean;
  /** L'arbitre des scènes de la salle (`useArbitre`), ou `null` hors cadre. */
  arbitre: Arbitre | null;
  /** Où la mascotte joue cette scène (`ouEstLaMascotte`), ou `null`. */
  hote: (scene: Scene) => Hote | null;
  annoncer: Annoncer;
};

type Changement = {
  phrases: string[];
  scene: Scene | null;
  vient: number[];
  part: number[];
};

/**
 * Ce qu'un changement d'état fait, sans DOM ni horloge : les places qui
 * s'allument et s'éteignent, la phrase, et la scène. `avant` vaut `null` pour
 * le premier état reçu.
 */
export function changement(
  avant: { occupation: Occupation; mienne: number | null; regardent: readonly string[] } | null,
  apres: { occupation: Occupation; mienne: number | null; regardent: readonly string[] },
  dejaVus: ReadonlySet<string>,
): Changement {
  const rien: Changement = { phrases: [], scene: null, vient: [], part: [] };
  if (avant === null) return rien;
  const { arrivees, departs } = differences(avant.occupation, apres.occupation, dejaVus);
  const phrases: string[] = [];
  const vient: number[] = [];
  const part: number[] = [];

  // Ma place prise par quelqu'un d'autre : une seule phrase, pour moi.
  const prise =
    avant.mienne !== null && apres.mienne !== avant.mienne
      ? (arrivees.find((a) => a.port === avant.mienne && a.nom !== null) ?? null)
      : null;

  const changeDeMain = new Set(arrivees.map((a) => a.port));
  for (const depart of departs) {
    // Une place qui change de main ne s'éteint pas : elle se rallume aussitôt.
    if (!changeDeMain.has(depart.port)) part.push(depart.port);
    if (prise !== null && depart.port === prise.port) continue;
    const nom = avant.occupation.noms.get(depart.port) ?? null;
    phrases.push(
      nom === null ? ARRIVEES.departSansNom(depart.port) : ARRIVEES.depart(nom, depart.port),
    );
  }
  for (const arrivee of arrivees) {
    vient.push(arrivee.port);
    if (prise !== null && arrivee.port === prise.port) {
      phrases.push(ARRIVEES.prisePar(arrivee.port, arrivee.nom ?? ""));
      continue;
    }
    if (arrivee.nom === null) phrases.push(ARRIVEES.sansNom(arrivee.port));
    else if (arrivee.facon === "premiere")
      phrases.push(ARRIVEES.premiere(arrivee.nom, arrivee.port));
    else phrases.push(ARRIVEES.retour(arrivee.nom, arrivee.port));
  }

  // Qui se met à regarder : ni ceux qui étaient déjà là, ni ceux qui viennent
  // de rendre leur place (le départ le dit déjà).
  const assis = new Set(avant.occupation.noms.values());
  const dejaLa = new Set(avant.regardent);
  const nouveaux = apres.regardent.filter((nom) => !dejaLa.has(nom) && !assis.has(nom));
  for (const nom of nouveaux) phrases.push(ARRIVEES.regarde(nom));

  // Une scène par changement, la plus forte : une première arrivée, sinon un
  // départ seul, sinon un spectateur. La table du socle (`pourTransition`)
  // dit quelle scène joue chaque événement.
  let scene: Scene | null = null;
  if (arrivees.some((a) => a.facon === "premiere" && a.nom !== null)) {
    scene = pourTransition(null, null, { evenement: "place", enPartie: true })?.scene ?? null;
  } else if (departs.length === 1 && arrivees.length === 0) {
    scene = pourTransition(null, null, { evenement: "depart", enPartie: true })?.scene ?? null;
  } else if (nouveaux.length > 0 && arrivees.length === 0 && departs.length === 0) {
    scene = pourTransition(null, null, { evenement: "spectateur", enPartie: true })?.scene ?? null;
  }
  return { phrases, scene, vient, part };
}

export function usePlaces(s: SuiviDesPlaces): {
  vient: ReadonlySet<number>;
  part: ReadonlySet<number>;
} {
  const memoire = useRef(memoireDesVus(s.salle));
  const avant = useRef<Parameters<typeof changement>[0]>(null);
  const [vient, setVient] = useState<ReadonlySet<number>>(VIDE);
  const [part, setPart] = useState<ReadonlySet<number>>(VIDE);
  const minuteurs = useRef<number[]>([]);

  // L'état arrive dans des objets neufs même quand rien ne change : l'effet
  // suit son RÉSUMÉ, et lit le reste dans une référence tenue à jour.
  const actuel = useRef(s);
  actuel.current = s;
  const cle = JSON.stringify([
    s.stable,
    s.mienne,
    s.occupation.tenues,
    [...s.occupation.noms.entries()],
    [...s.regardent].sort(),
  ]);

  useEffect(() => {
    const e = actuel.current;
    if (!e.stable) {
      avant.current = null;
      return;
    }
    const apres = { occupation: e.occupation, mienne: e.mienne, regardent: e.regardent };
    const fait = changement(avant.current, apres, memoire.current.vus());
    avant.current = apres;
    for (const [port, nom] of e.occupation.noms) {
      if (e.occupation.tenues[port - 1] === true || port === e.mienne) memoire.current.retiens(nom);
    }
    if (fait.phrases.length > 0) e.annoncer(fait.phrases.join(" "), "ordinaire");
    if (fait.vient.length > 0) sonMenu("piece");
    if (fait.scene !== null) {
      const hote = e.hote(fait.scene);
      if (hote !== null) e.arbitre?.demander({ scene: fait.scene, par: "personnes", hote });
    }
    const poser = (
      ports: number[],
      ms: number,
      changer: (f: (avant: ReadonlySet<number>) => ReadonlySet<number>) => void,
    ) => {
      if (ports.length === 0) return;
      changer((anciennes) => new Set([...anciennes, ...ports]));
      const id = window.setTimeout(() => {
        changer((anciennes) => {
          const suite = new Set(anciennes);
          for (const port of ports) suite.delete(port);
          return suite;
        });
      }, ms);
      minuteurs.current.push(id);
    };
    poser(fait.vient, VIENT_MS, setVient);
    poser(fait.part, PART_MS, setPart);
  }, [cle]);

  useEffect(
    () => () => {
      for (const id of minuteurs.current) window.clearTimeout(id);
    },
    [],
  );

  return { vient, part };
}

const VIDE: ReadonlySet<number> = new Set();
