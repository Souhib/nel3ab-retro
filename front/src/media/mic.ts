/**
 * Le micro d'un joueur, monté au worker pour être mêlé aux clips.
 *
 * Rien n'est rejoué: c'est du record only. La voix est captée, réduite en mono
 * i16 48 kHz, et envoyée en montant sur `/mic`. Le worker la date sur son
 * horloge de capture et la mélange au son du jeu au prochain clip.
 *
 * La réduction en mono et la conversion en entiers vivent dans un
 * `ScriptProcessorNode`. Il est déprécié, et il est pourtant le bon choix ici:
 * un AudioWorklet a besoin d'un module à charger, et la page est servie d'un
 * SEUL fichier, donc le module ne peut venir que d'un blob. Or un worklet
 * chargé d'un blob échoue à se charger (« a dependency or cross-origin script
 * failed to load », vu le 22 septembre 2026 sur la vraie salle). Le
 * ScriptProcessorNode se crée directement, sans module, et son coût sur le fil
 * principal est celui d'une conversion de 1024 échantillons toutes les 21 ms,
 * ce qui n'est rien. La réduction et le changement de cadence restent des
 * fonctions pures, partagées avec les tests.
 */

/** Combien de trames le fil de capture rend à la fois.
 *
 * 1024 à 48 kHz font 21 ms. À 4096, le navigateur rendait 85 ms d'un coup, en
 * huit morceaux envoyés ensemble, et le worker les datait tous au même instant
 * (revue du 23 septembre 2026). Le worker les remet bout à bout désormais, mais
 * des rafales plus courtes gardent sa datation près de ce qu'il constate. */
const PROCESSOR_FRAMES = 1024;

/** La cadence que le worker suppose pour la voix, celle du son du jeu. */
const MIC_RATE = 48_000;

/** Le premier délai avant de rouvrir une socket de micro tombée, puis le plus long. */
const RECONNECT_FIRST_MS = 500;
const RECONNECT_LONGEST_MS = 5000;

/** Combien de trames mono font un morceau envoyé. Dix millisecondes, comme le
 * son du jeu, pour que le worker reçoive les deux au même rythme. */
export const MIC_CHUNK_FRAMES = 480;

/** Réduit des canaux flottants en un mono i16, en saturant.
 *
 * La moyenne des canaux évite de garder une moitié de signal quand le matériel
 * rend du stéréo. La conversion sature à [-32767, 32767]: un écrêtage est un
 * son fort, un débordement silencieux est un craquement.
 *
 * Écrite comme une fonction ordinaire et pas seulement dans le fil de capture,
 * pour que le banc d'essai puisse la casser et l'éprouver sans navigateur.
 */
export function downmixToMono16(channels: Float32Array[], out: Int16Array): void {
  const frames = out.length;
  const count = channels.length;
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < count; channel += 1) sum += channels[channel][frame];
    const mixed = Math.max(-1, Math.min(1, sum / count));
    out[frame] = Math.round(mixed * 32767);
  }
}

/** Change la cadence d'une voix vers 48 kHz, par interpolation linéaire.
 *
 * Le contexte audio n'est plus forcé à 48 kHz: un contexte forcé à une autre
 * cadence que celle du périphérique échoue sur certains navigateurs (Firefox
 * refuse de brancher un micro à 44,1 kHz dans un contexte à 48 kHz), et le micro
 * restait « refusé » sans raison visible. La page garde la cadence du navigateur
 * et la convertit ici.
 *
 * L'état passe d'un tampon au suivant: la position du prochain échantillon et
 * le dernier échantillon reçu. Sans lui, chaque tampon repartirait de zéro et la
 * voix gagnerait un clic toutes les 21 ms. L'interpolation linéaire ne filtre
 * pas avant de réduire: un micro à 96 kHz replie un peu d'aigu au-dessus de
 * 24 kHz, inaudible pour une voix. */
export class Resampler {
  private readonly step: number;
  /** Où tombe le prochain échantillon de sortie, en échantillons d'entrée, à
   * partir du début du prochain tampon. -1 désigne le dernier du précédent. */
  private position = 0;
  private last = 0;

  constructor(from: number, to: number = MIC_RATE) {
    this.step = from / to;
  }

