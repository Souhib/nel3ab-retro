/**
 * The picture: socket, decoder, schedule, and the two watchdogs that keep them
 * honest.
 *
 * Every rule here was paid for. The comments say what by, because the code alone
 * cannot: each one looks removable until you know which failure it answers.
 */
import { SLACK_CEILING, Window, isStarved, nextSlack, roomFor, steer } from "./clock";
import { codecOf, hasIdr } from "./annexb";

/** How long without a byte before the connection is presumed dead.
 *
 * A reconnection that waits for `onclose` is not enough: the server dropped a
 * viewer on a broken pipe and the TLS proxy in front kept the browser's socket
 * open, so the page was never told and sat on its last painted frame for good. A
 * live socket that has gone quiet looks exactly like a working one. */
const SILENCE_LIMIT = 2000;

/** How long a socket has to finish closing before the page stops waiting.
 *
 * `close()` starts a handshake and `onclose` fires when the other end answers.
 * When nobody answers — a server that never reads, a proxy that swallows it —
 * every recovery that ends in "close and reconnect" is dead. Measured exactly
 * that: the escalation fired, the socket never closed, the page sat there. */
const CLOSING_LIMIT = 1000;

/** How long a rebuilt decoder waits for a key frame before rejoining. */
const KEY_FRAME_PATIENCE = 3000;

/** No refresh for this long means nobody is painting.
 *
 * MEASURED on a real tab that had been switched away from: no refresh at all,
 * four frames painted in three minutes, while sixty access units a second still
 * went into a decoder that drained twenty-four. Its backlog reached 1564 chunks
 * and the stream was 23 SECONDS behind. Coming back could never recover.
 *
 * The rule is not about tabs. The decoder exists to feed the screen; when the
 * screen stops asking, feeding it is what makes coming back impossible. */
const PAINTING_STOPPED = 250;

/** How far behind the decoder may fall before it is given no more work. */
const MAX_BACKLOG = 10;

/* Il n'y a PLUS de taille de file constante ici, et c'est le sujet de
   `roomFor`: la file doit contenir ce que l'horaire fait attendre, donc sa taille
   se calcule au lieu de s'écrire. La constante précédente valait huit images, et
   le plafond de marge est passé de 60 à 180 ms sans qu'elle bouge: les images
   arrivaient à l'heure et étaient jetées avant leur tour. */

const SOURCE_FRAME = 16.667;
const KEY_FRAME_PLEASE = 1;

type Held = { frame: VideoFrame; capturedMs: number; decodedAt: number };

export type VideoStats = {
  painted: number;
  shown: number;
  undecoded: number;
  stalls: number;
  restarts: number;
  keyFramesAsked: number;
  slackMs: number;
  starved: number;
  skipped: number;
  connected: boolean;
  reconnects: number;
  heldRefreshes: { p05: number; p50: number; p95: number };
  waitMs: { p50: number; p95: number };
  gapMs: { p50: number; p95: number; max: number };
  /** De combien la liaison est irrégulière, en millisecondes. Zéro sur une bonne
   * liaison, et c'est ce que la page ajoute à son tampon. */
  jitterMs: number;
  /** Combien d'images la file peut retenir en ce moment, calculé d'après la
   * marge. À comparer avec `backlog`, qui dit combien elle en tient. */
  room: number;
  /** La taille de la dernière image décodée, en pixels. Zéro avant la première.
   *
   * Ce que le DÉCODEUR a produit, et non ce qu'on a demandé: c'est la seule
   * mesure qui ne peut pas mentir sur ce qui arrive vraiment. */
  picture: { width: number; height: number };
  /** Vrai quand cette page prend le flux réduit. */
  half: boolean;
  /** À quelle cadence la SOURCE produit, lue sur les instants de capture. Un jeu
   * PAL donne 50; une liaison lente ne la fait pas baisser. */
  sourceHz: number;
  refreshHz: number;
  backlog: number;
  fastestLag: number | null;
  /** Le retard que l'horaire ajoute à chaque image, en millisecondes.
   *
   * Ce chiffre-ci et pas l'ancre interne. L'ancre est un instant, exprimé par
   * rapport à l'horloge du WORKER, dont celle du navigateur est décalée de ce
   * qu'elle est: affichée telle quelle elle a donné « -15268 ms » dans le
   * journal d'une séance parfaitement saine, le 17 août 2026. Un nombre affiché
   * sans qu'on ait vérifié ce qu'il mesure est un nombre qui ment.
   *
   * Celui-ci est la gigue plus la marge, borné à `SLACK_CEILING`. Zéro sur une
   * bonne liaison: la page n'attend alors rien du tout. */
  addedMs: number;
};

