/**
 * The controller socket: one seat, and the state that goes down it.
 *
 * The port is the SERVER'S to decide — it alone knows who else is in the room —
 * and it says so in one byte as soon as the socket opens. Zero means no seat.
 */
import { Window } from "./clock";
import { Touch } from "./touch";
import { Capture, Lesson, loudest, snapshot, type Snapshot } from "./lesson";
import { MenuPad, type MenuAction } from "./menupad";
import {
  BUTTON,
  DEFAULT_KEYS,
  encodePad,
  readKeys,
  merge,
  readPad,
  standardProfile,
  type Action,
  type Control,
  type ControlKey,
  type KeyProfile,
  type PadProfile,
  type PadReading,
} from "./pad";
import { KEYS_STORED, PAD_PREFIX, push as pushBindings } from "../lib/bindings";
import { roomReference } from "../lib/bindings";
import { typingIn } from "../lib/typing";
import {
  activated,
  added,
  edited,
  fresh,
  mine as ownKeys,
  names as keyNames,
  playing as playingKeys,
  readKeySet,
  removed,
  ROOM_MARK,
  withRoom,
  type KeySet,
} from "../lib/keys";

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
  /** Vrai quand cette page regarde sans manette, par choix. */
  watching: boolean;
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
  /** Cette page a-t-elle le droit de changer le jeu, en ce moment ?
   *
   * C'est le WORKER qui le dit, parce que c'est lui qui accepte ou refuse. Il
   * répond oui à la place propriétaire, et aussi à tout le monde quand cette
   * place n'a rien touché depuis trois minutes: sans ça, quelqu'un qui part
   * manger en gardant son onglet ouvert bloque la soirée entière. */
  deciding: boolean;
  /** La commande qu'on est en train de réassigner, et où on l'attend. */
  capturing: { control: ControlKey; source: "pad" | "key" } | null;
  /** Les jeux de touches de cette personne, dans l'ordre de création.
   *
   * PERSONNELS: en changer ne touche ni la salle, ni la partie, ni l'écran de
   * qui que ce soit. C'est ce qui les distingue du type de manette, qui est un
   * réglage de la salle et fait redémarrer le jeu. */
  keyProfiles: string[];
  /** Celui qui joue. */
  keyProfile: string;
  /** Ceux qui viennent de la SALLE: ni modifiables, ni effaçables.
   *
   * Ils ne sont pas rangés dans le dossier de la personne. Les modifier crée une
   * copie à soi plutôt que de refuser, donc rien ne bute et la référence reste
   * ce qu'elle est. */
  lockedProfiles: string[];
  /** Le profil de la manette, s'il y en a un. Nul veut dire « pas de manette »
   * ou « la disposition standard, pas encore personnalisée ». */
  profile: PadProfile | null;
  /** L'aller-retour de la manette jusqu'à la salle, en millisecondes.
   *
   * La médiane des trente derniers. Nul veut dire « pas encore mesuré », et pas
   * « zéro milliseconde »: une page qui vient d'ouvrir n'a rien envoyé, et
   * afficher zéro serait annoncer une liaison parfaite là où il n'y a aucune
   * mesure. */
  roundTripMs: number | null;
  /** Ce que fait chaque touche du clavier. */
  keys: KeyProfile;
  /** Les manettes branchées, dans l'ordre où le navigateur les donne.
   *
   * Les COMPTES en font partie: le banc d'essai montre une jauge par bouton et
   * un cadran par paire d'axes, et il les tient d'ici plutôt que de relire le
   * navigateur pour son compte. Deux lectures de la même manette finiraient par
   * ne pas dire le même nombre le jour d'un débranchement. Ils ne bougent qu'à
   * un branchement, donc l'instantané deux fois par seconde suffit. */
  pads: { index: number; id: string; buttons: number; axes: number }[];
  /** Celle qui joue et qu'on configure. Nulle quand il n'y en a aucune. */
  using: number | null;
};

/** What the worker says about the room, in one message on the pad socket.
 *
 * `[players, mine, deciding, busy1, busy2, busy3, busy4]`, where `mine` is 0
 * for "no pad" and `deciding` says whether this page may change the game.
 * One message rather than two, because a page that only knew its own port could
 * not tell a free socket from somebody else's, and seeing the room is the whole
 * point of drawing the four sockets.
 *
 * The worker is the authority here (ADR D12). The control plane knows the NAMES
 * beside these seats and nothing more, which is why it can be down while the
 * game carries on.
 */
const ROOM_MESSAGE_BYTES = 3 + 4;

