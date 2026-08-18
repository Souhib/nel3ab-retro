/**
 * The sound: raw PCM in, the audio hardware's own clock out.
 *
 * Chunks are SCHEDULED rather than played on arrival, each one after the last on
 * the hardware clock — the same reasoning as the picture's schedule, with a
 * cheaper clock.
 */
import { Window } from "./clock";

const RATE = 48000;
const CHANNELS = 2;

/** Every millisecond of this is a millisecond the sound is behind the picture,
 * so it starts small and is only bought back when the sound actually breaks. It
 * was a flat 40 ms, most of the 68 ms the two streams were first measured
 * apart. */
export const LEAD_MIN = 0.01;
/** Jusqu'où l'avance peut monter, en secondes.
 *
 * Quatre cents millisecondes. C'était cent vingt, et cent vingt ne suffit pas à
 * un iPhone: relevé sur un vrai téléphone le 18 août 2026, l'avance restait
 * COLLÉE au plafond avec huit trous par fenêtre de dix secondes, pendant qu'une
 * page saine tenait à dix millisecondes sans un seul trou. Une avance au plafond
 * qui prend encore des trous est une avance trop basse, par définition.
 *
 * Le plafond ne coûte rien à qui n'en a pas besoin: l'avance ne monte que sur un
 * trou et redescend d'une milliseconde à chaque fenêtre tranquille. Un
 * ordinateur reste donc à dix. Ce qu'il achète est le cas où le matériel demande
 * plus que ce qu'on lui accordait, et où le son n'arrivait alors jamais à temps.
 */
export const LEAD_MAX = 0.4;

/** Past this the schedule has drifted so far behind that catching up chunk by
 * chunk would take longer than starting again.
 *
 * # Tiré de l'avance maximale, et non écrit à côté
 *
 * Les deux nombres sont LIÉS, et l'ignorer a rendu un téléphone complètement
 * muet pendant une heure le 18 août 2026. En montant l'avance maximale à quatre
 * cents millisecondes sans regarder ce seuil, resté à deux cent cinquante, j'ai
 * fabriqué une boucle: réancrer pose l'horaire à `maintenant + avance`, ce qui
 * dépasse aussitôt le seuil, donc le morceau suivant réancre à son tour. Le
 * journal du téléphone l'a dit sans ambiguïté: **mille un trous pour mille
 * morceaux**, c'est-à-dire pas un seul morceau joué.
 *
 * Le seuil est donc CALCULÉ à partir de l'avance, avec une marge. Deux nombres
 * qui doivent s'accorder et rien qui les accorde finissent toujours par
 * diverger, et ce dépôt le savait déjà pour les manettes et pour la file
 * d'images.
 */
export const RESYNC = LEAD_MAX + 0.1;

export type SoundStats = {
  state: string;
  /** Ce qu'est devenu le silence qui débloque iOS, et le volume RÉELLEMENT
   * appliqué. Les deux sont là parce qu'un son absent sur un téléphone a
   * plusieurs causes qui se ressemblent toutes, et qu'aucune ne se distingue
   * sans les regarder. */
  unlocked: string;
  gain: number;
  /** Ce que le matériel ajoute après qu'on lui a donné les échantillons, en
   * millisecondes. Zéro quand le navigateur ne le dit pas, ce qui est le cas de
   * WebKit. */
  output: number;
  chunks: number;
  gaps: number;
  playedSeconds: number;
  leadMs: number;
  sampleRate: number;
  outputMs: number;
  browserMs: number;
  fastestLag: number | null;
};

