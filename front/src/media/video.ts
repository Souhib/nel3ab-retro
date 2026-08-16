/**
 * The picture: socket, decoder, schedule, and the two watchdogs that keep them
 * honest.
 *
 * Every rule here was paid for. The comments say what by, because the code alone
 * cannot: each one looks removable until you know which failure it answers.
 */
import { Window, steer } from "./clock";
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

/** A safety valve, not the cadence. It was `target + 1`, which fought the
 * schedule and won: the queue kept one picture, the oldest was dropped for each
 * new one, and the head was always a picture whose time had not come — zero
 * painted, 897 dropped, every other counter green. */
const MAX_QUEUE = 8;

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
  refreshHz: number;
  backlog: number;
  fastestLag: number | null;
  /** The delay the schedule adds to every frame, in milliseconds. Null until
   * the first frame sets it. */
  offset: number | null;
};

export class VideoStream {
  private socket: WebSocket | null = null;
  private decoder: VideoDecoder | null = null;
  private readonly queue: Held[] = [];
  private readonly submitted = new Map<number, { at: number; transit: number }>();
  private readonly lags = new Window(240);
  private readonly gaps = new Window(600);
  private readonly holds = new Window(240);
  private readonly waits = new Window(240);
  private readonly refreshes = new Window(120);

  private offset: number | null = null;
  private slackMs = 6;
  private lipsync = 0;
  private awaitingKey = false;
  private priming = true;
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
      refreshHz: 1000 / this.refreshPeriod(),
      backlog: this.decoder?.decodeQueueSize ?? 0,
      fastestLag: this.lags.fastest(),
      offset: this.offset,
    };
  }

  /** The display's own interval, measured rather than assumed: 60, 120 and 240 Hz
   * screens are all in use here and a page that assumes one is wrong on two. */
  private refreshPeriod(): number {
    return this.refreshes.length < 8 ? SOURCE_FRAME : this.refreshes.at(0.5);
  }

  private connect(insist = false): void {
    void insist;
    const socket = new WebSocket(this.url("/video"));
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
    while (this.queue.length > MAX_QUEUE) {
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
      this.starved += 1;
      this.starvedRecent += 1;
      this.repeated += 1;
      this.priming = true;
      this.offset = null;
      return;
    }

    const now = performance.now();
    const slack = this.refreshPeriod() / 2;
    const head = this.queue[0];
    // Anchored WITH the buffer in it. Anchoring on "due the instant the first one
    // was shown" gave the pipeline zero slack: every frame that then arrived a
    // millisecond late was already overdue and thrown away — 491 dropped in
    // fourteen seconds, 27 painted per second out of 60.
    this.offset ??= (this.lags.fastest() ?? 0) + this.slackMs + this.lipsync;
    if (now < head.capturedMs + this.offset - slack) {
      this.repeated += 1;
      return;
    }

    const next = this.queue.shift();
    if (next === undefined) return;
    this.canvas.width = next.frame.displayWidth;
    this.canvas.height = next.frame.displayHeight;
    this.canvas.getContext("2d")?.drawImage(next.frame, 0, 0);
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
      const want = (this.lags.fastest() ?? 0) + this.slackMs + this.lipsync;
      this.offset = steer(this.offset, want, 5);
    }

    if (this.starvedRecent > 1 && this.slackMs < 60) {
      this.slackMs = Math.min(60, this.slackMs + 8);
      if (this.offset !== null) this.offset += 8;
      this.calmWindows = 0;
    } else if (this.starvedRecent === 0) {
      this.calmWindows += 1;
      if (this.slackMs > 3) this.slackMs -= Math.min(2, this.slackMs - 3);
    } else {
      this.calmWindows = 0;
    }
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
