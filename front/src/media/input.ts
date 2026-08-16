/**
 * The controller socket: one seat, and the state that goes down it.
 *
 * The port is the SERVER'S to decide — it alone knows who else is in the room —
 * and it says so in one byte as soon as the socket opens. Zero means no seat.
 */
import { Capture, Lesson, snapshot } from "./lesson";
import { MenuPad, type MenuAction } from "./menupad";
import {
  BUTTON,
  DEFAULT_KEYS,
  encodePad,
  readKeys,
  readPad,
  standardProfile,
  type Action,
  type Control,
  type ControlKey,
  type KeyProfile,
  type PadProfile,
  type PadReading,
} from "./pad";

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
  /** La commande qu'on est en train de réassigner, et où on l'attend. */
  capturing: { control: ControlKey; source: "pad" | "key" } | null;
  /** Le profil de la manette, s'il y en a un. Nul veut dire « pas de manette »
   * ou « la disposition standard, pas encore personnalisée ». */
  profile: PadProfile | null;
  /** Ce que fait chaque touche du clavier. */
  keys: KeyProfile;
  /** Les manettes branchées, dans l'ordre où le navigateur les donne. */
  pads: { index: number; id: string }[];
  /** Celle qui joue et qu'on configure. Nulle quand il n'y en a aucune. */
  using: number | null;
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
  /** Jusqu'à quand cette page s'abstient de reprendre une place.
   *
   * Céder sa manette et se reconnecter poliment une demi-seconde plus tard la
   * reprendrait avant que l'autre ait eu le temps de s'y brancher: la place
   * redevient libre, et la reconnexion polie est faite pour prendre ce qui est
   * libre. Il faut donc un silence volontaire. */
  private silentUntil = 0;
  /** Quand un menu est ouvert, la manette le conduit LUI et pas le jeu.
   *
   * C'est ce que fait une console: on appuie sur un bouton, le jeu continue de
   * tourner, et le pouce parle au menu. Tant que ce gestionnaire est posé, la
   * page envoie un état neutre au jeu, sinon celui qui navigue ferait sauter son
   * personnage à chaque fois qu'il descend d'une ligne. */
  private menu: ((action: MenuAction) => void) | null = null;
  private readonly menuPad = new MenuPad();
  private players = 4;
  private busy: boolean[] = [false, false, false, false];
  private sent = 0;
  private held = new Set<string>();
  private profile: PadProfile | null = null;
  private keys: KeyProfile = loadKeys();
  private lesson: Lesson | null = null;
  private capture: { control: ControlKey; source: "pad" | "key"; machine: Capture | null } | null =
    null;
  private padId: string | null = null;
  private padLayout: "standard" | "unknown" | null = null;
  private pads: { index: number; id: string }[] = [];
  /** La manette choisie, par sa position chez le navigateur.
   *
   * Nulle veut dire « la première branchée », ce qui est le bon défaut: la
   * plupart des gens n'en ont qu'une, et leur demander de choisir serait un
   * écran de plus avant de jouer. */
  private chosen: number | null = null;
  private lastReading: PadReading | null = null;
  private readonly url: (path: string) => string;
  private readonly onSeat: (port: number | null) => void;
  private readonly onSettled: () => void;

  /** `onSettled` prévient quand quelque chose que l'écran montre a changé sans
   * qu'une action de la personne l'ait provoqué: une capture qui se termine, une
   * leçon qui finit. Sans lui, l'écran met jusqu'à une demi-seconde à cesser de
   * dire « appuie sur une touche » alors que la touche est déjà enregistrée. */
  constructor(
    url: (path: string) => string,
    onSeat: (port: number | null) => void,
    onSettled: () => void = () => {},
  ) {
    this.url = url;
    this.onSeat = onSeat;
    this.onSettled = onSettled;
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
      pads: this.pads,
      using: this.current()?.index ?? null,
      displaced: this.displaced,
      capturing:
        this.capture === null
          ? null
          : { control: this.capture.control, source: this.capture.source },
      profile: this.profile,
      keys: this.keys,
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

  /**
   * Commence à réassigner une commande. La prochaine chose qui bouge la prend.
   *
   * Pendant ce temps la manette n'atteint plus le jeu: on continue d'envoyer un
   * état neutre. Sans ça, réassigner « A » consisterait à appuyer sur A dans la
   * partie de tout le monde.
   */
  beginCapture(control: ControlKey, source: "pad" | "key"): void {
    if (source === "key") {
      this.capture = { control, source, machine: null };
      return;
    }
    const pad = this.current();
    if (!pad) return;
    // Le repos est pris MAINTENANT, au clic de souris, donc les mains ne sont
    // pas encore sur la manette. C'est ce qui permet de se passer de l'attente
    // de relâchement que la leçon complète doit faire entre deux questions.
    this.capture = { control, source, machine: new Capture(snapshot(pad)) };
  }

  /** Cède sa place, et se tait le temps que l'autre s'y branche.
   *
   * Le silence est la moitié qui compte: sans lui, la reconnexion polie
   * reprendrait la place à peine libérée, et celui à qui on vient de dire oui
   * la trouverait occupée.
   */
  yieldSeat(silenceMs = 6000): void {
    this.silentUntil = Date.now() + silenceMs;
    this.port = null;
    this.onSeat(null);
    this.generation += 1;
    this.socket?.close();
    this.socket = null;
    this.retry = window.setTimeout(() => this.connect(), silenceMs);
  }

  /** Donne, ou reprend, la manette au menu. */
  setMenu(handler: ((action: MenuAction) => void) | null): void {
    this.menu = handler;
  }

  cancelCapture(): void {
    this.capture = null;
  }

  /** Remet la manette à la disposition d'origine: celle du constructeur si elle
   * est standard, une leçon à refaire sinon. */
  resetPad(): void {
    this.capture = null;
    const pad = this.current();
    if (!pad) return;
    if (pad.mapping === "standard") {
      this.forgetProfile(pad.id);
      this.profile = null;
    } else {
      this.forgetProfile(pad.id);
      this.profile = null;
      this.lesson = new Lesson(pad.id, snapshot(pad));
    }
  }

  resetKeys(): void {
    this.capture = null;
    this.keys = { ...DEFAULT_KEYS };
    keepKeys(this.keys);
  }

  /** Joue et configure CETTE manette-là.
   *
   * Par position et non par identifiant: deux manettes identiques rendent le
   * même identifiant, et c'est exactement le cas où il faut pouvoir choisir.
   * Le profil, lui, reste rangé par identifiant, parce que c'est le matériel
   * qu'on a configuré et pas la prise USB dans laquelle il était.
   */
  useP(index: number | null): void {
    this.chosen = index;
    this.capture = null;
    // Le profil appartient à la manette: en changer veut dire relire celui de la
    // nouvelle, sinon la seconde hérite des touches de la première.
    this.profile = null;
  }

  /** La manette qui joue: celle qu'on a choisie si elle est encore là, sinon la
   * première branchée. Débrancher la sienne ne doit pas laisser la page sans
   * manette alors qu'il en reste une. */
  private current(): Gamepad | null {
    const found = navigator.getGamepads?.() ?? [];
    const connected = [...found].filter((pad): pad is Gamepad => pad !== null);
    if (this.chosen !== null) {
      const wanted = connected.find((pad) => pad.index === this.chosen);
      if (wanted) return wanted;
    }
    return connected[0] ?? null;
  }

  beginLesson(): void {
    const pad = this.current();
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
      // Une place qu'on vient de céder ne se reprend pas par réflexe.
      if (Date.now() < this.silentUntil) return;
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
    // En cours de réassignation: cette touche EST la réponse, elle ne descend
    // pas au jeu et elle ne s'ajoute pas aux touches tenues.
    if (this.capture?.source === "key") {
      event.preventDefault();
      // Échap annule, sinon aucune touche ne pourrait sortir d'une capture.
      if (event.code !== "Escape") this.bindKey(event.code, this.capture.control);
      this.capture = null;
      this.onSettled();
      return;
    }
    if (event.code in this.keys || event.code.startsWith("Arrow")) event.preventDefault();
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
    const found = navigator.getGamepads?.() ?? [];
    this.pads = [...found]
      .filter((candidate): candidate is Gamepad => candidate !== null)
      .map((candidate) => ({ index: candidate.index, id: candidate.id }));
    const pad = this.current();
    if (pad) {
      this.padId = pad.id;
      this.padLayout = pad.mapping === "standard" ? "standard" : "unknown";
      // Learning happens whether or not this page holds a controller, and the
      // presses that answer the questions never reach the game.
      if (this.lesson !== null && !this.lesson.done) {
        this.lesson.feed(snapshot(pad));
        if (this.lesson.done) {
          this.keepProfile(pad.id, this.lesson.learned());
          this.onSettled();
        }
        return;
      }
      if (this.profile === null) this.profile = this.loadProfile(pad.id);
      // Une réassignation de manette en cours: on regarde ce qui bouge, et rien
      // ne part au jeu tant qu'on n'a pas fini.
      if (this.capture?.machine) {
        const moved = this.capture.machine.feed(snapshot(pad));
        if (moved) {
          this.bindPad(pad, this.capture.control, moved.control, moved.value);
          this.capture = null;
          this.onSettled();
        }
      }
    }
    // Rien ne descend au jeu pendant une capture: réassigner « A » ne doit pas
    // appuyer sur A dans la partie de tout le monde. On envoie quand même un
    // état neutre, sinon le dernier appui resterait tenu dans l émulateur.
    if (this.capture !== null) {
      this.sendNeutral();
      return;
    }

    // Un menu ouvert prend la main. Le clavier ET la manette, parce que les deux
    // conduisent la même croix.
    if (this.menu !== null) {
      const reading = pad ? readPad(pad, this.profile) : readKeys(this.held, this.keys);
      const action = this.menuPad.feed(reading, performance.now());
      if (action !== null) this.menu(action);
      this.sendNeutral();
      return;
    }

    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN || this.port === null) {
      return;
    }

    // The keyboard first, then the pad on top of it: a stick at rest must not
    // cancel a key being held.
    let reading: PadReading = readKeys(this.held, this.keys);
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

  /** Écrit une commande dans le profil de la manette.
   *
   * Si la manette est standard et n'a pas encore de profil, on matérialise la
   * table du constructeur d'abord: sans ça il n'y aurait rien à modifier, et le
   * premier changement effacerait les quinze autres commandes.
   */
  private bindPad(pad: Gamepad, key: ControlKey, control: Control, value: number): void {
    const profile = this.profile ?? standardProfile(pad.id);
    if (key === "L" || key === "R") {
      profile.triggers[key] = control;
    } else if (key === "x" || key === "y" || key === "cx" || key === "cy") {
      // Un stick est signé, et le signe est le sens qu'on vient de pousser:
      // demander la DROITE ou le HAUT veut dire que ce sens-là est positif.
      if ("axis" in control) {
        profile.sticks[key] = { axis: control.axis, sign: value >= control.rest ? 1 : -1 };
      }
    } else {
      profile.buttons[key] = control;
    }
    this.keepProfile(pad.id, profile);
  }

  /** Écrit une touche dans le profil du clavier.
   *
   * Une touche ne fait qu'une chose: si elle servait déjà ailleurs, elle quitte
   * son ancien poste. Deux commandes sur la même touche donneraient une manette
   * où appuyer sur X fait A et saute, sans rien pour l'expliquer.
   */
  private bindKey(code: string, key: ControlKey): void {
    const action = actionFor(key);
    const keys: KeyProfile = {};
    for (const [existing, what] of Object.entries(this.keys)) {
      if (existing !== code && !sameAction(what, action)) keys[existing] = what;
    }
    keys[code] = action;
    this.keys = keys;
    keepKeys(keys);
  }

  private forgetProfile(id: string): void {
    try {
      localStorage.removeItem(`nel3ab.pad.${id}`);
    } catch {
      // Navigation privée: le profil disparaît de toute façon avec l'onglet.
    }
  }

  /** Un état où rien n'est appuyé, pour que l'émulateur ne garde pas le dernier.
   *
   * Compté comme les autres: `sent` veut dire « trames posées sur le fil », et
   * une trame neutre en est une. La distinguer donnerait un compteur qui tombe à
   * zéro dès qu'un menu est ouvert, et un banc d'essai qui vérifie « cette page
   * pilote-t-elle vraiment » y verrait une page muette. */
  private sendNeutral(): void {
    if (this.socket?.readyState !== WebSocket.OPEN || this.port === null) return;
    const neutral: PadReading = { buttons: 0, x: 0, y: 0, cx: 0, cy: 0, l: 0, r: 0 };
    this.lastReading = neutral;
    this.socket.send(encodePad(this.port, neutral));
    this.sent += 1;
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

/** Ce qu'une commande de GameCube veut dire pour une touche de clavier. */
function actionFor(key: ControlKey): Action {
  if (key === "L" || key === "R") return { kind: "trigger", side: key };
  if (key === "x" || key === "y" || key === "cx" || key === "cy") {
    // Le tableau demande « stick → » et « stick ↑ », donc le sens positif. Les
    // sens négatifs se réassignent en cliquant la ligne opposée, qui existe.
    return { kind: "stick", stick: key, sign: 1 };
  }
  return { kind: "button", name: key };
}

function sameAction(left: Action, right: Action): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "button") return left.name === (right as typeof left).name;
  if (left.kind === "trigger") return left.side === (right as typeof left).side;
  const other = right as typeof left;
  return left.stick === other.stick && left.sign === other.sign;
}

const KEYS_STORED = "nel3ab.keys";

function loadKeys(): KeyProfile {
  try {
    const found = localStorage.getItem(KEYS_STORED);
    return found ? (JSON.parse(found) as KeyProfile) : { ...DEFAULT_KEYS };
  } catch {
    // Un profil illisible est un profil qu'on remplace, pas une page qui refuse
    // de démarrer.
    return { ...DEFAULT_KEYS };
  }
}

function keepKeys(keys: KeyProfile): void {
  try {
    localStorage.setItem(KEYS_STORED, JSON.stringify(keys));
  } catch {
    /* navigation privée */
  }
}
