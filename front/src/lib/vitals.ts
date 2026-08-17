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

/** Combien de temps la trace fine remonte, en millisecondes.
 *
 * Deux minutes. C'est la question qu'on se pose devant un signalement: « et
 * juste avant, ça allait ? » Une minute rate le début d'une dégradation
 * progressive; cinq minutes triplent le poids pour couvrir un moment dont
 * personne ne se souvient.
 */
export const TRAIL_MS = 120_000;

/** À quel rythme la trace fine échantillonne, en millisecondes.
 *
 * Une seconde. Une saccade dure moins que ça, donc on ne la voit pas passer;
 * ce qu'on voit est sa FORME — trois secondes qui rament puis dix qui vont
 * bien — et c'est ce qui distingue une liaison qui hoquette d'une liaison qui
 * s'écroule.
 */
export const TRAIL_EVERY = 1000;

/** Ce que chaque seconde de la trace fine retient, dans cet ordre.
 *
 * Un tableau de nombres plutôt qu'un objet par ligne, et le nom des colonnes
 * écrit UNE fois à côté. Cent vingt objets nommés pèsent quarante fois leur
 * information; cent vingt tableaux pèsent trois kilo-octets et restent lisibles
 * tant que la légende voyage avec eux.
 *
 * `s` est en secondes AVANT le signalement, donc négatif. Explicite plutôt que
 * déduit du rang: un onglet en arrière-plan voit ses minuteurs ralentis à une
 * fois par minute par le navigateur, et une trace qui numéroterait ses lignes
 * prétendrait alors couvrir deux minutes qu'elle n'a pas vues. Le trou doit se
 * voir.
 */
export const TRAIL_COLUMNS = [
  "s",
  "peintes",
  "vues",
  "jetées",
  "affamées",
  "encours",
  "horaire",
  "gigue",
] as const;

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

/** La trace fine des deux dernières minutes, telle qu'elle part avec un
 * signalement. */
export type Trail = { colonnes: readonly string[]; lignes: number[][] };

/**
 * Les deux dernières minutes, à la seconde.
 *
 * # Pourquoi ça ne part QUE sur un signalement
 *
 * Envoyer ça en continu multiplierait le journal par quarante pour décrire des
 * minutes dont personne ne se plaindra jamais. Le relevé de dix secondes couvre
 * toute la séance et suffit à dater; la trace fine explique, et on ne veut
 * l'explication qu'à l'endroit où quelqu'un a dit « là ».
 *
 * # Ce qu'elle garde en mémoire
 *
 * Cent vingt lignes de huit nombres, remplacées en anneau. Rien qui grandisse
 * avec la durée de la séance: une page ouverte six heures ne doit pas finir par
 * tenir six heures de mesures.
 */
export class Trailing {
  private rows: { at: number; row: number[] }[] = [];
  private before: Snapshot | null = null;
  /** L'instant de la pousse précédente.
   *
   * Sans sentinelle. Une première version marquait « rien encore » par un zéro,
   * et le premier instant d'une page vaut justement zéro: les deux premières
   * secondes de chaque trace étaient jetées en silence. `before` dit déjà si
   * une pousse a eu lieu, donc ce champ n'a jamais à répondre à cette
   * question-là.
   */
  private stamped = 0;

  /** Une seconde de plus. `at` est l'instant de la page, en millisecondes.
   *
   * Les compteurs sont ramenés à la SECONDE plutôt que laissés bruts, parce
   * qu'un minuteur de navigateur n'arrive pas à l'heure: une page qui revient au
   * premier plan livre un intervalle de trente secondes, et la ligne dirait
   * « 1800 images peintes » à côté de voisines qui en disent soixante. On veut
   * comparer des secondes entre elles, donc on divise par la durée vraie.
   */
  push(now: Snapshot, at: number): void {
    const was = this.before;
    const previously = this.stamped;
    this.before = now;
    this.stamped = at;
    // La toute première pousse n'a rien à comparer: elle pose le point de
    // départ. Sans ce retour, la première ligne vaudrait les totaux depuis
    // l'ouverture de la page et écraserait l'échelle de toutes les autres.
    if (was === null) return;
    const elapsed = at - previously;
    if (elapsed <= 0) return;
    const seconds = elapsed / 1000;
    const step = vitals(now, was, elapsed);
    this.rows.push({
      at,
      // Le premier zéro tient la place du rang, rempli au signalement: c'est là
      // qu'on sait par rapport à QUOI dater.
      row: [
        0,
        Math.round(step.peintes / seconds),
        Math.round(step.vues / seconds),
        step.jetées,
        step.affamées,
        step.encours,
        step.horaire,
        step.gigue,
      ],
    });
    // L'anneau se ferme sur la DURÉE et pas sur le nombre de lignes: un onglet
    // ralenti en arrière-plan en produit soixante fois moins, et couper au
    // nombre lui ferait garder deux heures en croyant garder deux minutes.
    //
    // Ce que ça règle est la MÉMOIRE d'une page ouverte six heures. Ce que la
    // trace RENVOIE est filtré une seconde fois à la lecture, et les deux ne
    // font pas double emploi: entre deux pousses, l'anneau retient forcément une
    // ligne un peu trop vieille, et c'est au moment de répondre qu'on décide ce
    // que « deux minutes » veut dire. Un premier jet n'avait que le filtre, et
    // couper au nombre de lignes passait alors tous les tests.
    const oldest = at - TRAIL_MS;
    while (this.rows.length > 0 && (this.rows[0]?.at ?? 0) < oldest) this.rows.shift();
  }

  /** Combien de lignes la page retient en ce moment.
   *
   * Publié parce que c'est la borne mémoire de cet objet, et qu'une borne qu'on
   * ne peut pas observer est une borne qu'aucun test ne peut vérifier.
   */
  held(): number {
    return this.rows.length;
  }

  /** La trace, datée par rapport à l'instant du signalement. */
  trail(at: number): Trail {
    return {
      colonnes: TRAIL_COLUMNS,
      lignes: this.rows
        .filter((kept) => kept.at >= at - TRAIL_MS)
        .map((kept) => {
          const dated = kept.row.slice();
          dated[0] = Math.round((kept.at - at) / 1000);
          return dated;
        }),
    };
  }
}
