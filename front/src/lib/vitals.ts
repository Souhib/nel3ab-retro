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
  son: {
    morceaux: number;
    trous: number;
    avance: number;
    état: string;
    /** Ce qu'est devenu le déblocage d'iOS, le volume appliqué, la cadence du
     * matériel et ce qu'il ajoute. Quatre chiffres qui ne servent qu'à une
     * chose: dire pourquoi un téléphone reste muet alors que tout a l'air de
     * marcher. */
    débloqué: string;
    gain: number;
    cadence: number;
    sortie: number;
  };
  /** L'écart entre deux images REÇUES, en millisecondes: p50, p95, max.
   *
   * Sur les six cents dernières, soit dix secondes à 60 images par seconde. Le
   * 14 septembre 2026, la boîte noire a montré qu'une lecture du debugfs arrêtait
   * le jeu cent millisecondes: ce trou-là se lit ici, chez chaque joueur, et il
   * se distingue d'une liaison qui hoquette parce qu'il tombe au même instant sur
   * toutes les pages. */
  arrivées: [number, number, number];
  /** La manette: la place tenue, et les trames envoyées sur la fenêtre. */
  manette: {
    place: number | null;
    envoyées: number;
    /** L'aller-retour d'une trame jusqu'à la salle, médiane des trente
     * derniers. Nul veut dire « pas encore mesuré », jamais « zéro ». */
    allerRetour: number | null;
    /** Le nom que le navigateur donne à la manette qui joue, coupé à
     * `PAD_NAME_MAX`. Nul sans manette: clavier ou écran tactile. */
    modèle: string | null;
  };
  /** L'onglet: visible à l'instant du relevé, et combien de millisecondes de la
   * fenêtre il a passé caché. Absent de la trace fine, qui ne le mesure pas. */
  page?: { visible: boolean; cachéeMs: number };
};

/** Combien de caractères du nom d'une manette on garde.
 *
 * Soixante-quatre. Chrome écrit « Xbox 360 Controller (XInput STANDARD GAMEPAD) »,
 * 46 caractères, et Firefox y ajoute les identifiants USB. La borne tient le
 * relevé loin de celle du salon (`VITALS_MAX`, deux kilo-octets) quel que soit
 * le nom qu'un pilote invente. */
export const PAD_NAME_MAX = 64;

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
export function vitals(
  now: Snapshot,
  before: Snapshot | null,
  elapsedMs: number,
  page?: { visible: boolean; cachéeMs: number },
): Vitals {
  const was = before?.video;
  const wasSound = before?.sound;
  const wasInput = before?.input;
  const { video, sound, input } = now;
  return {
    ...(page ? { page } : {}),
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
      débloqué: sound.unlocked,
      gain: Math.round(sound.gain * 100) / 100,
      cadence: sound.sampleRate,
      sortie: Math.round(sound.output),
    },
    arrivées: [
      Math.round(video.gapMs.p50),
      Math.round(video.gapMs.p95),
      Math.round(video.gapMs.max),
    ],
    manette: {
      place: input.port,
      envoyées: since(input.sent, wasInput?.sent ?? 0),
      allerRetour: input.roundTripMs,
      modèle: input.padId === null ? null : input.padId.slice(0, PAD_NAME_MAX),
    },
  };
}

/**
 * Combien de temps l'onglet est resté caché.
 *
 * # Pourquoi c'est une mesure et pas un détail
 *
 * Un onglet caché voit ses minuteurs ralentis et ne peint plus. Ses relevés
 * disent alors « zéro image peinte » exactement comme une page dont la vidéo est
 * cassée. Savoir qu'il était caché sépare les deux sans demander à personne.
 *
 * Nourri par l'événement `visibilitychange` et lu toutes les dix secondes: rien
 * sur le chemin des images.
 */
export class HiddenTime {
  private since: number | null;
  private total = 0;

  /** `hidden` est l'état au départ, `at` l'instant de la page en millisecondes. */
  constructor(hidden: boolean, at: number) {
    this.since = hidden ? at : null;
  }

  /** L'onglet vient d'être caché ou montré. Un état répété ne compte pas deux fois. */
  change(hidden: boolean, at: number): void {
    if (hidden && this.since === null) this.since = at;
    if (!hidden && this.since !== null) {
      this.total += Math.max(0, at - this.since);
      this.since = null;
    }
  }