export type RoomMessage = {
  players: number;
  port: number | null;
  /** Cette page peut-elle changer le jeu ? Voir `InputState.deciding`. */
  deciding: boolean;
  busy: boolean[];
};

/** Une secousse: quelle manette, et à quelle force de zéro à un. */
export type Shake = { port: number; strength: number };

/** Combien de temps entre deux mesures d'aller-retour, en millisecondes.
 *
 * Une seconde. Neuf octets par seconde et par page, soit un millième du trafic
 * d'une manette, qui en envoie treize soixante fois par seconde. La mesure ne
 * coûte donc rien à ce qu'elle mesure, ce qui est la première chose à vérifier
 * quand on ajoute une sonde sur un chemin chaud.
 */
const ECHO_EVERY_MS = 1000;

/** Au bout de combien de temps on oublie un aller-retour parti.
 *
 * Cinq secondes. Au-delà, la liaison est cassée plutôt que lente, et garder le
 * départ ne sert qu'à faire grossir la table pendant toute la soirée. */
const ECHO_FORGET_MS = 5000;

/** La marque d'un aller-retour, la même que `Echo::TAG` côté worker. */
const ECHO_TAG = 0xe0;

/** Combien d'octets un aller-retour occupe. La même que `Echo::LEN`. */
const ECHO_LEN = 9;

/** Prépare un aller-retour portant ce numéro.
 *
 * Le jeton est un compteur, pas une horodate: le worker le rend tel quel sans
 * rien y lire, et la page garde de son côté l'instant qui va avec. Envoyer
 * l'instant reviendrait à publier une horloge dont personne n'a besoin.
 */
export function askEcho(ticket: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(ECHO_LEN));
  bytes[0] = ECHO_TAG;
  new DataView(bytes.buffer).setUint32(1, ticket >>> 0, true);
  return bytes;
}

/** Le numéro d'un aller-retour qui revient, ou rien si ce n'en est pas un. */
export function readEcho(bytes: Uint8Array): number | null {
  if (bytes.length !== ECHO_LEN || bytes[0] !== ECHO_TAG) return null;
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(1, true);
}

/**
 * La vibration que l'émulateur demande, ou rien.
 *
 * Deux octets contre sept pour la salle, et c'est la LONGUEUR qui les distingue.
 * Pas de tag, pas de version: le décodeur de salle rejette déjà tout ce qui n'a
 * pas sa taille, donc une page qui ne connaîtrait pas les secousses les ignore
 * sans rien casser, et une page qui les connaît ne peut pas confondre les deux.
 */
export function readShake(bytes: Uint8Array): Shake | null {
  if (bytes.length !== 2) return null;
  const port = bytes[0] ?? 0;
  const level = bytes[1] ?? 0;
  if (port < 1 || port > 4) return null;
  return { port, strength: level / 255 };
}

/** Combien de temps une secousse dure, en millisecondes.
 *
 * Cent vingt. Assez pour se sentir, assez court pour que la suivante la
 * remplace sans qu'on entende un trou: l'émulateur en envoie une à chaque
 * changement, et un jeu qui secoue en continu en envoie plusieurs par seconde.
 */
const SHAKE_MS = 120;

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
    deciding: (bytes[2] ?? 0) !== 0,
    busy: [...bytes.slice(3)].map((held) => held !== 0),
  };
}