  push(input: Float32Array): Float32Array {
    const out: number[] = [];
    let position = this.position;
    while (position < input.length - 1) {
      const index = Math.floor(position);
      const before = index < 0 ? this.last : input[index];
      const after = input[index + 1];
      out.push(before + (after - before) * (position - index));
      position += this.step;
    }
    if (input.length > 0) {
      this.position = position - input.length;
      this.last = input[input.length - 1];
    }
    return Float32Array.from(out);
  }
}

/** Le délai avant la tentative suivante: il double, jusqu'à un plafond. */
export function nextReconnectDelay(previous: number | null): number {
  if (previous === null) return RECONNECT_FIRST_MS;
  return Math.min(previous * 2, RECONNECT_LONGEST_MS);
}

/** Où en est le micro de cette page. */
export type MicState = "off" | "asking" | "on" | "refused";

/** Un micro branché, tel que le navigateur le nomme. */
export type MicDevice = { id: string; label: string };

export class MicStream {
  private socket: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  /** Ce qui est arrivé du fil et n'a pas encore fait un morceau complet. */
  private pending = new Uint8Array(0);
  private state: MicState = "off";
  private deviceId: string | null = null;
  /** Le reçu avec lequel la socket actuelle a été ouverte. */
  private seat: string | null = null;
  /** Chaque `start` et chaque `stop` changent ce numéro. Une ouverture qui revient
   * d'une attente et le trouve changé sait qu'on ne veut plus d'elle. */
  private generation = 0;
  private retry: number | null = null;
  private retryDelay: number | null = null;
  private readonly url: (path: string) => string;
  private readonly receipt: () => string | null;

  /** `receipt` rend le reçu de place de la page au moment où on le demande: il
   * change quand la personne prend ou quitte une place, et la socket suit. */
  constructor(url: (path: string) => string, receipt: () => string | null = () => null) {
    this.url = url;
    this.receipt = receipt;
  }