  /** Le temps caché depuis la lecture précédente, et on repart de zéro.
   *
   * Un onglet encore caché compte jusqu'à `at`, puis repart de `at`: sinon une
   * page cachée depuis une heure n'aurait rien écrit, puis tout d'un coup. */
  take(at: number): number {
    const hiddenMs = this.peek(at);
    this.total = 0;
    if (this.since !== null) this.since = at;
    return hiddenMs;
  }

  /** Le même chiffre, sans repartir de zéro: pour un signalement, qui ne doit pas
   * voler sa fenêtre au relevé suivant. */
  peek(at: number): number {
    const running = this.since === null ? 0 : Math.max(0, at - this.since);
    return Math.round(this.total + running);
  }
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

/** À partir de quel trou dans l'arrivée des images une fenêtre est mauvaise.
 *
 * Ce que les joueurs sentent, c'est l'image qui s'arrête. Relevé sur les soirées
 * du 22 et du 25 septembre 2026: Hyde, qui gelait vraiment, a eu 4 puis 8,9 s
 * sans image; les pages qui ne sentaient rien restaient sous 250 ms, hors
 * démarrage d'un jeu. Cinq cents millisecondes se voient; un écart de 130 ms
 * sur une page à 60 images par seconde ne se voit pas.
 */
export const FREEZE_MS = 500;

/** Ou à partir de quelle part de la cadence du jeu les images arrivent trop peu.
 *
 * Quatre-vingt-dix pour cent: Hyde recevait 43,9 images par seconde pour un jeu
 * à 60 juste avant de geler. Les pages saines tiennent la cadence à une image
 * près.
 *
 * Ce que la règle ne compte PLUS: les images jetées et les files vides. Elles ne
 * séparaient personne. Le 25 septembre, Souhib, qui ne sentait rien, jetait 9
 * images et vidait sa file 5 fois par fenêtre en médiane; Hyde, qui gelait, 1 et
 * 3. L'ancienne règle (10 jetées ou 2 files vides) lui a proposé le format
 * réduit 37 fois dans la soirée, et le 25 un écran passé de 110 à 21 Hz en a
 * fait jeter 390 par fenêtre à une page dont la liaison allait bien.
 */
export const SHORT_RATE = 0.9;

/** Combien de fenêtres ne comptent pas: au début de la page, et après un
 * changement de jeu.
 *
 * Trois, soit trente secondes. Le 25 septembre, presque toutes les mauvaises
 * fenêtres des joueurs qui ne sentaient rien suivaient un changement de jeu de
 * moins d'une minute: un démarrage n'envoie pas d'image, et ce n'est pas un gel.
 * Le démarrage lui-même ne compte pas non plus (`Struggling.hold`), et ces trois
 * fenêtres couvrent ce qui le suit.
 */
export const GRACE_WINDOWS = 3;

/** Combien de fenêtres mauvaises d'affilée avant d'en parler.
 *
 * Deux, soit vingt secondes. Une seule mauvaise fenêtre arrive à tout le monde,
 * et une page qui propose de baisser la qualité au premier hoquet est une page
 * qu'on apprend à ignorer.
 */
export const ROUGH_IN_A_ROW = 2;

/** À partir de quand on REVIENT à la charge après un refus: un gel de deux
 * secondes, quatre fois le seuil ordinaire.
 *
 * Le 16 septembre 2026, un joueur a pris le format réduit, est revenu au plein
 * trois minutes plus tard, et sa liaison s'est effondrée pendant les quinze
 * minutes suivantes. La page ne lui a plus rien proposé, parce qu'elle ne
 * proposait qu'une fois par séance. Le retour exige bien pire que la première
 * fois, pour ne jamais revenir sur ce que la personne a accepté de vivre.
 */
export const COLLAPSE_MS = 2000;

/** Et le silence minimum entre deux propositions, en fenêtres de dix secondes.
 *
 * Trente, soit cinq minutes. Une proposition refusée qui revient trop vite est
 * une proposition qu'on apprend à fermer sans lire.
 */
export const QUIET_WINDOWS = 30;

/** Combien d'images l'écran oblige à jeter sur une fenêtre, liaison parfaite ou non.
 *
 * La page peint au plus une image par rafraîchissement. Un écran qui rafraîchit
 * moins vite que le jeu en fait donc tomber la différence, chaque seconde, sans
 * que la liaison y soit pour rien. Le 25 septembre 2026 à 00:37, le navigateur
 * d'une page est passé de 110 à 21 Hz, sur un ordinateur fixe; la cause n'est pas
 * connue. Les 60 images arrivaient; la page en jetait 390 par fenêtre.
 */
export function forcedDrops(sample: Vitals): number {
  if (sample.écranHz <= 0 || sample.jeuHz <= sample.écranHz) return 0;
  return Math.round((sample.jeuHz - sample.écranHz) * sample.s);
}

/** Cette fenêtre s'est-elle mal passée: l'image s'est-elle arrêtée, ou n'est-elle
 * pas arrivée assez vite ? */
export function rough(sample: Vitals): boolean {
  const rate = sample.vues / Math.max(sample.s, 1);
  return sample.arrivées[2] >= FREEZE_MS || (sample.jeuHz > 0 && rate < SHORT_RATE * sample.jeuHz);
}

/**
 * Faut-il proposer le format réduit ?
 *
 * # Pourquoi la page le propose au lieu d'attendre
 *
 * Un ami a trouvé le bouton tout seul, après une soirée entière, et son image
 * s'est améliorée tout de suite. La page voyait la dégradation avant lui: elle
 * voyait les images s'arrêter pendant qu'il cherchait.
 *
 * # Ce qu'elle ne fait pas
 *
 * Elle ne bascule pas toute seule. Le format se choisit, parce que quelqu'un
 * peut préférer une image nette avec quelques saccades à une image molle sans
 * aucune, et que personne n'aime qu'un réglage change sous ses yeux.
 *
 * Elle ne repropose pas non plus après un refus. Une proposition qu'on décline
 * et qui revient est une proposition qu'on finit par ne plus lire.
 */
export class Struggling {
  private inARow = 0;
  private refused = false;
  /** Une proposition est à l'écran et attend sa réponse.
   *
   * Sans lui, chaque mauvaise fenêtre la redemandait: le 25 septembre 2026, trois
   * pages ont écrit « proposé » 53, 54 et 16 fois pour une seule bannière. */
  private proposed = false;
  /** Fenêtres écoulées depuis qu'on a réglé la question. */
  private since = 0;
  /** Fenêtres qui ne comptent pas encore: le début de la page, un démarrage. */
  private held = GRACE_WINDOWS;

