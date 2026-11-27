import type { InputSource } from "./input-source";
/**
 * The three streams, tied together, and the one snapshot React reads.
 *
 * Nothing in here is a React component and that is the point (ADR D12): the
 * decode, paint and pad loops run on `requestAnimationFrame` and timers, own the
 * canvas through a ref, and never cause a render. React subscribes to a snapshot
 * twice a second — the rate a person reads numbers at, not the rate they change.
 */
import { InputStream, type InputState } from "./input";
import { MicStream, type MicState } from "./mic";
import { SoundStream, type SoundStats } from "./sound";
import { VideoStream, type FenetreVideo, type VideoStats } from "./video";
import { jetons, vues } from "./couverture";
import type { Liaison } from "./liaison";
import { VeilleLiaison, type Contexte } from "./veille";
import { salle, socketUnder } from "../lib/base";

export type Snapshot = {
  video: VideoStats;
  sound: SoundStats;
  input: InputState;
  /** Où en est le micro de cette page: éteint, demandé, ouvert, refusé. */
  mic: MicState;
  /** How far the sound is behind the picture, in milliseconds. */
  soundGapMs: number | null;
  /** Compensation réellement ajoutée à l'image, distincte de l'écart restant. */
  soundSyncMs: number;
  /** L'option « caler l'image sur le son » est-elle allumée ? Un calage de
   * 0 ms ne le dit pas : il peut venir d'un écart encore inconnu. */
  soundSyncOn: boolean;
  /** L'état de la liaison, calculé ici et nulle part ailleurs (`liaison.ts`).
   *
   * Dans l'instantané, donc au rythme où React lit: deux fois par seconde.
   * La page n'a qu'à l'afficher, à un seul endroit. */
  liaison: Liaison;
  /** Les images peintes que la couverture avait vues au moment où cet état a
   * été décidé (`couverture.vues`). Une couverture armée sur cet état est
   * refusée si une image plus neuve a été peinte depuis (ADR D40). */
  couvertureVue: number;
};

/** Ce que la fenêtre de relevé a vu de pire, flux par flux (`fenetre.ts`).
 * Hors de l'instantané : React le lit deux fois par seconde, et un maximum
 * pris à chaque lecture ne couvrirait qu'une demi-seconde. */
export type Fenetre = {
  video: FenetreVideo;
  input: ReturnType<InputStream["fenetre"]>;
  sound: ReturnType<SoundStream["fenetre"]>;
};

/** Même origine, toujours, et sous le préfixe de CETTE salle: une salle est
 * servie à `/r/1/`, et une adresse absolue irait frapper à la racine, donc au
 * salon. Voir `lib/base`, qui porte la raison complète. */
const socketUrl = socketUnder;

export class Session {
  readonly video: VideoStream;
  readonly sound: SoundStream;
  readonly input: InputStream;
  readonly mic: MicStream;
  /** Ce qui calcule l'état de la liaison. Voir `veille.ts`. */
  readonly veille: VeilleLiaison;

  private listeners = new Set<() => void>();
  private snapshot: Snapshot;
  private ticker: number | null = null;
  private lipsync = false;

  constructor(
    canvas: HTMLCanvasElement,
    onSeat: (port: number | null, claim: string | null) => void,
    volume: number,
    deviceRate: boolean,
    /** Vrai quand la personne est entrée pour regarder. Passé ici plutôt
     * qu'appliqué après coup: une session construite en joueur prendrait une
     * manette le temps d'un aller-retour avant de la rendre. */
    watching = false,
    inputSource: InputSource | null = null,
  ) {
    this.video = new VideoStream(canvas, socketUrl);
    // Une image d'un format neuf : React doit retailler la toile avant que
    // la couverture ne se lève (`couverture.decouvrir`). Une fois par jeu,
    // pas à chaque image.
    this.video.onFormat = () => this.refresh();
    this.sound = new SoundStream(socketUrl, volume, deviceRate);
    this.input = new InputStream(socketUrl, onSeat, () => this.refresh(), watching, inputSource);
    this.mic = new MicStream(socketUrl, () => this.input.attribution());
    this.veille = new VeilleLiaison({
      now: () => performance.now(),
      horloge: () => Date.now(),
      enLigne: () => navigator.onLine !== false,
      visible: () => document.visibilityState !== "hidden",
      salle,
      fetch: (url, init) => fetch(url, init),
    });
    this.snapshot = this.read();
  }