export class InputStream {
  private socket: WebSocket | null = null;
  private generation = 0;
  private retry: number | null = null;
  private timers: number[] = [];
  private port: number | null = null;
  private refused = false;
  /** Combien de secousses cette page a reçues, pour les pilotes.
   *
   * Une vibration ne se mesure pas depuis un navigateur sans mains: ce compteur
   * est la seule preuve qu'elle est arrivée jusqu'ici. */
  private shakes = 0;
  /** Cette page peut-elle changer le jeu ? Dit par le worker. */
  private deciding = false;
  private everHeld = false;
  /** Les allers-retours mesurés, en millisecondes. Trente échantillons, soit
   * une demi-minute: assez pour que la médiane ne suive pas un hoquet, assez
   * court pour qu'elle suive un vrai changement de liaison. */
  private readonly trips = new Window(30);
  /** Le numéro du prochain aller-retour, et l'instant de ceux qui sont partis.
   *
   * Par NUMÉRO et pas par un simple « le dernier »: sur une liaison lente, deux
   * allers-retours peuvent être en vol en même temps, et attribuer le retour de
   * l'un au départ de l'autre donnerait une latence inventée. */
  private ticket = 0;
  private readonly sentAt = new Map<number, number>();
  private displaced = false;
  /** Jusqu'à quand cette page s'abstient de reprendre une place.
   *
   * Céder sa manette et se reconnecter poliment une demi-seconde plus tard la
   * reprendrait avant que l'autre ait eu le temps de s'y brancher: la place
   * redevient libre, et la reconnexion polie est faite pour prendre ce qui est
   * libre. Il faut donc un silence volontaire. */
  private silentUntil = 0;
  /** Vrai quand cette page a choisi de REGARDER, sans manette.
   *
   * Un drapeau plutôt qu'un simple « pas de socket », parce que la reconnexion
   * polie existe: une page qui ferme sa socket la rouvre une demi-seconde plus
   * tard et reprend une place. Sans ce drapeau, « passer spectateur » durerait
   * une demi-seconde. */
  private watching: boolean;
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
  /** Les profils nommés, et lequel joue. */
  private keySet: KeySet = loadKeys();
  /** Le profil qui joue, à plat: la boucle le lit à chaque image, et traverser
   * le dossier à chaque tour coûterait pour rien. */
  private keys: KeyProfile = playingKeys(this.keySet);
  /** La console du jeu en cours, pour NOMMER les commandes.
   *
   * Rien de ce qu'on envoie n'en dépend: la trame est la même. Seules les
   * questions posées pendant l'apprentissage changent, parce que personne ne
   * cherche « le bouton X » sur une Wiimote. */
  private console = "gc";
  /** Ce qu'on tient: `0` la manette GameCube, `1` la Wiimote, `2` la guitare.
   *
   * Sert à NOMMER les commandes, pas à les envoyer: la trame est la même dans
   * les trois cas, et c'est Dolphin qui la relit autrement. */
  private pad: 0 | 1 | 2 = 0;
  private lesson: Lesson | null = null;
  private capture: { control: ControlKey; source: "pad" | "key"; machine: Capture | null } | null =
    null;
  private padId: string | null = null;
  private padLayout: "standard" | "unknown" | null = null;
  private pads: { index: number; id: string; buttons: number; axes: number }[] = [];
  /** La manette choisie, par sa position chez le navigateur.
   *
   * Nulle veut dire « la première branchée », ce qui est le bon défaut: la
   * plupart des gens n'en ont qu'une, et leur demander de choisir serait un
   * écran de plus avant de jouer. */
  private chosen: number | null = null;
  /** Le profil de chaque manette, par son identifiant.
   *
   * Une carte et plus un seul profil, parce qu'on les lit toutes: un adaptateur
   * GameCube et une manette Xbox branchés ensemble n'ont pas la même
   * disposition, et lire la seconde avec le profil de la première donnerait des
   * boutons au hasard. `localStorage` est synchrone, donc on se souvient. */
  private readonly profiles = new Map<string, PadProfile | null>();
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
    watching = false,
  ) {
    this.url = url;
    this.onSeat = onSeat;
    this.onSettled = onSettled;
    this.watching = watching;
  }

  start(): void {
    // Une page qui entre pour regarder ne prend jamais de place, même une
    // fraction de seconde. Se brancher puis se débrancher volerait une manette
    // à quelqu'un le temps d'un aller-retour, et l'aurait affiché.
    if (!this.watching) this.connect();
    addEventListener("keydown", this.onKeyDown);
    addEventListener("keyup", this.onKeyUp);
    addEventListener("blur", this.onBlur);
    this.timers.push(window.setInterval(this.pump, PAD_PERIOD_MS));
    this.timers.push(window.setInterval(this.ping, ECHO_EVERY_MS));
    requestAnimationFrame(this.pumpOnRefresh);
  }

  /** Envoie un aller-retour, et oublie ceux qui ne sont jamais revenus.
   *
   * Le ménage compte: sans lui, une liaison qui perd des messages ferait grossir
   * la table des départs pendant toute la soirée, ce qui est une fuite mémoire
   * dans le chemin le plus long de la page.
   */
  private readonly ping = (): void => {
    const socket = this.socket;
    if (socket === null || socket.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    for (const [ticket, at] of this.sentAt) {
      if (now - at > ECHO_FORGET_MS) this.sentAt.delete(ticket);
    }
    this.ticket = (this.ticket + 1) >>> 0;
    this.sentAt.set(this.ticket, now);
    try {
      socket.send(askEcho(this.ticket));
    } catch {
      this.sentAt.delete(this.ticket);
    }
  };

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
      watching: this.watching,
      refused: this.refused,
      sent: this.sent,
      padId: this.padId,
      padLayout: this.padLayout,
      learning: this.lesson?.done === false ? this.lesson.asking : null,
      pressed: this.pressedNames(),
      players: this.players,
      busy: this.busy,
      deciding: this.deciding,
      pads: this.pads,
      using: this.current()?.index ?? null,
      displaced: this.displaced,
      capturing:
        this.capture === null
          ? null
          : { control: this.capture.control, source: this.capture.source },
      profile: this.profile,
      keys: this.keys,
      keyProfiles: keyNames(this.keySet),
      keyProfile: this.keySet.active,
      lockedProfiles: this.keySet.locked,
      roundTripMs: this.trips.length === 0 ? null : Math.round(this.trips.at(0.5)),
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
    // Reprendre une place est une décision, donc elle efface l'avis. Et le mode
    // spectateur avec, sinon la place prise serait rendue à la première coupure.
    this.displaced = false;
    this.watching = false;
    this.silentUntil = 0;
    this.connect(port);
  }

  /** Rend la manette et n'en redemande plus: regarder, sans jouer.
   *
   * Différent de [`yieldSeat`], qui rend la place pour la durée d'un échange et
   * revient tout seul. Ici personne ne revient tant que la personne n'a pas
   * redemandé, parce que c'est elle qui a décidé de regarder.
   */
  watchOnly(): void {
    if (this.watching) return;
    this.watching = true;
    this.port = null;
    this.generation += 1;
    if (this.retry !== null) {
      window.clearTimeout(this.retry);
      this.retry = null;
    }
    this.socket?.close();
    this.socket = null;
    this.onSeat(null);
  }

  /** Redemande une manette: la première libre.
   *
   * Poliment, donc sans déloger personne. Prendre une place occupée reste un
   * geste distinct, [`take`], parce que seule la personne sait quelle place elle
   * visait.
   */
  play(): void {
    this.watching = false;
    this.displaced = false;
    this.silentUntil = 0;
    this.connect();
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
   * Dit sur quelle sauvegarde le prochain jeu doit démarrer.
   *
   * Un message à part de `chooseGame`, envoyé JUSTE AVANT lui: le worker retient
   * le choix sans rien déclencher, et c'est le changement de jeu qui agit. Les
   * séparer laisse changer d'avis sur la sauvegarde sans redémarrer la salle.
   *
   * Zéro est la partie neuve, un est celle où tout est débloqué. Voir
   * `nel3ab_emulator::saves::Slot`, qui est l'endroit où ces deux nombres sont
   * définis; ici on ne fait que les transporter.
   */
  chooseSave(slot: number): boolean {
    if (this.port === null || this.socket?.readyState !== WebSocket.OPEN) return false;
    if (slot !== 0 && slot !== 1) return false;
    this.socket.send(new Uint8Array([2, slot]));
    return true;
  }

  /**
   * Dit quelle manette le prochain jeu Wii doit présenter.
   *
   * Zéro la manette GameCube, un la Wiimote. Une SEULE des deux, et c'est tout
   * l'intérêt du message: elles peuvent lire le même tuyau, mais un jeu qui voit
   * les deux compte deux manettes pour une personne. À deux joueurs, le premier
   * occupe deux places et le second n'entre jamais.
   *
   * Sans effet sur un jeu GameCube, qui n'a pas de Wiimote: le worker le sait et
   * garde la sienne quoi qu'on demande.
   */
  choosePad(kind: number): boolean {
    if (kind !== 0 && kind !== 1 && kind !== 2) return false;
    // Retenu AVANT de regarder la socket, et même si l'envoi échoue: ce qu'on
    // tient décide aussi des mots de l'écran des touches, et cette moitié-là ne
    // dépend d'aucun réseau. Les lier ferait qu'une socket fermée une seconde
    // laisserait la leçon demander « le bouton X » à quelqu'un qui tient une
    // guitare.
    this.pad = kind;
    if (this.port === null || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(new Uint8Array([3, kind]));
    return true;
  }

  /**
   * Dit ce qu'on veut au bout de SA Wiimote, tout de suite.
   *
   * Zéro le Nunchuk, un la guitare.
   *
   * # Ce qui la distingue de `choosePad`
   *
   * `choosePad` est RETENU: il ne décide de rien jusqu'au prochain démarrage,
   * parce qu'une manette GameCube et une Wiimote sont deux APPAREILS et qu'un
   * appareil ne se remplace pas à chaud. Une extension, si: Dolphin l'échange en
   * cours de partie, comme on débranche un Nunchuk pour brancher une guitare
   * sans éteindre la console. Rien ne redémarre, et la partie des autres ne
   * bouge pas.
   *
   * La place n'est pas dans le message: c'est celle de la socket, décidée par le
   * worker. Personne ne peut donc viser la Wiimote de son voisin.
   */
  chooseExtension(kind: number): boolean {
    if (kind !== 0 && kind !== 1) return false;
    if (this.port === null || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(new Uint8Array([4, kind]));
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

  /** La dernière lecture envoyée au jeu.
   *
   * Exposée pour les pilotes: « la page a envoyé quelque chose » et « la
   * poussée de CETTE manette y est » sont deux affirmations différentes, et
   * seule la seconde attrape une manette qu'on aurait cessé de lire.
   */
  lastSent(): PadReading | null {
    return this.lastReading;
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
      this.lesson = new Lesson(pad.id, snapshot(pad), this.console, this.pad);
    }
  }

  /**
   * Joue ce jeu de touches-là.
   *
   * Personnel et immédiat: rien ne part sur le réseau, rien ne redémarre. C'est
   * la différence avec le type de manette, qui est un réglage de la salle et
   * fait repartir la partie de tout le monde. Les avoir confondus une demi-heure
   * a suffi pour qu'un réglage de touches coupe la partie de quatre personnes.
   */
  pickKeys(name: string): void {
    this.capture = null;
    this.keySet = activated(this.keySet, name);
    this.keys = playingKeys(this.keySet);
    keepKeys(this.keySet);
  }

  /** Un jeu de touches de plus, actif, copie de celui qui jouait.
   *
   * Un nom vide ou déjà pris ne fait rien, et le dit en ne changeant rien: voir
   * `added`, qui porte la règle. */
  newKeys(name: string): void {
    this.capture = null;
    this.keySet = added(this.keySet, name);
    this.keys = playingKeys(this.keySet);
    keepKeys(this.keySet);
  }

  /** Relit ce que la salle propose, sans toucher à ce qui est à soi.
   *
   * # Pourquoi ça ne pouvait pas marcher avant
   *
   * La référence était lue UNE FOIS, à la construction de cette boucle. Publier
   * un profil arrivait donc chez les gens qui ouvraient la page ensuite, et chez
   * personne d'autre: un ami déjà connecté ne voyait jamais rien changer, et le
   * bouton avait l'air cassé alors que le service répondait 200.
   *
   * Reconstruit depuis `mine`, jamais depuis le mélange: `withRoom` ajoute les
   * profils de la salle à ceux de la personne, et repartir du mélange les
   * empilerait à chaque relecture. Les profils de la salle qui ont disparu s'en
   * vont donc aussi, ce qui est le comportement voulu — une référence retirée
   * doit se retirer.
   *
   * Ce qui JOUE ne change pas si la personne avait choisi un profil à elle. Si
   * elle jouait un profil de la salle qui vient d'être republié, elle joue la
   * nouvelle version: c'est la définition d'une référence.
   */
  refreshRoomKeys(): void {
    const proposed = readKeySet(roomReference().keys);
    // `mine` rend le dossier sans les profils de la salle, mais sans la liste
    // des verrous: c'est `withRoom` qui la reconstruit, et c'est justement ce
    // qu'on veut — les verrous sont ceux de la NOUVELLE référence.
    this.keySet = withRoom({ ...ownKeys(this.keySet), locked: [] }, proposed.byName);
    // Rien n'est rangé: `keepKeys` n'écrit que `mine`, et `mine` n'a pas bougé.
    // Écrire ici enverrait une requête de plus à chaque relecture, pour rien.
    this.keys = playingKeys(this.keySet);
  }

  /** Le contenu d'un profil, pour le publier. Rien si le nom ne dit rien. */
  keyProfileNamed(name: string): KeyProfile | null {
    return this.keySet.byName[name] ?? null;
  }

  /** Oublie celui-là. Le dernier ne s'oublie pas: voir `removed`. */
  forgetKeys(name: string): void {
    this.capture = null;
    this.keySet = removed(this.keySet, name);
    this.keys = playingKeys(this.keySet);
    keepKeys(this.keySet);
  }

  resetKeys(): void {
    this.capture = null;
    this.forkIfLocked();
    this.keys = { ...DEFAULT_KEYS };
    this.keySet = edited(this.keySet, this.keys);
    keepKeys(this.keySet);
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
  /** Toutes les manettes branchées. */
  private connected(): Gamepad[] {
    const found = navigator.getGamepads?.() ?? [];
    return [...found].filter((pad): pad is Gamepad => pad !== null);
  }

  /** Le profil d'une manette, lu une fois puis retenu. */
  private profileFor(id: string): PadProfile | null {
    if (!this.profiles.has(id)) this.profiles.set(id, this.loadProfile(id));
    return this.profiles.get(id) ?? null;
  }

  /** Ce que disent TOUTES les manettes, fondu en une lecture, ou rien s'il n'y
   * en a aucune.
   *
   * Toutes et pas une seule, et c'est le coeur du sujet: un adaptateur GameCube
   * expose quatre manettes au navigateur, une par port, même avec un seul pad
   * branché dessus. Lire `connected[0]` rendait la manette morte trois fois sur
   * quatre. Et comme cette page tient UNE place, peu importe laquelle bouge:
   * c'est le même joueur.
   *
   * Conséquence voulue: il n'y a plus rien à choisir pour jouer. Le choix qui
   * reste, dans l'écran des touches, ne sert qu'à dire laquelle on CONFIGURE.
   */
  private padsReading(): PadReading | null {
    let reading: PadReading | null = null;
    for (const pad of this.connected()) {
      const one = readPad(pad, this.profileFor(pad.id));
      reading = reading === null ? one : merge(reading, one);
    }
    return reading;
  }

  /** Ce que disent toutes les manettes du MÊME modèle que celle qu'on
   * configure, en valeurs brutes.
   *
   * Pour l'apprentissage et la réassignation. Même raison: le pad est peut-être
   * dans le troisième port de l'adaptateur, et demander « appuie sur A » à un
   * port vide est une leçon qu'on ne peut pas finir. Du même modèle seulement,
   * parce que fondre les boutons d'une manette Xbox et d'une GameCube
   * apprendrait n'importe quoi.
   */
  private lessonSnapshot(like: Gamepad): Snapshot {
    let merged: Snapshot | null = null;
    for (const pad of this.connected()) {
      if (pad.id !== like.id) continue;
      const one = snapshot(pad);
      merged = merged === null ? one : loudest(merged, one);
    }
    return merged ?? snapshot(like);
  }

  private current(): Gamepad | null {
    const found = navigator.getGamepads?.() ?? [];
    const connected = [...found].filter((pad): pad is Gamepad => pad !== null);
    if (this.chosen !== null) {
      const wanted = connected.find((pad) => pad.index === this.chosen);
      if (wanted) return wanted;
    }
    return connected[0] ?? null;
  }

  /** Dit quelle console tourne, pour que les questions parlent d'elle. */
  playing(console: string): void {
    this.console = console;
  }

  beginLesson(): void {
    const pad = this.current();
    if (!pad) return;
    this.lesson = new Lesson(pad.id, snapshot(pad), this.console, this.pad);
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
      const bytes = new Uint8Array(event.data);
      // L'aller-retour d'abord: c'est le seul message dont l'exactitude dépend
      // du moment où on le lit.
      const ticket = readEcho(bytes);
      if (ticket !== null) {
        const at = this.sentAt.get(ticket);
        if (at !== undefined) {
          this.sentAt.delete(ticket);
          this.trips.push(performance.now() - at);
        }
        return;
      }
      // La vibration ensuite: elle est plus courte, plus fréquente, et elle ne
      // touche à rien de l'état de la salle.
      const shake = readShake(bytes);
      if (shake !== null) {
        this.shake(shake);
        return;
      }
      const told = readRoomMessage(bytes);
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
      this.deciding = told.deciding;
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
      // Et une page qui regarde ne redemande rien du tout. Deuxième verrou sur
      // la même porte: `watchOnly` ferme la socket en changeant de génération,
      // donc ce gestionnaire est déjà obsolète quand il s'exécute. Celui-ci
      // couvre le jour où une socket se ferme d'elle-même pendant qu'on regarde.
      if (this.watching) return;

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
    // Un champ de texte gagne toujours, et AVANT la réassignation: on y écrit un
    // pseudo ou un nom de profil, et les lettres qu'on tape sont justement
    // celles qui pilotent la manette. Sans cette ligne, `preventDefault` plus
    // bas empêchait d'écrire un `a` ou un `s` dans n'importe quel champ de la
    // page — le pseudo du salon compris, depuis le début.
    if (typingIn(event.target)) return;
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

  // PAS de garde ici, et l'asymétrie est voulue: relâcher ne fait jamais que
  // libérer. Une touche enfoncée dans le jeu puis relâchée après un clic dans un
  // champ doit sortir de la liste, sinon elle y reste appuyée pour toujours.
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
    // Une entrée par MODÈLE et non par branchement. Un adaptateur GameCube en
    // expose quatre, toutes du même nom, et elles partagent forcément une seule
    // configuration puisque le profil est rangé par identifiant. En afficher
    // quatre laissait croire qu'il y avait quatre choses à régler.
    const seen = new Set<string>();
    this.pads = [...found]
      .filter((candidate): candidate is Gamepad => candidate !== null)
      .filter((candidate) => !seen.has(candidate.id) && seen.add(candidate.id) !== undefined)
      .map((candidate) => ({
        index: candidate.index,
        id: candidate.id,
        buttons: candidate.buttons.length,
        axes: candidate.axes.length,
      }));
    const pad = this.current();
    if (pad) {
      this.padId = pad.id;
      this.padLayout = pad.mapping === "standard" ? "standard" : "unknown";
      // Learning happens whether or not this page holds a controller, and the
      // presses that answer the questions never reach the game.
      if (this.lesson !== null && !this.lesson.done) {
        this.lesson.feed(this.lessonSnapshot(pad));
        if (this.lesson.done) {
          this.keepProfile(pad.id, this.lesson.learned());
          this.onSettled();
        }
        return;
      }
      this.profile = this.profileFor(pad.id);
      // Une réassignation de manette en cours: on regarde ce qui bouge, et rien
      // ne part au jeu tant qu'on n'a pas fini.
      if (this.capture?.machine) {
        const moved = this.capture.machine.feed(this.lessonSnapshot(pad));
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
      // La MANETTE seulement, jamais le clavier.
      //
      // Le menu écoute déjà `keydown` lui-même, et le navigateur lui donne la
      // répétition du système. Lire aussi le clavier ici faisait deux chemins
      // pour une touche: une flèche droite avançait de deux crans, ce qui
      // ressemblait à un menu nerveux et était une addition.
      const fromPads = this.padsReading();
      if (fromPads !== null) {
        const action = this.menuPad.feed(fromPads, performance.now());
        if (action !== null) this.menu(action);
      }
      this.sendNeutral();
      return;
    }

    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN || this.port === null) {
      return;
    }

    // The keyboard first, then the pad on top of it: a stick at rest must not
    // cancel a key being held.
    let reading: PadReading = readKeys(this.held, this.keys);
    const fromPads = this.padsReading();
    if (fromPads !== null) reading = merge(reading, fromPads);
    // Et les doigts par-dessus, par la même fusion que les deux autres sources.
    // La décision D3 normalise les manettes ici, donc le worker ne saura jamais
    // qu'un joueur tient un téléphone.
    const fromTouch = this.touch.reading();
    if (fromTouch !== null) reading = merge(reading, fromTouch);
    this.lastReading = reading;
    this.socket.send(encodePad(this.port, reading));
    this.sent += 1;
  };

  /** La manette à l'écran, écrite par les doigts et lue par la boucle.
   *
   * Publique parce que c'est la page qui dessine les boutons et reçoit les
   * événements de pointeur. Un objet mutable plutôt qu'un état React: cette
   * boucle tourne cent fois par seconde, et la faire dépendre d'un rendu
   * remettrait React sur le chemin des commandes.
   */
  readonly touch = new Touch();

  /**
   * Fait vibrer ce qu'on tient: une manette, ou le téléphone.
   *
   * Deux chemins parce qu'il n'y a pas d'API commune. Une manette branchée a un
   * `vibrationActuator`; un téléphone n'en a pas et répond à `navigator.vibrate`.
   * On essaie les deux et on ignore les refus: un navigateur qui ne sait pas
   * vibrer doit laisser jouer, pas se plaindre.
   *
   * La durée est courte et REDEMANDÉE à chaque changement, plutôt qu'une longue
   * secousse qu'on arrêterait. Une vibration qu'on oublie d'arrêter est une
   * manette qui tremble jusqu'à ce qu'on la débranche, et le tube ne promet pas
   * qu'un zéro arrivera toujours.
   */
  private shake({ port, strength }: Shake): void {
    if (port !== this.port) return;
    this.shakes += 1;
    if (strength <= 0) {
      this.stopShaking();
      return;
    }
    const pad = this.connected().find((one) => one.vibrationActuator);
    const actuator = pad?.vibrationActuator;
    if (actuator) {
      void actuator
        .playEffect("dual-rumble", {
          duration: SHAKE_MS,
          strongMagnitude: strength,
          weakMagnitude: strength * 0.6,
        })
        .catch(() => {
          // Un navigateur qui refuse laisse jouer.
        });
      return;
    }
    try {
      navigator.vibrate?.(Math.round(SHAKE_MS * strength));
    } catch {
      // Idem: la vibration est un supplément, jamais une condition.
    }
  }

  /** Arrête tout de suite, quand la force retombe à zéro. */
  private stopShaking(): void {
    for (const pad of this.connected()) {
      void pad.vibrationActuator?.reset?.().catch(() => {});
    }
    try {
      navigator.vibrate?.(0);
    } catch {
      /* voir au-dessus */
    }
  }

  /** Combien de secousses sont arrivées. Pour les pilotes. */
  shakesFelt(): number {
    return this.shakes;
  }

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
  /** Un profil de la salle ne se modifie pas: on part d'une copie à soi.
   *
   * Bifurquer plutôt que refuser. Refuser voudrait dire une touche pressée qui
   * ne fait rien, et rien à l'écran pour dire pourquoi; bifurquer garde le
   * geste, garde la référence intacte, et se VOIT — le profil actif change de
   * nom sous les yeux de la personne.
   *
   * Le nom dérive de celui de la salle, avec un compteur si besoin: deux
   * bifurcations depuis la même référence ne doivent pas s'écraser.
   */
  private forkIfLocked(): void {
    if (!this.keySet.locked.includes(this.keySet.active)) return;
    const from = this.keySet.active.startsWith(ROOM_MARK)
      ? this.keySet.active.slice(ROOM_MARK.length)
      : this.keySet.active;
    for (let n = 0; n < 50; n += 1) {
      const wanted = n === 0 ? `${from} (à moi)` : `${from} (à moi ${n + 1})`;
      const after = added(this.keySet, wanted);
      if (after !== this.keySet) {
        this.keySet = after;
        this.keys = playingKeys(this.keySet);
        return;
      }
    }
  }

  private bindKey(code: string, key: ControlKey): void {
    this.forkIfLocked();
    const action = actionFor(key);
    const keys: KeyProfile = {};
    for (const [existing, what] of Object.entries(this.keys)) {
      if (existing !== code && !sameAction(what, action)) keys[existing] = what;
    }
    keys[code] = action;
    this.keys = keys;
    this.keySet = edited(this.keySet, keys);
    keepKeys(this.keySet);
  }

  private forgetProfile(id: string): void {
    // Le cache d'abord, et ce n'est pas un détail: sans cette ligne, « remettre
    // la manette d'origine » effaçait le profil du disque et la boucle le
    // relisait de la mémoire au tic suivant. Le bouton n'aurait rien fait.
    this.profiles.delete(id);
    try {
      localStorage.removeItem(`${PAD_PREFIX}${id}`);
      pushBindings();
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
    this.profiles.set(id, profile);
    try {
      localStorage.setItem(`${PAD_PREFIX}${id}`, JSON.stringify(profile));
      pushBindings();
    } catch {
      // Private browsing. The profile still works for this session.
    }
  }

  private loadProfile(id: string): PadProfile | null {
    try {
      const saved = localStorage.getItem(`${PAD_PREFIX}${id}`);
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

/** Tout ce qui est rangé, toutes manettes confondues.
 *
 * Relu à chaque fois plutôt que gardé en mémoire: écrire ne touche qu'UN profil,
 * et garder une copie du dossier ferait qu'un réglage semé par le service ou par
 * un autre onglet serait écrasé au prochain bouton réassigné.
 */
/** Les profils nommés et celui qui joue: ceux de la personne, plus ceux de la
 * salle par-dessus, verrouillés.
 *
 * La référence vient du CACHE et pas du réseau: cette fonction est appelée quand
 * la boucle d'entrée se construit, et elle ne peut pas attendre une requête. La
 * copie est rafraîchie ailleurs, quand la requête aboutit.
 */
function loadKeys(): KeySet {
  let own = fresh();
  try {
    const found = localStorage.getItem(KEYS_STORED);
    if (found) own = readKeySet(JSON.parse(found));
  } catch {
    // Un dossier illisible est un dossier qu'on remplace, pas une page qui
    // refuse de démarrer.
  }
  const proposed = readKeySet(roomReference().keys);
  return withRoom(own, proposed.byName);
}

function keepKeys(set: KeySet): void {
  try {
    // `mine` et pas `set`: ce qui est rangé ne contient JAMAIS un profil de la
    // salle. Sinon il deviendrait une copie personnelle, donc modifiable, donc
    // perdable, et figée au jour de la copie.
    localStorage.setItem(KEYS_STORED, JSON.stringify(ownKeys(set)));
    pushBindings();
  } catch {
    /* navigation privée */
  }
}
