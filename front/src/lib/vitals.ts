/**
 * Ce que le navigateur mesure, réduit à ce qui tient sur une ligne.
 *
 * # Le trou que ça bouche
 *
 * Le salon sait maintenant qui est venu, quand, et sur quelle manette. Il ne
 * sait toujours rien de ce que ces gens ont VU. Or les trois pannes de la
 * semaine se sont toutes résolues sur un chiffre du navigateur — les images
 * jetées avant leur tour, les places dans la file, la gigue de la liaison — et
 * ces chiffres meurent avec l'onglet.
 *
 * Deux fois, il a fallu demander une capture d'écran du panneau à quelqu'un qui
 * jouait pour savoir ce qui se passait chez lui. C'est la mesure qu'on garde
 * ici, à la place.
 *
 * # Pourquoi des ÉCARTS et pas des totaux
 *
 * Un total dit « 41 230 images peintes depuis l'ouverture », ce qui ne se lit
 * qu'en le comparant à la ligne d'avant. Un écart dit « sur les dix dernières
 * secondes: 600 arrivées, 598 peintes, 2 jetées », ce qui se lit seul.
 *
 * Le prix de ce choix est qu'une ligne perdue est une fenêtre perdue, au lieu
 * d'être rattrapée par la suivante. À dix secondes d'intervalle sur une socket
 * qui se rouvre toute seule, c'est un prix qu'on paie volontiers pour un
 * journal qu'on peut lire sans outil.
 *
 * # Ce qui reste des jauges
 *
 * L'horaire, la gigue, la file et le format ne sont pas des compteurs: ce sont
 * des états. On les prend tels quels, à l'instant du relevé.
 *
 * # Rien ici ne touche au chemin des images
 *
 * Cette fonction est pure et ne lit qu'un instantané que React reçoit déjà deux
 * fois par seconde. Elle tourne toutes les dix secondes, sur le fil des
 * événements, et ne connaît ni la toile ni le décodeur.
 */
import type { Snapshot } from "../media/session";

/** Un relevé, tel qu'il part vers le salon. */
export type Vitals = {
  /** Combien de secondes la fenêtre couvre. */
  s: number;
  /** Images arrivées, peintes, et jetées avant leur tour. */
  vues: number;
  peintes: number;
  jetées: number;
  /** Fois où la file s'est vidée, et où il a fallu redemander une image clé. */
  affamées: number;
  clés: number;
  /** Fois où la socket vidéo est repartie de zéro. */
  rouvertes: number;
  /** Combien de rafraîchissements une image tient: p05, p50, p95. */
  tenue: [number, number, number];
  /** L'irrégularité de la liaison, en millisecondes. Zéro sur une bonne. */
  gigue: number;
  /** Le retard que la page s'ajoute avant de peindre, en millisecondes. */
  horaire: number;
  /** Ce que la file peut tenir, et ce qu'elle tient. */
  file: number;
  encours: number;
  /** Ce que le décodeur a vraiment produit, et si c'est le flux réduit. */
  format: string;
  demi: boolean;
  /** Les deux cadences: celle du jeu, celle de l'écran. */
  jeuHz: number;
  écranHz: number;
  /** Le son: morceaux reçus, trous, avance en millisecondes. */
  son: { morceaux: number; trous: number; avance: number; état: string };
  /** La manette: la place tenue, et les trames envoyées sur la fenêtre. */
  manette: { place: number | null; envoyées: number };
};

/**
 * Un écart qui ne peut pas être négatif.
 *
 * Les compteurs de la page repartent de zéro quand le flux se rouvre, ce qui
 * arrive à chaque changement de jeu et à chaque coupure. Sans ce plancher, la
 * fenêtre qui enjambe une reprise annonce « moins quarante mille images
 * peintes », et un chiffre absurde dans un journal est un journal qu'on cesse
 * de croire.
 */
function since(now: number, before: number): number {
  return Math.max(0, now - before);
}

/**
 * Le relevé d'une fenêtre.
 *
 * `before` nul veut dire que c'est le premier: les écarts valent alors les
 * totaux depuis l'ouverture de la page, ce qui est exact.
 */
export function vitals(now: Snapshot, before: Snapshot | null, elapsedMs: number): Vitals {
  const was = before?.video;
  const wasSound = before?.sound;
  const wasInput = before?.input;
  const { video, sound, input } = now;
  return {
    s: Math.round(elapsedMs / 100) / 10,
    vues: since(video.shown, was?.shown ?? 0),
    peintes: since(video.painted, was?.painted ?? 0),
    jetées: since(video.skipped, was?.skipped ?? 0),
    affamées: since(video.starved, was?.starved ?? 0),
    clés: since(video.keyFramesAsked, was?.keyFramesAsked ?? 0),
    rouvertes: since(video.reconnects, was?.reconnects ?? 0),
    tenue: [video.heldRefreshes.p05, video.heldRefreshes.p50, video.heldRefreshes.p95],
    gigue: Math.round(video.jitterMs),
    horaire: video.addedMs,
    file: video.room,
    encours: video.backlog,
    format: `${video.picture.width}x${video.picture.height}`,
    demi: video.half,
    jeuHz: Math.round(video.sourceHz),
    écranHz: Math.round(video.refreshHz),
    son: {
      morceaux: since(sound.chunks, wasSound?.chunks ?? 0),
      trous: since(sound.gaps, wasSound?.gaps ?? 0),
      avance: Math.round(sound.leadMs),
      état: sound.state,
    },
    manette: {
      place: input.port,
      envoyées: since(input.sent, wasInput?.sent ?? 0),
    },
  };
}

/**
 * Vrai quand la fenêtre mérite d'être écrite.
 *
 * Une page en arrière-plan, un onglet ouvert sur la salle sans regarder, une
 * séance de spectateur muette: toutes produisent des relevés vides, six par
 * minute, qui noieraient les vraies dans un journal gardé deux jours.
 *
 * Le seuil est « au moins une image ». Ce n'est pas un filtre sur ce qui va MAL:
 * une fenêtre parfaitement saine reste écrite, parce que savoir que tout allait
 * bien à 21 h 12 est la moitié de ce qui permet de dater un problème.
 */
export function worthWriting(sample: Vitals): boolean {
  return sample.vues > 0 || sample.peintes > 0;
}