  /** L'onglet change d'état: la veille le note tout de suite, pour ne pas
   * compter comme un gel le temps qu'une image met à revenir. */
  private readonly regarder = (): void => {
    this.veille.regarder();
    this.refresh();
  };

  /** Ce que la page sait et que les flux ignorent: le jeu, un démarrage, la
   * proposition de format réduit. Voir `veille.ts`. */
  contexte(contexte: Contexte): void {
    this.veille.dire(contexte);
    this.refresh();
  }

  /** « Relancer l'image »: une socket vidéo neuve, la place gardée. */
  relancerImage(): void {
    this.veille.relancer();
    this.video.relancer();
    this.refresh();
  }

  start(): void {
    this.video.start();
    this.input.start();
    document.addEventListener("visibilitychange", this.regarder);
    this.ticker = window.setInterval(() => {
      this.snapshot = this.read();
      for (const listener of this.listeners) listener();
    }, 500);
  }

  stop(): void {
    document.removeEventListener("visibilitychange", this.regarder);
    if (this.ticker !== null) window.clearInterval(this.ticker);
    // `fermer` et pas `stop` : une session arrêtée ne rouvre plus rien,
    // quoi qu'un effet encore attaché à elle lui demande (voir `fermer`).
    this.video.fermer();
    this.sound.stop();
    this.mic.stop();
    this.input.stop();
  }