export class SoundStream {
  private socket: WebSocket | null = null;
  private context: AudioContext | null = null;
  /** Le silence qui déplace la session audio hors du canal de la sonnerie.
   *
   * Gardé, et en boucle: iOS remet la session sur la sonnerie dès que plus rien
   * ne joue, et le son de la partie repartirait dans le vide au premier blanc. */
  private silence: HTMLAudioElement | null = null;
  /** Ce qu'est devenu le silence de déblocage. Rapporté au journal. */
  private unlocked = "pas essayé";
  private gain: GainNode | null = null;
  private playAt = 0;
  private lead = LEAD_MIN;
  private gapsSeen = 0;
  private chunks = 0;
  private gaps = 0;
  private played = 0;
  private readonly lags = new Window(240);
  private volume: number;
  private deviceRate: boolean;
  private readonly url: (path: string) => string;
  private trimmer: number | null = null;

  constructor(url: (path: string) => string, volume: number, deviceRate: boolean) {
    this.url = url;
    this.volume = volume;
    this.deviceRate = deviceRate;
  }

  /** Builds the context, in whichever of the two shapes is asked for.
   *
   * Forcing 48 kHz puts one resampler across everything the context plays, and
   * the browser runs it continuously. Taking the device's own rate removes that
   * stage but resamples every buffer on its own — a hundred resampler boundaries
   * a second, which no machine here can judge by ear. So the page offers both.
   *
   * Neither touches the output path: 32 ms on the build machine, 48 on the
   * player's, which is the audio device's own buffers and no page's business. */
  private build(): void {
    const previous = this.context;
    this.context = this.deviceRate
      ? new AudioContext({ latencyHint: 0.01 })
      : new AudioContext({ sampleRate: RATE, latencyHint: 0.01 });
    this.gain = this.context.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.context.destination);
    this.playAt = 0;
    this.gaps = 0;
    this.gapsSeen = 0;
    this.lead = LEAD_MIN;
    this.lags.clear();
    void previous?.close();
  }

  /** A browser plays nothing before somebody has asked it to.
   *
   * # Sur un iPhone, il ne suffit pas de demander
   *
   * Safari sur iOS ajoute deux règles que personne d'autre n'applique, et les
   * deux donnent exactement le même symptôme: aucun son, aucune erreur.
   *
   * **La première**: un contexte audio doit être créé ET repris pendant le geste
   * lui-même. C'est déjà le cas ici, puisque cette fonction est appelée depuis
   * un gestionnaire d'événement.
   *
   * **La seconde**: le son de Web Audio passe par le canal de la SONNERIE, celui
   * que coupe le petit interrupteur sur le côté du téléphone. Un iPhone en mode
   * silencieux ne joue donc rien, même quand tout le reste est correct. Jouer un
   * élément média fait basculer la session audio vers le canal « lecture », que
   * l'interrupteur ne coupe pas. D'où le silence de cinquante millisecondes
   * joué ci-dessous: il ne s'entend pas, et il déplace tout le reste.
   *
   * On joue aussi un tampon vide À TRAVERS le contexte, ce qui est la façon
   * reconnue de le débloquer sur iOS: un contexte repris sans qu'on lui ait rien
   * fait jouer y reste parfois suspendu.
   */
  async start(): Promise<void> {
    if (this.context === null) {
      this.build();
      this.connect();
      this.trimmer = window.setInterval(() => this.trim(), 2000);
    }
    this.unlock();
    await this.context?.resume();
  }

  /** Vrai quand le contexte joue vraiment.
   *
   * Ce que `start` a demandé n'est pas ce que le navigateur a accordé, et sur
   * iOS la différence est fréquente. C'est ce que la page regarde pour savoir
   * s'il faut réessayer au geste suivant.
   */
  running(): boolean {
    return this.context?.state === "running";
  }

  /** Les deux gestes qui débloquent le son sur iOS. Sans effet ailleurs. */
  private unlock(): void {
    const context = this.context;
    if (context !== null) {
      // Un tampon d'un seul échantillon, joué et oublié.
      try {
        const empty = context.createBuffer(1, 1, context.sampleRate);
        const source = context.createBufferSource();
        source.buffer = empty;
        source.connect(context.destination);
        source.start(0);
      } catch {
        // Un navigateur qui refuse laisse jouer le reste.
      }
    }
    if (this.silence === null) {
      this.silence = new Audio(silentWav());
      this.silence.loop = true;
      // `playsinline` pour qu'iOS ne passe pas en plein écran sur un média.
      this.silence.setAttribute("playsinline", "");
    }
    void this.silence
      .play()
      .then(() => {
        this.unlocked = "joue";
      })
      .catch((refusal: unknown) => {
        // Refusé hors d'un geste, ou refusé tout court. On le NOTE au lieu de
        // l'avaler: sur un iPhone, ce silence est justement ce qui déplace le
        // son hors du canal de la sonnerie, donc son échec explique tout le
        // reste. L'avaler laissait chercher ailleurs pendant une soirée.
        this.unlocked = `refusé: ${String(refusal).slice(0, 60)}`;
      });
  }

  stop(): void {
    this.silence?.pause();
    this.silence = null;
    if (this.trimmer !== null) window.clearInterval(this.trimmer);
    this.socket?.close();
    this.socket = null;
    void this.context?.close();
    this.context = null;
  }

  setVolume(volume: number): void {
    this.volume = volume;
    // A ramp rather than a jump: changing a gain instantly puts a step in the
    // waveform, which is heard as a click.
    if (this.gain !== null && this.context !== null) {
      this.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.01);
    }
  }

  setDeviceRate(deviceRate: boolean): void {
    this.deviceRate = deviceRate;
    if (this.context === null) return;
    this.build();
    void this.context.resume();
  }

  /** How far the sound is behind the picture: its longer path, plus the lead
   * this page schedules with, plus what the hardware adds after we hand it the
   * samples. */
  gapAgainst(pictureLag: number | null): number | null {
    const ours = this.lags.fastest();
    if (ours === null || pictureLag === null) return null;
    return ours - pictureLag + (this.context?.outputLatency ?? 0) * 1000 + this.lead * 1000;
  }

  stats(): SoundStats {
    return {
      state: this.context?.state ?? "coupé",
      unlocked: this.unlocked,
      gain: this.volumeNow(),
      output: (this.context?.outputLatency ?? 0) * 1000,
      chunks: this.chunks,
      gaps: this.gaps,
      playedSeconds: this.played,
      leadMs: this.lead * 1000,
      sampleRate: this.context?.sampleRate ?? 0,
      outputMs: (this.context?.outputLatency ?? 0) * 1000,
      browserMs: (this.context?.baseLatency ?? 0) * 1000,
      fastestLag: this.lags.fastest(),
    };
  }

  private connect(): void {
    const socket = new WebSocket(this.url("/sound"));
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onmessage = (event) => this.onChunk(event);
    socket.onclose = () => {
      if (this.socket === socket) window.setTimeout(() => this.connect(), 500);
    };
    socket.onerror = () => socket.close();
  }

  private onChunk(event: MessageEvent<ArrayBuffer>): void {
    const context = this.context;
    if (context === null || context.state !== "running" || this.gain === null) return;
    const message = new Uint8Array(event.data);
    if (message.length <= 8) return; // a keep-alive, carrying no sound

    const capturedMs = Number(new DataView(event.data).getBigUint64(0, true)) / 1000;
    this.lags.push(performance.now() - capturedMs);

    const pcm = new Int16Array(event.data, 8);
    const frames = pcm.length / CHANNELS;
    const buffer = context.createBuffer(CHANNELS, frames, RATE);
    for (let channel = 0; channel < CHANNELS; channel++) {
      const target = buffer.getChannelData(channel);
      for (let frame = 0; frame < frames; frame++) {
        target[frame] = pcm[frame * CHANNELS + channel] / 32768;
      }
    }

    const now = context.currentTime;
    if (this.playAt < now + 0.002 || this.playAt > now + RESYNC) {
      // Either we fell behind the hardware clock or ran so far ahead the sound
      // would arrive late enough to be wrong. Both are fixed the same way.
      if (this.playAt !== 0) {
        this.gaps += 1;
        this.lead = Math.min(LEAD_MAX, this.lead + 0.01);
      }
      this.playAt = now + this.lead;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.start(this.playAt);
    this.playAt += frames / RATE;
    // Counted in SECONDS rather than chunks: the length of a chunk is an
    // implementation detail, and a test that counted them broke the day they
    // were halved while the behaviour it checked never changed.
    this.played += frames / RATE;
    this.chunks += 1;
  }

  /**
   * Un bip franc, pour savoir de quel côté chercher.
   *
   * # Pourquoi un bouton qui fait du bruit vaut mieux qu'une analyse
   *
   * Sur un iPhone, un son absent a deux causes qu'aucun chiffre ne distingue: le
   * flux qui n'arrive pas à l'heure, ou la session audio du téléphone qui coupe
   * tout — l'interrupteur sur le côté, une autre application qui a pris la
   * parole, un appel. Dans les deux cas la page dit `running`, compte ses
   * morceaux, et n'a rien d'autre à raconter.
   *
   * Ce bip passe par le MÊME contexte et le MÊME gain que le jeu. S'il s'entend,
   * la sortie fonctionne et le problème est dans notre flux. S'il ne s'entend
   * pas alors que l'état est `running`, c'est le téléphone, et aucune ligne de
   * code n'y changera rien.
   *
   * Une question fermée à la place d'une conversation.
   */
  beep(): void {
    const context = this.context;
    if (context === null || this.gain === null) return;
    const tone = context.createOscillator();
    const shape = context.createGain();
    tone.frequency.value = 660;
    // Une montée et une descente douces: un créneau qui démarre à plein donne un
    // claquement, et on ne saurait pas si on a entendu le bip ou le claquement.
    const now = context.currentTime;
    shape.gain.setValueAtTime(0, now);
    shape.gain.linearRampToValueAtTime(0.4, now + 0.02);
    shape.gain.setValueAtTime(0.4, now + 0.18);
    shape.gain.linearRampToValueAtTime(0, now + 0.22);
    tone.connect(shape);
    shape.connect(this.gain);
    tone.start(now);
    tone.stop(now + 0.24);
  }

  /** Le volume appliqué en ce moment.
   *
   * Lu sur le noeud de gain et non sur ce qu'on lui a demandé: c'est ce que
   * l'oreille entend, et c'est ce qu'un pilote doit vérifier quand il teste une
   * glissière qui s'applique en bougeant.
   */
  volumeNow(): number {
    return this.gain?.gain.value ?? this.volume;
  }

  /** The lead comes back down when nothing has broken. Growing it is what a
   * break costs; keeping it is what the sound costs against the picture, for
   * ever. */
  private trim(): void {
    if (this.gaps === this.gapsSeen && this.lead > LEAD_MIN) {
      this.lead = Math.max(LEAD_MIN, this.lead - 0.001);
    }
    this.gapsSeen = this.gaps;
  }
}

/**
 * Cinquante millisecondes de silence, en WAV, sous forme d'adresse de données.
 *
 * Fabriqué plutôt que collé en base64: une chaîne de trois cents caractères
 * illisibles ne dit pas ce qu'elle contient, et personne ne peut vérifier qu'elle
 * est bien silencieuse. Ici chaque champ de l'en-tête est nommé.
 *
 * Huit bits non signés, donc le silence vaut 128 et non zéro. Un zéro donnerait
 * un créneau à fond, ce qui serait un réveil brutal pour un morceau censé ne pas
 * s'entendre.
 */
export function silentWav(): string {
  const rate = 8000;
  const samples = rate / 20;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const put = (at: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      bytes[at + index] = text.charCodeAt(index);
    }
  };
  put(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  put(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(128, 44);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}
