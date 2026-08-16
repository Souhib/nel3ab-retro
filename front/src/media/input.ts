/**
 * The controller socket: one seat, and the state that goes down it.
 *
 * The port is the SERVER'S to decide — it alone knows who else is in the room —
 * and it says so in one byte as soon as the socket opens. Zero means no seat.
 */
import { Lesson, snapshot } from "./lesson";
import { BUTTON, KEYS, encodePad, readPad, type PadProfile, type PadReading } from "./pad";

/** How often the pad state is sent.
 *
 * It used to go out on the display's refresh, and the emulator polls its pads
 * once per emulated frame — so the delay was the PHASE between two 60 Hz clocks,
 * which settle against each other for minutes. Measured: 8.24 ms one run, 5.76
 * the next, by luck alone. Four milliseconds is the floor a browser timer will
 * honour, and it bounds that phase instead of leaving it to chance.
 *
 * Both this AND the refresh, whichever comes first: the pipe writer coalesces
 * identical states, so a redundant send costs one decode and a compare. */
const PAD_PERIOD_MS = 4;

export type InputState = {
  port: number | null;
  refused: boolean;
  sent: number;
  padId: string | null;
  padLayout: "standard" | "unknown" | null;
  learning: string | null;
  pressed: string[];
  /** True once this page HAD a pad and was told it no longer has one.
   *
   * A page that never got one and a page that was displaced look identical from
   * the port alone, and they are not the same news: the second means somebody
   * in the room took it, and saying nothing leaves a player pressing buttons at
   * a game that stopped listening. */
  displaced: boolean;
  /** How many pads this room has. */
  players: number;
  /** Which of them are held, this one included. */
  busy: boolean[];
};

/** What the worker says about the room, in one message on the pad socket.
 *
 * `[players, mine, busy1, busy2, busy3, busy4]`, where `mine` is 0 for "no pad".
 * One message rather than two, because a page that only knew its own port could
 * not tell a free socket from somebody else's, and seeing the room is the whole
 * point of drawing the four sockets.
 *
 * The worker is the authority here (ADR D12). The control plane knows the NAMES
 * beside these seats and nothing more, which is why it can be down while the
 * game carries on.
 */
const ROOM_MESSAGE_BYTES = 2 + 4;

export type RoomMessage = { players: number; port: number | null; busy: boolean[] };

/** Reads that message, or refuses it.
 *
 * A separate function because the first port of this page read it as a single
 * byte, which is what the seat used to be. Nothing failed: the page simply never
 * showed a pad, and only a real browser against a real worker said so. The shape
 * of a message is exactly the kind of thing a unit test can pin, so it does.
 */
export function readRoomMessage(bytes: Uint8Array): RoomMessage | null {
  if (bytes.length !== ROOM_MESSAGE_BYTES) return null;
  const players = bytes[0] ?? 0;
  const seat = bytes[1] ?? 0;
  // A room says how many pads it has, and a seat outside that is not a seat.
  if (players < 1 || players > 4 || seat > players) return null;
  return {
    players,
    port: seat === 0 ? null : seat,
    busy: [...bytes.slice(2)].map((held) => held !== 0),
  };
}

export class InputStream {
  private socket: WebSocket | null = null;
  private generation = 0;
  private retry: number | null = null;
  private timers: number[] = [];
  private port: number | null = null;
  private refused = false;
  private everHeld = false;
  private displaced = false;
  private players = 4;
  private busy: boolean[] = [false, false, false, false];
  private sent = 0;
  private held = new Set<string>();
  private profile: PadProfile | null = null;
  private lesson: Lesson | null = null;
  private padId: string | null = null;
  private padLayout: "standard" | "unknown" | null = null;
  private lastReading: PadReading | null = null;
  private readonly url: (path: string) => string;
  private readonly onSeat: (port: number | null) => void;

  constructor(url: (path: string) => string, onSeat: (port: number | null) => void) {
    this.url = url;
    this.onSeat = onSeat;
  }

  start(): void {
    this.connect();
    addEventListener("keydown", this.onKeyDown);
    addEventListener("keyup", this.onKeyUp);
    addEventListener("blur", this.onBlur);
    this.timers.push(window.setInterval(this.pump, PAD_PERIOD_MS));
    requestAnimationFrame(this.pumpOnRefresh);
  }

  stop(): void {
    for (const timer of this.timers) window.clearInterval(timer);
    this.timers = [];
    removeEventListener("keydown", this.onKeyDown);
    removeEventListener("keyup", this.onKeyUp);
    removeEventListener("blur", this.onBlur);
    this.generation += 1;
    this.socket?.close();
    this.socket = null;
  }

  state(): InputState {
    return {
      port: this.port,
      refused: this.refused,
      sent: this.sent,
      padId: this.padId,
      padLayout: this.padLayout,
      learning: this.lesson?.done === false ? this.lesson.asking : null,
      pressed: this.pressedNames(),
      players: this.players,
      busy: this.busy,
      displaced: this.displaced,
    };
  }

  /** Takes THAT pad, displacing whoever holds it.
   *
   * The port is chosen rather than assumed. The first port of this page always
   * asked for port 1, which in a full room means the same player is thrown out
   * every time whatever the clicker meant.
   *
   * Only a person may ask. Doing it automatically would have two open pages
   * trade the pad between them for ever.
   */
  take(port: number): void {
    // Reprendre une place est une décision, donc elle efface l'avis.
    this.displaced = false;
    this.connect(port);
  }