  /**
   * Reconstruit l'instantané tout de suite, sans attendre le prochain tour.
   *
   * Deux fois par seconde est la bonne cadence pour LIRE des mesures, et la
   * mauvaise pour répondre à un clic: on cliquait « réassigner » et l'écran
   * mettait jusqu'à une demi-seconde à le montrer, ce qui se lit comme un bouton
   * cassé. Appelé après une action de la personne, ou quand l'image change
   * de format (une fois par jeu), jamais à chaque image.
   */
  refresh(): void {
    this.snapshot = this.read();
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  /** Ce que chaque flux a vu de pire depuis le dernier relevé. `prendre` :
   * le relevé de dix secondes repart de rien ; un signalement lit sans
   * prendre, pour ne pas voler sa fenêtre au relevé suivant. */
  fenetre(prendre: boolean): Fenetre {
    return {
      video: this.video.fenetre(prendre),
      input: this.input.fenetre(prendre),
      sound: this.sound.fenetre(prendre),
    };
  }

  /** Lines the picture up with the sound, or lets it stay early. */
  setLipsync(on: boolean): void {
    this.lipsync = on;
    if (!on) {
      this.video.setLipsync(0);
      return;
    }
    const picture = this.video.presentationOffsetMs();
    // Soustraire la compensation précédente évite de l'appliquer deux fois.
    const base = picture === null ? null : picture - this.video.compensationMs();
    const gap = this.sound.gapAgainst(base);
    if (gap !== null) this.video.setLipsync(Math.max(0, gap));
  }

  get lipsyncOn(): boolean {
    return this.lipsync;
  }

  private read(): Snapshot {
    // Même cadence que le relevé, hors du chemin des images. Le réglage reste
    // facultatif ; activé, il suit l'horaire audio qui peut redescendre.
    if (this.lipsync) this.setLipsync(true);
    const video = this.video.stats();
    const sound = this.sound.stats();
    const input = this.input.state();
    return {
      video,
      sound,
      input,
      mic: this.mic.status(),
      soundGapMs: this.sound.gapAgainst(this.video.presentationOffsetMs()),
      soundSyncMs: this.video.compensationMs(),
      soundSyncOn: this.lipsync,
      liaison: this.veille.lire({ video, sound, input }),
      // Relevé avec l'état, pas au rendu : c'est sur ces images-là que
      // l'état a été décidé.
      couvertureVue: vues(),
    };
  }
}

/** The same door, before there is anything behind it.
 *
 * The page used to be one script, so its test API existed the moment the file
 * parsed. It is a module now, and the API appears when React mounts, a few
 * milliseconds later. A driver that looked in that gap crashed on
 * `nel3abTest.counters()` being undefined and reported a failure that was
 * really a race. Answering zeroes instead makes the driver wait, which is what
 * every one of them already knows how to do.
 */
export function exposeNothingYet(): void {
  const anyWindow = globalThis as unknown as Record<string, unknown>;
  const nothing = () => ({
    painted: 0,
    shown: 0,
    stalls: 0,
    restarts: 0,
    undecoded: 0,
    attempts: 0,
    pressed: [] as string[],
    shakes: 0,
    soundPlayed: 0,
    soundGaps: 0,
    roundTripMs: null as number | null,
    port: null as number | null,
  });
  anyWindow.nel3abTest = {
    counters: nothing,
    pacing: () => ({
      queue: 0,
      slackMs: 0,
      fastest: null,
      refresh: 0,
      holds: [],
      offset: 0,
      arrived: 0,
      painted: 0,
      starved: 0,
      undecoded: 0,
      jitter: 0,
      sourceHz: 0,
      gapP50: 0,
      gapP95: 0,
      gapMax: 0,
      heldP95: 0,
      pictureW: 0,
      pictureH: 0,
      probeP95: 0,
      probeMax: 0,
      skipped: 0,
      caughtUp: 0,
      overflowed: 0,
      marge: "lisse",
      room: 0,
    }),
    audio: () => ({
      soundLead: 0,
      outputLatency: 0,
      baseLatency: 0,
      sampleRate: 0,
      chunkMs: null,
      gaps: 0,
      state: "absent",
    }),
    backlog: () => 0,
    wedgeDecoder: () => false,
    stallDecoder: () => false,
    seat: () => null,
    liaison: () => null,
    couverture: () => ({ jetons: jetons(), vues: vues() }),
    soundGap: () => null,
    room: () => ({ mine: 0, watching: false }),
    padList: () => [],
    reading: () => null,
    volume: () => 0,
  };
}

/** The only door in from outside.
 *
 * A module's scope is unreachable from the page's global, and the recoveries
 * this page performs cannot be pinned by a test that cannot first BREAK them.
 * Kept identical to what the browser tests already drive, because those tests
 * are the memory of four failures nobody wants to meet again.
 */
export function exposeForTests(session: Session): void {
  const anyWindow = globalThis as unknown as Record<string, unknown>;
  anyWindow.nel3abTest = {
    counters: () => {
      const shot = session.getSnapshot();
      return {
        painted: shot.video.painted,
        shown: shot.video.shown,
        stalls: shot.video.stalls,
        restarts: shot.video.restarts,
        undecoded: shot.video.undecoded,
        attempts: shot.input.sent,
        // Ce qui est TENU en ce moment, et pas seulement combien de trames
        // sont parties. Sans ça, un pilote ne peut pas distinguer « le doigt a
        // atteint le jeu » de « la boucle tourne toujours »: le compteur monte
        // dans les deux cas.
        pressed: shot.input.pressed,
        shakes: session.input.shakesFelt(),
        soundPlayed: shot.sound.playedSeconds,
        soundGaps: shot.sound.gaps,
        // L'aller-retour, pour qu'un pilote puisse vérifier qu'il est MESURÉ et
        // pas seulement affiché. Nul veut dire « pas encore », jamais zéro.
        roundTripMs: shot.input.roundTripMs,
        // La place tenue, parce que la règle du worker est par PLACE: seul le
        // siège propriétaire change le jeu. Un pilote qui ne peut pas la lire
        // compare des identités à la place, dit « je peux » à un deuxième onglet
        // de la même personne, et rate ensuite pour une raison qui n'est pas un
        // défaut. Nul veut dire « aucune », jamais zéro.
        port: shot.input.port,
      };
    },
    pacing: () => {
      const shot = session.getSnapshot();
      return {
        queue: shot.video.backlog,
        slackMs: shot.video.slackMs,
        fastest: shot.video.fastestLag,
        refresh: 1000 / shot.video.refreshHz,
        offset: session.video.anchorMs(),
        holds: [shot.video.heldRefreshes.p50],
        arrived: shot.video.shown,
        painted: shot.video.painted,
        starved: shot.video.starved,
        undecoded: shot.video.undecoded,
        jitter: shot.video.jitterMs,
        sourceHz: shot.video.sourceHz,
        gapP50: shot.video.gapMs.p50,
        gapP95: shot.video.gapMs.p95,
        // Le pire écart entre deux images reçues: celui que la page envoie au
        // salon comme troisième « arrivées », lisible aussi d'un banc qui ne
        // passe pas par le salon.
        gapMax: shot.video.gapMs.max,
        heldP95: shot.video.heldRefreshes.p95,
        pictureW: shot.video.picture.width,
        pictureH: shot.video.picture.height,
        probeP95: shot.video.probeMs.p95,
        probeMax: shot.video.probeMs.max,
        skipped: shot.video.skipped,
        // Les deux sortes de jets, et la règle de marge en service (VID-1) : un
        // banc qui compare les deux bras lit ce que la page a FAIT.
        caughtUp: shot.video.caughtUp,
        overflowed: shot.video.overflowed,
        marge: shot.video.marge,
        room: shot.video.room,
      };
    },
    /** The sound budget, poste par poste, in the units the bench prints.
     *
     * Seconds where the Web Audio API reports seconds, milliseconds where the
     * page shows milliseconds. Converting here rather than in the harness keeps
     * one place to be wrong. */
    audio: () => {
      const sound = session.getSnapshot().sound;
      return {
        soundLead: sound.leadMs / 1000,
        outputLatency: sound.outputMs / 1000,
        baseLatency: sound.browserMs / 1000,
        sampleRate: sound.sampleRate,
        chunkMs: sound.chunks === 0 ? null : (1000 * sound.playedSeconds) / sound.chunks,
        gaps: sound.gaps,
        state: sound.state,
      };
    },
    backlog: () => session.getSnapshot().video.backlog,
    wedgeDecoder: () => session.video.wedgeDecoder(),
    stallDecoder: () => session.video.stallDecoder(),
    seat: () => session.getSnapshot().input.port,
    /** L'état de liaison que la page affiche: un pilote vérifie le MÊME
     * chiffre que l'écran, pas une seconde lecture des compteurs. */
    liaison: () => session.getSnapshot().liaison,
    /** La couverture de l'image MAINTENANT, et pas au dernier relevé : les
     * jetons posés et les images peintes qu'elle a vues. Un pilote le lit à
     * chaque image d'écran pour prouver qu'aucune image n'est peinte sous
     * un plein cadre (`etats.mjs`, premiere-image-coupe). */
    couverture: () => ({ jetons: jetons(), vues: vues() }),
    soundGap: () => session.getSnapshot().soundGapMs,
    /** The room as this page understands it, so a test can say "this page never
     * got a pad" instead of failing for something that is not a defect. */
    room: () => ({
      mine: session.getSnapshot().input.port ?? 0,
      watching: session.getSnapshot().input.watching,
    }),
    /** Les manettes que la page LISTE: une par modèle, pas une par branchement. */
    padList: () => session.getSnapshot().input.pads,
    /** La dernière lecture envoyée au jeu, pour qu'un pilote puisse vérifier
     * qu'une poussée de manette y arrive vraiment. */
    reading: () => session.input.lastSent(),
    /** Le volume tel que la sortie l'applique, pour qu'un pilote puisse vérifier
     * qu'une glissière s'entend en bougeant et qu'annuler la défait. */
    volume: () => session.sound.volumeNow(),
  };
}