  /** Un jeu démarre: cette fenêtre et les `GRACE_WINDOWS` suivantes ne comptent
   * pas. À appeler à chaque fenêtre tant que la salle charge. */
  hold(): void {
    this.held = GRACE_WINDOWS + 1;
    this.inARow = 0;
  }

  /** Le relevé d'une fenêtre. Rend vrai quand il faut proposer. */
  saw(sample: Vitals): boolean {
    if (this.held > 0) {
      this.held -= 1;
      return false;
    }
    if (sample.demi || this.proposed) return false;
    if (this.refused) {
      this.since += 1;
      // Le retour: seulement quand c'est BEAUCOUP pire qu'au premier tour, et
      // pas avant cinq minutes de silence.
      const bien_pire = sample.arrivées[2] >= COLLAPSE_MS;
      this.inARow = bien_pire ? this.inARow + 1 : 0;
      if (this.since < QUIET_WINDOWS || this.inARow < ROUGH_IN_A_ROW) return false;
      this.refused = false;
      this.inARow = 0;
      this.proposed = true;
      return true;
    }
    this.inARow = rough(sample) ? this.inARow + 1 : 0;
    this.proposed = this.inARow >= ROUGH_IN_A_ROW;
    return this.proposed;
  }

  /** La personne a dit non, ou a basculé. On se tait, et on ne revient qu'en cas
   * d'effondrement (`COLLAPSE_MS`) après `QUIET_WINDOWS` fenêtres. */
  settled(): void {
    this.proposed = false;
    this.refused = true;
    this.inARow = 0;
    this.since = 0;
  }
}