  /** Les micros que le navigateur connaît, pour que chacun choisisse le sien.
   *
   * Le libellé peut être vide tant que la page n'a pas eu l'autorisation du
   * micro; on met alors un nom de secours plutôt qu'une ligne vide, qui se lit
   * comme un micro cassé. */
  async devices(): Promise<MicDevice[]> {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({
          id: device.deviceId,
          label: device.label || `micro ${index + 1}`,
        }));
    } catch {
      return [];
    }
  }

  /** Ouvre le micro choisi et commence à monter la voix. Rend vrai si ça marche.
   *
   * Tout ou rien: un refus laisse l'état sur `refused`, pour que l'écran dise
   * pourquoi plutôt que d'avoir l'air d'avoir échoué sans un mot. Changer de
   * micro pendant qu'on enregistre repart sur le nouveau sans que la personne
   * ait à couper puis rouvrir. */
  async start(deviceId: string | null = null): Promise<boolean> {
    if (this.state === "on" && deviceId === this.deviceId) return true;
    // Un clic pendant la demande ne relance rien: deux demandes de permission en
    // même temps finissent par se contredire.
    if (this.state === "asking") return false;
    if (this.state === "on" && deviceId !== this.deviceId) this.stop();
    this.generation += 1;
    const generation = this.generation;
    this.state = "asking";
    this.deviceId = deviceId;
    let stream: MediaStream;
    try {
      // Les traitements « confort » du navigateur sont coupés: ils changent la
      // voix selon ce qu'ils croient être de l'écho, et un clip doit garder ce
      // que la personne a dit, pas ce qu'un algorithme a jugé bon d'en garder.
      //
      // `ideal`, jamais `exact`: demander un micro PRÉCIS avant d'avoir
      // l'autorisation peut échouer en `OverconstrainedError` sans même montrer
      // la demande, et la page restait coincée sur « refusé ». `ideal` laisse le
      // navigateur retomber sur son micro par défaut et montre la demande.
      const device = deviceId === null ? {} : { deviceId: { ideal: deviceId } };
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...device,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch {
      if (generation !== this.generation) return false;
      // Oublier le micro demandé: si c'est lui qui a fait échouer, un nouvel
      // essai repart sur le défaut au lieu de rejouer le même refus.
      this.deviceId = null;
      this.state = "refused";
      return false;
    }
    // Coupé pendant la demande: la piste accordée entre-temps est rendue tout de
    // suite, sinon le navigateur affiche « en cours de capture » sur une page qui
    // a dit non (revue du 23 septembre 2026).
    if (generation !== this.generation) {
      for (const track of stream.getTracks()) track.stop();
      return false;
    }
    let context: AudioContext | null = null;
    try {
      // À la cadence du navigateur, convertie ensuite par `Resampler`. Puis
      // repris: le contexte est créé APRÈS l'autorisation, donc hors du geste qui
      // l'aurait réveillé, et un contexte suspendu n'appelle jamais
      // `onaudioprocess`. Le micro restait muet.
      context = new AudioContext();
      await context.resume();
      if (generation !== this.generation) throw new Error("coupé pendant l'ouverture");
      const source = context.createMediaStreamSource(stream);
      const resampler = new Resampler(context.sampleRate);
      // Un seul canal d'entrée: le navigateur réduit déjà en mono, donc la
      // moyenne de `downmixToMono16` ne divise rien. La sortie reste muette: on
      // n'écrit jamais dans le tampon, et le brancher au haut-parleur sert
      // seulement à ce que le navigateur continue d'appeler `onaudioprocess`.
      const processor = context.createScriptProcessor(PROCESSOR_FRAMES, 1, 1);
      processor.onaudioprocess = (event) => {
        const voice = resampler.push(event.inputBuffer.getChannelData(0));
        const out = new Int16Array(voice.length);
        downmixToMono16([voice], out);
        this.onPcm(out);
      };
      source.connect(processor);
      processor.connect(context.destination);
      this.stream = stream;
      this.context = context;
      this.processor = processor;
      this.connect();
      this.state = "on";
      return true;
    } catch {
      // Le micro a été accordé mais le fil n'a pas pu se monter. Rendre la piste
      // pour ne pas laisser le navigateur afficher « en cours de capture », et
      // fermer le contexte: chaque essai raté en laissait un ouvert.
      for (const track of stream.getTracks()) track.stop();
      void context?.close();
      if (generation !== this.generation) return false;
      this.deviceId = null;
      this.state = "refused";
      return false;
    }
  }

  private connect(): void {
    this.seat = this.receipt();
    const seat = this.seat === null ? "" : `?seat=${encodeURIComponent(this.seat)}`;
    const socket = new WebSocket(this.url(`/mic${seat}`));
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket === socket) this.retryDelay = null;
    };
    // Une socket tombée pendant que le micro est ouvert se rouvre, de plus en
    // plus lentement. Sans cela, un redémarrage du worker coupait la voix pour
    // le reste de la soirée alors que le badge restait allumé sur la page.
    socket.onclose = () => {
      if (this.socket !== socket || this.state !== "on") return;
      this.socket = null;
      this.retryDelay = nextReconnectDelay(this.retryDelay);
      this.retry = window.setTimeout(() => {
        this.retry = null;
        if (this.state === "on" && this.socket === null) this.connect();
      }, this.retryDelay);
    };
    socket.onerror = () => socket.close();
  }

  /** Rouvre la socket si la place de la page a changé depuis son ouverture.
   *
   * Le worker trouve la place d'une voix par le reçu donné à l'ouverture. Une
   * personne qui prend une place APRÈS avoir ouvert son micro gardait une voix
   * sans place, et son badge ne s'allumait jamais. */
  private followSeat(): void {
    const receipt = this.receipt();
    if (receipt === this.seat || this.socket === null) return;
    const old = this.socket;
    this.socket = null;
    old.close();
    this.connect();
  }

  /** Accumule la voix et n'envoie que des morceaux entiers. */
  private onPcm(pcm: Int16Array): void {
    this.followSeat();
    const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const joined = new Uint8Array(this.pending.length + bytes.length);
    joined.set(this.pending, 0);
    joined.set(bytes, this.pending.length);
    this.pending = joined;
    const chunk = MIC_CHUNK_FRAMES * 2;
    while (this.pending.length >= chunk) {
      const done = this.pending.slice(0, chunk);
      this.pending = this.pending.slice(chunk);
      this.send(done);
    }
  }

  private send(pcm: Uint8Array<ArrayBuffer>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(pcm);
    } catch {
      // Une socket qui refuse est fermée par `onclose`; on ne relance pas ici.
    }
  }

  stop(): void {
    this.generation += 1;
    this.state = "off";
    if (this.retry !== null) window.clearTimeout(this.retry);
    this.retry = null;
    this.retryDelay = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.processor?.disconnect();
    this.processor = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    void this.context?.close();
    this.context = null;
    this.pending = new Uint8Array(0);
  }

  status(): MicState {
    return this.state;
  }
}
