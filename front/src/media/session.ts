/**
 * The three streams, tied together, and the one snapshot React reads.
 *
 * Nothing in here is a React component and that is the point (ADR D12): the
 * decode, paint and pad loops run on `requestAnimationFrame` and timers, own the
 * canvas through a ref, and never cause a render. React subscribes to a snapshot
 * twice a second — the rate a person reads numbers at, not the rate they change.
 */
import { InputStream, type InputState } from "./input";
import { SoundStream, type SoundStats } from "./sound";
import { VideoStream, type VideoStats } from "./video";

export type Snapshot = {
  video: VideoStats;
  sound: SoundStats;
  input: InputState;
  /** How far the sound is behind the picture, in milliseconds. */
  soundGapMs: number | null;
};

/** Same origin, always. The worker refuses a WebSocket whose `Origin` is not its
 * own `Host` — the check that stops a stranger's page from opening this room's
 * video in a visitor's browser — and the dev proxy keeps that true in
 * development. */
const socketUrl = (path: string): string =>
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`;

export class Session {
  readonly video: VideoStream;
  readonly sound: SoundStream;
  readonly input: InputStream;

  private listeners = new Set<() => void>();
  private snapshot: Snapshot;
  private ticker: number | null = null;
  private lipsync = false;

  constructor(
    canvas: HTMLCanvasElement,
    onSeat: (port: number | null) => void,
    volume: number,
    deviceRate: boolean,
    /** Vrai quand la personne est entrée pour regarder. Passé ici plutôt
     * qu'appliqué après coup: une session construite en joueur prendrait une
     * manette le temps d'un aller-retour avant de la rendre. */
    watching = false,
  ) {
    this.video = new VideoStream(canvas, socketUrl);
    this.sound = new SoundStream(socketUrl, volume, deviceRate);
    this.input = new InputStream(socketUrl, onSeat, () => this.refresh(), watching);
    this.snapshot = this.read();
  }

  start(): void {
    this.video.start();
    this.input.start();
    this.ticker = window.setInterval(() => {
      this.snapshot = this.read();
      for (const listener of this.listeners) listener();
    }, 500);
  }

  stop(): void {
    if (this.ticker !== null) window.clearInterval(this.ticker);
    this.video.stop();
    this.sound.stop();
    this.input.stop();
  }

  /**
   * Reconstruit l'instantané tout de suite, sans attendre le prochain tour.
   *
   * Deux fois par seconde est la bonne cadence pour LIRE des mesures, et la
   * mauvaise pour répondre à un clic: on cliquait « réassigner » et l'écran
   * mettait jusqu'à une demi-seconde à le montrer, ce qui se lit comme un bouton
   * cassé. Appelé après une action de la personne, jamais dans une boucle.
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

  /** Lines the picture up with the sound, or lets it stay early. */
  setLipsync(on: boolean): void {
    this.lipsync = on;
    const gap = this.sound.gapAgainst(this.video.stats().fastestLag);
    this.video.setLipsync(on && gap !== null ? Math.max(0, gap) : 0);
  }

  get lipsyncOn(): boolean {
    return this.lipsync;
  }

  private read(): Snapshot {
    const video = this.video.stats();
    return {
      video,
      sound: this.sound.stats(),
      input: this.input.state(),
      soundGapMs: this.sound.gapAgainst(video.fastestLag),
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
    soundPlayed: 0,
    soundGaps: 0,
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
      heldP95: 0,
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
    soundGap: () => null,
    room: () => ({ mine: 0, watching: false }),
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
        soundPlayed: shot.sound.playedSeconds,
        soundGaps: shot.sound.gaps,
      };
    },
    pacing: () => {
      const shot = session.getSnapshot();
      return {
        queue: shot.video.backlog,
        slackMs: shot.video.slackMs,
        fastest: shot.video.fastestLag,
        refresh: 1000 / shot.video.refreshHz,
        offset: shot.video.offset ?? 0,
        holds: [shot.video.heldRefreshes.p50],
        arrived: shot.video.shown,
        painted: shot.video.painted,
        starved: shot.video.starved,
        undecoded: shot.video.undecoded,
        jitter: shot.video.jitterMs,
        sourceHz: shot.video.sourceHz,
        gapP50: shot.video.gapMs.p50,
        gapP95: shot.video.gapMs.p95,
        heldP95: shot.video.heldRefreshes.p95,
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
    soundGap: () => session.getSnapshot().soundGapMs,
    /** The room as this page understands it, so a test can say "this page never
     * got a pad" instead of failing for something that is not a defect. */
    room: () => ({
      mine: session.getSnapshot().input.port ?? 0,
      watching: session.getSnapshot().input.watching,
    }),
  };
}