  /** Boots the game at that position in the worker's library.
   *
   * Two bytes on the pad's own socket: the opcode, then the position. Never a
   * name and never a path, so the only games a page can ask for are the ones the
   * worker itself found. Holding a pad is therefore what makes the command
   * possible to send, which is also the rule the page states out loud.
   *
   * Returns whether the command left, so the caller can say "il faut une
   * manette" rather than appear to have worked.
   */
  chooseGame(index: number): boolean {
    if (this.port === null || this.socket?.readyState !== WebSocket.OPEN) return false;
    if (!Number.isInteger(index) || index < 0 || index > 255) return false;
    this.socket.send(new Uint8Array([1, index]));
    return true;
  }

  beginLesson(): void {
    const pad = navigator.getGamepads?.().find((candidate) => candidate);
    if (!pad) return;
    this.lesson = new Lesson(pad.id, snapshot(pad));
  }

  skipLessonStep(): void {
    this.lesson?.skip();
  }

  private connect(take: number | null = null): void {
    this.generation += 1;
    const mine = this.generation;
    if (this.retry !== null) {
      window.clearTimeout(this.retry);
      this.retry = null;
    }
    // ONE socket at a time. A refused page has a retry already scheduled, so
    // pressing the button opened a second connection beside it: the insisting
    // one took the port and the polite one was refused half a second later,
    // overwriting the display with "no controller" while the page HELD it.
    if (this.socket !== null) {
      this.socket.onclose = null;
      this.socket.close();
    }
    this.refused = false;
    const socket = new WebSocket(this.url(take === null ? "/input" : `/input?take=${take}`));
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (mine !== this.generation) return;
      const told = readRoomMessage(new Uint8Array(event.data));
      if (told === null) return;
      this.players = told.players;
      this.port = told.port;
      this.refused = this.port === null;
      // Displaced, rather than merely without: this page held a pad and the
      // worker has just told it that it does not.
      if (this.port === null) this.displaced = this.everHeld;
      else {
        this.everHeld = true;
        this.displaced = false;
      }
      this.busy = told.busy;
      this.onSeat(this.port);
    };
    socket.onclose = () => {
      if (mine !== this.generation) return;
      this.port = null;
      this.onSeat(null);
      // A DISPLACED page stops asking. Found by the player: his page was taken,
      // picked up the next free socket three seconds later, and he carried on
      // driving a different character with nothing on screen to say so. Coming
      // back has to be a click, because only a person knows which character they
      // meant to be.
      if (this.displaced) return;
      // Half a second after a drop, three after a refusal. Asking POLITELY takes
      // nothing from anybody, so a page whose room was full picks the controller
      // up by itself the moment it is free.
      this.retry = window.setTimeout(() => this.connect(), this.refused ? 3000 : 500);
    };
    socket.onerror = () => {
      if (mine === this.generation) socket.close();
    };
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code in KEYS || event.code.startsWith("Arrow")) event.preventDefault();
    this.held.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  private onBlur = (): void => {
    this.held.clear();
  };

  private pumpOnRefresh = (): void => {
    requestAnimationFrame(this.pumpOnRefresh);
    this.pump();
  };

  private pump = (): void => {
    const pad = navigator.getGamepads?.().find((candidate) => candidate);
    if (pad) {
      this.padId = pad.id;
      this.padLayout = pad.mapping === "standard" ? "standard" : "unknown";
      // Learning happens whether or not this page holds a controller, and the
      // presses that answer the questions never reach the game.
      if (this.lesson !== null && !this.lesson.done) {
        this.lesson.feed(snapshot(pad));
        if (this.lesson.done) this.keepProfile(pad.id, this.lesson.learned());
        return;
      }
      if (this.profile === null) this.profile = this.loadProfile(pad.id);
    }

    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN || this.port === null) {
      return;
    }

    // The keyboard first, then the pad on top of it: a stick at rest must not
    // cancel a key being held.
    let buttons = 0;
    for (const [code, name] of Object.entries(KEYS)) {
      if (this.held.has(code)) buttons |= BUTTON[name];
    }
    let reading: PadReading = {
      buttons,
      x: (this.held.has("ArrowRight") ? 1 : 0) - (this.held.has("ArrowLeft") ? 1 : 0),
      y: (this.held.has("ArrowUp") ? 1 : 0) - (this.held.has("ArrowDown") ? 1 : 0),
      cx: 0,
      cy: 0,
      l: this.held.has("KeyQ") ? 255 : 0,
      r: this.held.has("KeyE") ? 255 : 0,
    };
    if (pad) {
      const fromPad = readPad(pad, this.profile);
      reading = {
        buttons: reading.buttons | fromPad.buttons,
        x: fromPad.x || reading.x,
        y: fromPad.y || reading.y,
        cx: fromPad.cx,
        cy: fromPad.cy,
        l: Math.max(reading.l, fromPad.l),
        r: Math.max(reading.r, fromPad.r),
      };
    }
    this.lastReading = reading;
    this.socket.send(encodePad(this.port, reading));
    this.sent += 1;
  };

  /** Which buttons are down, for a page that shows them. */
  private pressedNames(): string[] {
    const buttons = this.lastReading?.buttons ?? 0;
    return Object.entries(BUTTON)
      .filter(([, bit]) => (buttons & bit) !== 0)
      .map(([name]) => name);
  }

  private keepProfile(id: string, profile: PadProfile): void {
    this.profile = profile;
    try {
      localStorage.setItem(`nel3ab.pad.${id}`, JSON.stringify(profile));
    } catch {
      // Private browsing. The profile still works for this session.
    }
  }

  private loadProfile(id: string): PadProfile | null {
    try {
      const saved = localStorage.getItem(`nel3ab.pad.${id}`);
      return saved ? (JSON.parse(saved) as PadProfile) : null;
    } catch {
      return null;
    }
  }

  readPadNow(pad: Gamepad): PadReading {
    return readPad(pad, this.profile);
  }

  encode(port: number, reading: PadReading): Uint8Array {
    return encodePad(port, reading);
  }
}
