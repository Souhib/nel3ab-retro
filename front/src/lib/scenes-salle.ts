/**
 * L'arbitre des scènes de la mascotte dans la salle (K10 de la partition).
 *
 * # Pourquoi un arbitre
 *
 * `jouer()` du socle coupe la scène en cours sur le même hôte, sans priorité.
 * Cinq chantiers jouent des scènes dans la salle : une panne (états), un
 * lancement (menus), une arrivée (personnes), une fin de leçon (manettes), la
 * première image (salle). Sans arbitre, une panne et une arrivée au même
 * instant se couperaient selon l'ordre des rendus, et la phrase d'une panne
 * pourrait disparaître sous un « 3P arrive ».
 *
 * # La règle
 *
 * - un rang par chantier : états, puis menus, puis personnes, puis manettes,
 *   puis salle ; une scène de rang égal ou plus haut remplace celle en cours,
 *   une scène de rang plus bas est refusée tant que l'autre joue ;
 * - pendant une panne (`enPanne` du cadre), seul états joue : la fiche d'état
 *   parle, rien ne lui passe devant ;
 * - chaque chantier ne joue que ses scènes (`SCENES_DE`) ; « premiere-image »
 *   n'a qu'un appelant, le cadre de la salle (K06) ;
 * - un hôte par endroit, et le coin et le bord du panneau sont le même
 *   personnage : une arrivée au bord du panneau coupe la scène du coin.
 *
 * La décision est une fonction pure (`decider`) ; `creerArbitre` la branche
 * sur `jouer()` et se souvient de ce qui joue, hôte par hôte.
 */
import { jouer as jouerMascotte, type Lecture, type Scene, type Version } from "../mascotte";
import { enPanne, type EtatDuCadre, type Hote } from "./cadre";

export const CHANTIERS = ["etats", "menus", "personnes", "manettes", "salle"] as const;
/** Le chantier qui demande la scène. */
export type Chantier = (typeof CHANTIERS)[number];

/** Le rang de chacun : le plus grand passe avant. */
export const RANG: Readonly<Record<Chantier, number>> = {
  etats: 5,
  menus: 4,
  personnes: 3,
  manettes: 2,
  salle: 1,
};

/**
 * Les scènes de chaque chantier dans la salle, d'après la table des scènes de
 * la partition. « ouvre », « range », « depot » et « demo » sont au salon :
 * aucun chantier ne les joue dans la salle. « refus » est la promesse du salon
 * refusée, que menus dit dans la salle.
 */
export const SCENES_DE: Readonly<Record<Chantier, readonly Scene[]>> = {
  etats: [
    "attente",
    "chercher",
    "rebrancher",
    "arret",
    "coupe",
    "decroche",
    "redemarre",
    "endort",
    "dort",
    "pret",
  ],
  menus: ["attente", "chercher", "pret", "refus"],
  personnes: ["arrivee", "depart"],
  manettes: ["fier"],
  salle: ["attente", "premiere-image", "fier"],
};

/** Les scènes qui ne se jouent jamais dans la salle. */
export const HORS_SALLE: readonly Scene[] = ["ouvre", "range", "depot", "demo"];

/** Le coin et le bord du panneau sont le même personnage, au bureau. */
export const FAMILLE: Readonly<Record<Hote, "plateau" | "coin" | "barre">> = {
  plateau: "plateau",
  coin: "coin",
  "bord-panneau": "coin",
  barre: "barre",
};

export type EnCours = { scene: Scene; par: Chantier } | null;

export const RAISONS = ["hors-salle", "pas-a-lui", "panne", "plus-haut"] as const;
export type Raison = (typeof RAISONS)[number];

/** La décision, pure : jouer, ou refuser avec sa raison. */
export function decider(e: {
  enCours: EnCours;
  scene: Scene;
  par: Chantier;
  etat: EtatDuCadre;
}): { jouer: true } | { jouer: false; raison: Raison } {
  if (HORS_SALLE.includes(e.scene)) return { jouer: false, raison: "hors-salle" };
  if (!SCENES_DE[e.par].includes(e.scene)) return { jouer: false, raison: "pas-a-lui" };
  if (enPanne(e.etat) && e.par !== "etats") return { jouer: false, raison: "panne" };
  if (e.enCours !== null && RANG[e.par] < RANG[e.enCours.par]) {
    return { jouer: false, raison: "plus-haut" };
  }
  return { jouer: true };
}

export type Demande = {
  scene: Scene;
  par: Chantier;
  hote: Hote;
  version?: Version | "auto";
  region?: HTMLElement | null;
  phrase?: string;
};

export type Arbitre = {
  /** Joue la scène si l'arbitre l'accepte ; rend la lecture, ou `null`. */
  demander(demande: Demande): Lecture | null;
  /** Coupe ce qui joue à cet endroit : la première image coupe le plateau
   * dans la même tâche. */
  couper(hote: Hote): void;
  /** Ce qui joue à cet endroit. */
  enCours(hote: Hote): EnCours;
};

/**
 * L'arbitre d'une salle.
 *
 * `hote` rend l'élément où poser la mascotte pour un endroit, ou `null`
 * quand l'endroit n'est pas monté (pas de plateau quand l'image est là) :
 * la demande est alors refusée sans bruit. `etat` est lu à chaque demande :
 * l'arbitre ne garde pas de copie de l'état du cadre.
 */
export function creerArbitre(o: {
  hote: (hote: Hote) => HTMLElement | null;
  etat: () => EtatDuCadre;
  jouer?: typeof jouerMascotte;
}): Arbitre {
  const jouer = o.jouer ?? jouerMascotte;
  const joue = new Map<"plateau" | "coin" | "barre", { lecture: Lecture; par: Chantier }>();

  return {
    demander(d) {
      const famille = FAMILLE[d.hote];
      const courant = joue.get(famille);
      const decision = decider({
        enCours: courant ? { scene: courant.lecture.scene, par: courant.par } : null,
        scene: d.scene,
        par: d.par,
        etat: o.etat(),
      });
      if (!decision.jouer) return null;
      const element = o.hote(d.hote);
      if (element === null) return null;
      courant?.lecture.interrompre();
      const lecture = jouer(d.scene, {
        hote: element,
        version: d.version,
        region: d.region,
        phrase: d.phrase,
      });
      if (lecture.refusee) return null;
      const entree = { lecture, par: d.par };
      joue.set(famille, entree);
      void lecture.fini.then(() => {
        if (joue.get(famille) === entree) joue.delete(famille);
      });
      return lecture;
    },
    couper(hote) {
      const famille = FAMILLE[hote];
      const courant = joue.get(famille);
      if (!courant) return;
      joue.delete(famille);
      courant.lecture.interrompre();
    },
    enCours(hote) {
      const courant = joue.get(FAMILLE[hote]);
      return courant ? { scene: courant.lecture.scene, par: courant.par } : null;
    },
  };
}