/** À partir de quel écart l'horaire d'affichage est REPOSÉ plutôt que corrigé,
 * en millisecondes. Voir la raison dans `adjust`. */
const SNAP = 120;

/** Où le choix de format est retenu.
 *
 * Dans le navigateur et pas sur le serveur, parce que c'est une propriété de la
 * LIAISON de cette personne et pas de son compte: la même personne sur le
 * portable du salon et sur le fixe n'a pas le même besoin. */
const HALF_KEY = "nel3ab:half";

function loadHalf(): boolean {
  try {
    return localStorage.getItem(HALF_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberHalf(half: boolean): void {
  try {
    localStorage.setItem(HALF_KEY, half ? "1" : "0");
  } catch {
    // Un navigateur qui refuse le stockage joue quand même; il redemandera.
  }
}

export class VideoStream {
  private socket: WebSocket | null = null;
  private decoder: VideoDecoder | null = null;
  private readonly queue: Held[] = [];
  private readonly submitted = new Map<number, { at: number; transit: number }>();
  private readonly lags = new Window(240);
  private readonly gaps = new Window(600);
  /** L'écart entre deux INSTANTS DE CAPTURE, qui mesure la source.
   *
   * Séparé des écarts d'arrivée juste au-dessus, et c'est tout le sujet. Les
   * deux se ressemblent sur une bonne liaison et n'ont rien à voir sur une
   * mauvaise: une source à 60 Hz dont les images arrivent toutes les 26 ms n'est
   * pas une source à 39 Hz. Mesurer la cadence sur les arrivées revenait à
   * croire la seconde, donc à trouver normal un trou qui n'a rien de normal, et
   * à ne pas grandir la marge de quelqu'un qui en avait besoin. */
  private readonly sourceGaps = new Window(600);
  private lastCaptured: number | null = null;
  private readonly holds = new Window(240);
  private readonly waits = new Window(240);
  private readonly refreshes = new Window(120);

  private offset: number | null = null;
  private slackMs = 6;
  private lipsync = 0;
  private awaitingKey = false;
  private priming = true;
  /** Vrai quand cette page prend le flux réduit.
   *
   * Le worker encode la même image deux fois, en pleine taille et en moitié de
   * chaque côté, et chacun choisit. Ici il n'y a donc qu'une adresse à changer:
   * tout le reste — décodeur, horaire, tampon — travaille pareil sur les deux,
   * parce que la seule chose qui diffère est le nombre de pixels. */
  private half = loadHalf();
  /** De combien la toile est dessinée plus grande que l'image reçue.
   *
   * Posé par la page, qui seule connaît la place disponible. Un nombre lu par la
   * boucle, pas React sur le chemin des images: la règle 8 interdit le second,
   * pas le premier. */
  private prescale = 1;
  /** La taille de la dernière image DÉCODÉE.
   *
   * Retenue à part et surtout pas relue sur la toile: depuis que la toile est
   * dessinée au pas entier, sa taille est un RÉSULTAT du calcul de placement.
   * La publier ferait décider le calcul d'après son propre résultat, et les deux
   * se poursuivraient — mesuré: la toile oscillait entre 608 et 1216 d'une image
   * à l'autre. */
  private decoded = { width: 0, height: 0 };
  private connected = false;

  private lastHeard: number | null = null;
  private lastOutput: number | null = null;
  private lastFed: number | null = null;
  private lastPaintTick: number | null = null;
  private lastRefresh: number | null = null;
  private decoderGoneSince: number | null = null;
  private shownAt: number | null = null;
  private firstCapture: number | null = null;
  private firstArrival: number | null = null;
  private lastArrival: number | null = null;
  private lastAsk = 0;

  private painted = 0;
  private shown = 0;
  private repeated = 0;
  private ticks = 0;
  private starved = 0;
  private starvedRecent = 0;
  private skipped = 0;
  /** Ce qui avait été jeté à la fin de la fenêtre précédente. */
  private skippedSeen = 0;
  private undecoded = 0;
  private stalls = 0;
  private restarts = 0;
  private reconnects = 0;
  private keyFramesAsked = 0;
  private calmWindows = 0;

  private timers: number[] = [];

  private readonly canvas: HTMLCanvasElement;
  private readonly url: (path: string) => string;

  constructor(canvas: HTMLCanvasElement, url: (path: string) => string) {
    this.canvas = canvas;
    this.url = url;
  }

  start(): void {
    this.connect();
    requestAnimationFrame(this.paint);
    this.timers.push(
      window.setInterval(this.watchSilence, 500),
      window.setInterval(this.watchDecoder, 500),
    );
  }

  stop(): void {
    for (const timer of this.timers) window.clearInterval(timer);
    this.timers = [];
    this.socket?.close();
    this.socket = null;
    this.decoder?.close();
    this.decoder = null;
  }

  /** How long the picture is held back to meet the sound, in milliseconds.
   *
   * Zero by default and that is a decision: the sound is late by its own output
   * path, and lining the picture up with it means delaying the picture, which is
   * felt at the controller. Applied AT ONCE rather than steered — the steering
   * moves 5 ms per two seconds, so fifty milliseconds of alignment took twenty
   * seconds to arrive and the person who asked saw nothing happen. */
  setLipsync(milliseconds: number): void {
    const before = this.lipsync;
    this.lipsync = Math.max(0, milliseconds);
    if (this.offset !== null) this.offset += this.lipsync - before;
  }

  askForKeyFrame(): void {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) return;
    // Once every half second at most: a key frame takes one frame to arrive and
    // asking again meanwhile only costs bytes.
    if (performance.now() - this.lastAsk < 500) return;
    this.lastAsk = performance.now();
    try {
      this.socket.send(new Uint8Array([KEY_FRAME_PLEASE]));
      this.keyFramesAsked += 1;
    } catch {
      // The socket died between the check and the send; the reconnection asks
      // again on its own.
    }
  }

  stats(): VideoStats {
    return {
      painted: this.painted,
      shown: this.shown,
      undecoded: this.undecoded,
      stalls: this.stalls,
      restarts: this.restarts,
      keyFramesAsked: this.keyFramesAsked,
      slackMs: this.slackMs,
      starved: this.starved,
      skipped: this.skipped,
      connected: this.connected,
      reconnects: this.reconnects,
      heldRefreshes: {
        p05: this.holds.at(0.05),
        p50: this.holds.at(0.5),
        p95: this.holds.at(0.95),
      },
      waitMs: { p50: this.waits.at(0.5), p95: this.waits.at(0.95) },
      gapMs: { p50: this.gaps.at(0.5), p95: this.gaps.at(0.95), max: this.gaps.at(1) },
      jitterMs: this.jitterMs(),
      room: this.queueRoom(),
      picture: this.decoded,
      half: this.half,
      sourceHz: 1000 / this.sourcePeriodMs(),
      refreshHz: 1000 / this.refreshPeriod(),
      backlog: this.decoder?.decodeQueueSize ?? 0,
      fastestLag: this.lags.fastest(),
      addedMs: Math.round(this.boughtMs()),
    };
  }

  /** The display's own interval, measured rather than assumed: 60, 120 and 240 Hz
   * screens are all in use here and a page that assumes one is wrong on two. */
  /** La cadence de la source, mesurée sur ses arrivées.
   *
   * Mesurée et non déduite de la région du disque: le worker ne dit pas à quelle
   * fréquence le jeu tourne, et un jeu peut en changer en cours de route. Les
   * écarts d'arrivée le disent déjà, et ils le disent pour n'importe quelle
   * source. Avant la trentième arrivée, on prend la période de l'écran, qui est
   * l'ancienne hypothèse et reste la bonne au démarrage.
   */
  private sourcePeriodMs(): number {
    return this.sourceGaps.length < 30 ? this.refreshPeriod() : this.sourceGaps.at(0.5);
  }

  /** La gigue de la liaison: de combien la plus lente des images ordinaires est
   * plus lente que la plus rapide.
   *
   * C'est exactement ce qu'un tampon doit absorber, et c'est ce qui vaut zéro
   * sur une bonne liaison. D'où la propriété qui compte: tout ce qui suit
   * s'appuie dessus, donc rien ne change pour qui n'a pas de gigue. */
  private jitterMs(): number {
    if (this.lags.length < 30) return 0;
    return Math.max(0, this.lags.at(0.95) - (this.lags.fastest() ?? 0));
  }

  /** Où poser l'horaire: assez tard pour que la quasi-totalité des images soient
   * là quand leur tour vient.
   *
   * Sur le p95 des transits et non sur le plus rapide. Le plus rapide est
   * l'image la plus chanceuse de la fenêtre: caler dessus revient à parier que
   * la liaison est toujours à son meilleur, et à jeter tout ce qui ne l'est pas.
   * C'est ce que faisait la page, et c'est pour ça qu'une liaison irrégulière
   * perdait une image sur cinq. */
  /** L'ancre de l'horaire, telle quelle: un instant exprimé sur l'horloge du
   * WORKER, décalée de celle du navigateur de ce qu'elle est.
   *
   * Pour les pilotes, et pour eux seuls. Deux d'entre eux vérifient que le
   * décalage audio la déplace exactement d'autant, ce qui est un contrôle juste.
   * Elle n'est PAS publiée dans les mesures: affichée telle quelle elle a écrit
   * « horaire -15268 ms » dans le journal d'une séance saine, parce qu'elle
   * mesure l'écart entre deux horloges autant que le retard qu'on ajoute. */
  anchorMs(): number {
    return this.offset ?? 0;
  }

  private wantedOffset(): number {
    return (this.lags.fastest() ?? 0) + this.boughtMs() + this.lipsync;
  }

  /** Le retard que l'horaire ajoute, en millisecondes.
   *
   * Nommé parce que DEUX choses en dépendent, et qu'elles doivent être d'accord:
   * l'horaire d'affichage, et la place dans la file qui doit tenir ce retard.
   * Les avoir laissées se contredire est exactement le défaut du 2026-08-17.
   */
  private boughtMs(): number {
    // Le total est BORNÉ, et c'est la moitié qui manquait.
    //
    // Mesuré le 2026-08-16 avec `slowlink.mjs`: sur un lien trop étroit, les
    // images ne sont pas irrégulières, elles s'entassent. Le p95 des transits
    // suit alors la file d'attente et non la gigue — 1,6 s mesurée — et un
    // tampon qui suivrait ce nombre ajouterait une seconde et demie de retard
    // sans rattraper une seule image. Attendre répare l'irrégulier, jamais
    // l'étroit.
    return Math.min(this.jitterMs() + this.slackMs, SLACK_CEILING);
  }

  /** Combien d'images la file garde: assez pour tenir ce que l'horaire fait
   * attendre. */
  private queueRoom(): number {
    return roomFor(this.boughtMs(), this.sourcePeriodMs());
  }

  /** De combien dessiner la toile plus grande que l'image reçue.
   *
   * Ne redessine pas: la valeur est lue à la prochaine image, qui arrive dans
   * moins de vingt millisecondes.
   */
  setPrescale(times: number): void {
    this.prescale = Math.max(1, Math.round(times));
  }

  /** Est-on sur le flux réduit ? */
  isHalf(): boolean {
    return this.half;
  }

  /**
   * Change de flux, et se rebranche.
   *
   * On FERME avant d'ouvrir, et le décodeur avec. Les deux flux portent des
   * images de tailles différentes qui se réfèrent les unes aux autres: en
   * glisser une du petit dans un décodeur qui a démarré sur le grand ne donne
   * pas une erreur, ça donne une bouillie, et seulement chez celui qui vient de
   * basculer. `onclose` reconstruit tout à partir de la première image-clé du
   * nouveau flux, que le worker fabrique parce qu'il voit arriver quelqu'un.
   */
  setHalf(half: boolean): void {
    if (half === this.half) return;
    this.half = half;
    rememberHalf(half);
    // L'horaire aussi: la taille change, donc le temps de décodage change, et
    // garder le calage de l'ancien flux ferait passer les premières images du
    // nouveau pour des retards.
    this.offset = null;
    this.lags.clear();
    this.gaps.clear();
    this.sourceGaps.clear();
    this.lastArrival = null;
    this.lastCaptured = null;
    const old = this.socket;
    this.socket = null;
    if (old !== null) {
      old.onclose = null;
      old.close();
    }
    this.decoder?.close();
    this.decoder = null;
    this.decoderGoneSince = null;
    this.lastOutput = null;
    this.priming = true;
    this.connect();
  }

  private refreshPeriod(): number {
    return this.refreshes.length < 8 ? SOURCE_FRAME : this.refreshes.at(0.5);
  }

  private connect(insist = false): void {
    void insist;
    const socket = new WebSocket(this.url(this.half ? "/video?half=1" : "/video"));
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onopen = () => {
      this.connected = true;
      this.lastHeard = performance.now();
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.connected = false;
      // The decoder is bound to a stream that has ended; the next one starts
      // from its own key frame with its own configuration.
      this.decoder?.close();
      this.decoder = null;
      this.decoderGoneSince = null;
      this.lastOutput = null;
      this.reconnects += 1;
      window.setTimeout(() => this.connect(), 500);
    };
    socket.onerror = () => {
      if (this.socket === socket) socket.close();
    };
    socket.onmessage = (event) => this.onMessage(event);
  }

  /** Closes a socket, and does not trust it to close. */
  private giveUp(socket: WebSocket | null): void {
    if (socket === null) return;
    socket.close();
    window.setTimeout(() => {
      if (this.socket !== socket) return; // it closed and was replaced, as it should
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      this.connected = false;
      this.connect();
    }, CLOSING_LIMIT);
  }

  private onMessage(event: MessageEvent<ArrayBuffer>): void {
    // Liveness is BYTES arriving, not frames decoding. Putting this after the
    // key-frame gate made the socket look silent for the second before the first
    // IDR, so the watchdog closed it and the reconnection did the same again.
    this.lastHeard = performance.now();
    const message = new Uint8Array(event.data);
    // A keep-alive: the server is there, the emulator has nothing new. It exists
    // so a game blanking the screen for two seconds does not look like a dead
    // link and cost a reconnection.
    if (message.length === 0) return;

    const capturedMicros = Number(new DataView(event.data).getBigUint64(0, true));
    const unit = message.subarray(8);
    const arrived = performance.now();

    if (this.firstCapture === null) {
      this.firstCapture = capturedMicros / 1000;
      this.firstArrival = arrived;
    }
    const transit =
      arrived - (this.firstArrival ?? arrived) - (capturedMicros / 1000 - this.firstCapture);

    // Nobody is painting, or the decoder cannot keep up. Either way the work
    // would never reach a screen, and doing it anyway is what makes the backlog
    // unbounded.
    if (
      this.lastPaintTick === null ||
      performance.now() - this.lastPaintTick > PAINTING_STOPPED ||
      (this.decoder !== null && this.decoder.decodeQueueSize > MAX_BACKLOG)
    ) {
      this.awaitingKey = true;
      this.undecoded += 1;
      return;
    }

    const isKey = hasIdr(unit);
    if (this.awaitingKey) {
      if (!isKey) {
        // Asked HERE, not when the gap opened: a key frame requested at the
        // start of a hidden minute arrives while the page is still throwing
        // everything away.
        this.askForKeyFrame();
        this.undecoded += 1;
        return;
      }
      this.awaitingKey = false;
    }

    if (this.decoder === null) {
      if (!isKey) return; // a decoder cannot start mid-GOP
      const codec = codecOf(unit);
      if (codec === null) return;
      this.decoder = new VideoDecoder({
        output: (frame) => this.onDecoded(frame),
        error: () => this.restartDecoder(),
      });
      this.decoder.configure({ codec, optimizeForLatency: true });
    }

    if (this.lastArrival !== null) this.gaps.push(arrived - this.lastArrival);
    this.lastArrival = arrived;
    // Bornée, parce qu'un flux qui redémarre fait sauter l'instant de capture en
    // avant ou en arrière, et qu'une seule valeur absurde dans la fenêtre
    // déplacerait la médiane.
    const capturedMs = capturedMicros / 1000;
    if (this.lastCaptured !== null) {
      const step = capturedMs - this.lastCaptured;
      if (step > 0 && step < 500) this.sourceGaps.push(step);
    }
    this.lastCaptured = capturedMs;

    this.submitted.set(capturedMicros, { at: arrived, transit });
    if (this.submitted.size > 300) {
      const oldest = this.submitted.keys().next().value;
      if (oldest !== undefined) this.submitted.delete(oldest);
    }
    this.lastFed = performance.now();
    try {
      this.decoder.decode(
        new EncodedVideoChunk({
          type: isKey ? "key" : "delta",
          // The server's capture instant, not a count of what came OUT. That is
          // what it was, and it made the timestamps going IN stop advancing
          // exactly when output stalled — feeding a stalling decoder duplicate
          // timestamps, the one input guaranteed to make it worse.
          timestamp: capturedMicros,
          data: unit,
        }),
      );
    } catch {
      // A decoder that refuses one chunk refuses every later one for the same
      // reason: a decoder to replace, not a frame to skip.
      this.restartDecoder();
    }
  }

  private onDecoded(frame: VideoFrame): void {
    const now = performance.now();
    this.lastOutput = now;
    const sent = this.submitted.get(frame.timestamp);
    if (sent !== undefined) this.submitted.delete(frame.timestamp);
    // Straight off the frame rather than out of a queue: pairing an output to
    // its input BY POSITION is off by one for ever the day one is dropped.
    const capturedMs = frame.timestamp / 1000;
    this.queue.push({ frame, capturedMs, decodedAt: now });
    this.lags.push(now - capturedMs);
    while (this.queue.length > this.queueRoom()) {
      this.queue.shift()?.frame.close();
      this.skipped += 1;
    }
    this.shown += 1;
  }

  /** Throws away the decoder and everything that came out of it. */
  private restartDecoder(): void {
    this.restarts += 1;
    try {
      this.decoder?.close();
    } catch {
      // Already closed by its own error handler.
    }
    this.decoder = null;
    this.decoderGoneSince = performance.now();
    this.lastOutput = null;
    while (this.queue.length) this.queue.shift()?.frame.close();
    this.submitted.clear();
    this.offset = null;
    this.priming = true;
    this.askForKeyFrame();
  }

  private paint = (): void => {
    requestAnimationFrame(this.paint);
    this.ticks += 1;
    const tickAt = performance.now();
    if (this.lastRefresh !== null) this.refreshes.push(tickAt - this.lastRefresh);
    this.lastRefresh = tickAt;
    this.lastPaintTick = tickAt;
    this.adjust();

    if (this.priming) {
      // One picture is enough to start: the slack lives in the SCHEDULE, in
      // milliseconds, not in a count of frames waiting in a queue.
      if (this.queue.length > 0) this.priming = false;
      else {
        this.repeated += 1;
        return;
      }
    }
    if (this.queue.length === 0) {
      // Rien à montrer, et deux raisons très différentes de n'avoir rien.
      //
      // Un jeu PAL tourne à 50 Hz: sur un écran à 60 Hz, une dizaine de tics par
      // seconde tombent forcément entre deux images, et ce n'est pas une panne.
      // Compter une famine là faisait grossir la marge de 8 ms par fenêtre, vers
      // le plafond de 60. Mesuré sur Mario Party 4: 38 ms de marge contre 3 sur
      // un jeu 60 Hz, et ça montait encore.
      const since = this.lastArrival === null ? Infinity : tickAt - this.lastArrival;
      if (!isStarved(since, this.sourcePeriodMs())) {
        this.repeated += 1;
        return;
      }
      this.starved += 1;
      this.starvedRecent += 1;
      this.repeated += 1;
      this.priming = true;
      // L'horaire est GARDÉ. Il était remis à zéro ici, donc recalculé au
      // prochain dessin sur l'image la plus rapide de la fenêtre: sur une
      // liaison irrégulière, chaque famine reposait l'horaire au plus optimiste,
      // l'image suivante était en retard, et ça recommençait. La capture du
      // 2026-08-16 en compte 513 en 214 secondes. Une file vide ne dit rien sur
      // le lien entre l'heure du serveur et l'heure d'ici, qui est tout ce que
      // ce nombre veut dire.
      return;
    }

    const now = performance.now();
    const slack = this.refreshPeriod() / 2;
    const head = this.queue[0];
    // Anchored WITH the buffer in it. Anchoring on "due the instant the first one
    // was shown" gave the pipeline zero slack: every frame that then arrived a
    // millisecond late was already overdue and thrown away — 491 dropped in
    // fourteen seconds, 27 painted per second out of 60.
    this.offset ??= this.wantedOffset();
    if (now < head.capturedMs + this.offset - slack) {
      this.repeated += 1;
      return;
    }

    const next = this.queue.shift();
    if (next === undefined) return;
    // La toile est dessinée au pas entier, au plus proche voisin. Le reste de
    // l'agrandissement est fait par le compositeur, en lissé. Deux temps plutôt
    // qu'un seul lissage de 2,41 fois: mesuré plus fidèle, et bien plus net.
    const times = Math.max(1, Math.round(this.prescale));
    this.decoded = { width: next.frame.displayWidth, height: next.frame.displayHeight };
    this.canvas.width = next.frame.displayWidth * times;
    this.canvas.height = next.frame.displayHeight * times;
    const ink = this.canvas.getContext("2d");
    if (ink) {
      // Le premier temps ne doit RIEN interpoler, sinon on lisse deux fois et
      // on perd ce qu'on était venu chercher.
      ink.imageSmoothingEnabled = times === 1;
      ink.drawImage(next.frame, 0, 0, this.canvas.width, this.canvas.height);
    }
    next.frame.close();
    this.painted += 1;
    if (this.shownAt !== null) this.holds.push(this.ticks - this.shownAt);
    this.shownAt = this.ticks;
    this.waits.push(now - next.decodedAt);
  };

  /** Grows the slack when the picture starves, and earns it back when it does
   * not. It was a whole frame, set once and never given back — felt at the
   * controller, and rightly. */
  private adjust(): void {
    if (this.ticks % 120 !== 0) return;

    // Steer towards "as fast as this pipe has been, plus the slack", five
    // milliseconds at a time: a fifth of a refresh, invisible, and an unlucky
    // first frame is erased in half a minute instead of lasting the session.
    if (this.offset !== null && this.lags.length > 30) {
      const want = this.wantedOffset();
      // Un petit écart se rattrape doucement, un gros se rattrape d'un coup.
      //
      // Mesuré le 2026-08-16 avec `slowlink.mjs`: en gardant l'horaire d'une
      // famine à l'autre, un horaire posé sur les toutes premières images — les
      // plus lentes, puisque la page se télécharge encore — restait faux pour
      // toujours. Cinq millisecondes toutes les deux secondes mettent sept
      // minutes à rattraper une seconde. Le pilote affichait alors 2398 images
      // arrivées et ZÉRO peinte: elles étaient toutes en avance sur un horaire
      // absurde, et jetées quand la file débordait.
      //
      // Le seuil est plus grand que toute dérive légitime d'une fenêtre et plus
      // petit que ces erreurs-là. Un saut visible une fois vaut mieux qu'une
      // image cassée pendant des minutes.
      this.offset = Math.abs(this.offset - want) > SNAP ? want : steer(this.offset, want, 5);
    }

    // Ce qui a été jeté depuis la dernière fenêtre. Une éviction interdit
    // d'agrandir la marge: voir `nextSlack`.
    const evicted = this.skipped - this.skippedSeen;
    this.skippedSeen = this.skipped;
    const grown = nextSlack(this.slackMs, this.starvedRecent, evicted);
    if (grown > this.slackMs) {
      // Appliquée d'un coup à l'horaire: la faire gagner cinq millisecondes
      // toutes les deux secondes laisserait la page affamée pendant la montée.
      if (this.offset !== null) this.offset += grown - this.slackMs;
      this.calmWindows = 0;
    } else if (this.starvedRecent === 0) {
      this.calmWindows += 1;
    } else {
      this.calmWindows = 0;
    }
    this.slackMs = grown;
    this.starvedRecent = 0;
  }

  private watchSilence = (): void => {
    if (!this.connected || this.lastHeard === null) return;
    if (performance.now() - this.lastHeard < SILENCE_LIMIT) return;
    this.stalls += 1;
    this.lastHeard = null;
    this.giveUp(this.socket);
  };

  private watchDecoder = (): void => {
    if (!this.connected) return;
    const now = performance.now();
    // Only while bytes are arriving: if they are not, this is the other
    // watchdog's failure and reconnecting is the right answer.
    if (this.lastHeard === null || now - this.lastHeard >= SILENCE_LIMIT) return;
    // And only while somebody is painting. Without this the watchdogs fired in a
    // loop behind a switched-away tab, tearing the connection down every few
    // seconds — code written to recover a failure, preventing the recovery.
    if (this.lastPaintTick === null || now - this.lastPaintTick > PAINTING_STOPPED) return;

    // Fed, and producing nothing. The gap is measured between the two rather
    // than against the clock, so pausing the feed can never look like a failure.
    if (
      this.lastOutput !== null &&
      this.lastFed !== null &&
      this.lastFed - this.lastOutput > SILENCE_LIMIT
    ) {
      this.restartDecoder();
      return;
    }
    if (
      this.decoder === null &&
      this.decoderGoneSince !== null &&
      now - this.decoderGoneSince > KEY_FRAME_PATIENCE
    ) {
      this.decoderGoneSince = null;
      this.giveUp(this.socket);
    }
  };

  /** The only door in from outside, for the tests that break it on purpose. */
  wedgeDecoder(): void {
    this.decoder?.close();
  }

  stallDecoder(): void {
    if (this.decoder !== null) this.decoder.decode = () => {};
  }
}
