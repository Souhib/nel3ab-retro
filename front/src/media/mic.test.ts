import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downmixToMono16, MIC_CHUNK_FRAMES, MicStream, nextReconnectDelay, Resampler } from "./mic";

describe("réduire un micro en mono i16", () => {
  it("moyenne les canaux et convertit en entiers", () => {
    const left = new Float32Array([0.5, -0.5]);
    const right = new Float32Array([0.5, -0.5]);
    const out = new Int16Array(2);
    downmixToMono16([left, right], out);
    expect(out[0]).toBe(Math.round(0.5 * 32767));
    expect(out[1]).toBe(Math.round(-0.5 * 32767));
  });

  it("un canal seul reste lui-même, sans diviser par deux", () => {
    const mono = new Float32Array([0.25, -0.25]);
    const out = new Int16Array(2);
    downmixToMono16([mono], out);
    expect(out[0]).toBe(Math.round(0.25 * 32767));
    expect(out[1]).toBe(Math.round(-0.25 * 32767));
  });

  it("sature au lieu de déborder", () => {
    const loud = new Float32Array([2.0, -2.0]);
    const out = new Int16Array(2);
    downmixToMono16([loud], out);
    expect(out[0]).toBe(32767);
    expect(out[1]).toBe(-32767);
  });

  it("remplit exactement la longueur demandée", () => {
    const channels = [new Float32Array(MIC_CHUNK_FRAMES).fill(0.1)];
    const out = new Int16Array(MIC_CHUNK_FRAMES);
    downmixToMono16(channels, out);
    expect(out.length).toBe(MIC_CHUNK_FRAMES);
  });
});

describe("ramener une voix à 48 kHz", () => {
  const second = (rate: number) =>
    Float32Array.from({ length: rate }, (_, at) => Math.sin((2 * Math.PI * 1000 * at) / rate));
  const crossings = (voice: Float32Array) => {
    let count = 0;
    for (let at = 1; at < voice.length; at += 1)
      if (voice[at - 1] < 0 !== voice[at] < 0) count += 1;
    return count;
  };

  it("une seconde à 44,1 kHz donne une seconde à 48 kHz, à la même hauteur", () => {
    const voice = new Resampler(44_100).push(second(44_100));
    expect(Math.abs(voice.length - 48_000)).toBeLessThanOrEqual(2);
    // 1 kHz traverse zéro deux mille fois par seconde. Sans conversion, le
    // worker lirait 44 100 échantillons comme 48 000 et la voix monterait.
    expect(Math.abs(crossings(voice) - 2000)).toBeLessThanOrEqual(2);
  });

  it("à la même cadence, la voix ressort telle quelle, décalée d'un échantillon", () => {
    const input = Float32Array.from([0.1, 0.2, 0.3, 0.4]);
    const resampler = new Resampler(48_000);
    const first = resampler.push(input);
    const next = resampler.push(Float32Array.from([0.5]));
    expect(Array.from(first)).toEqual(Array.from(input.subarray(0, 3)));
    expect(Array.from(next)).toEqual([input[3]]);
  });

  it("couper l'entrée en tampons ne change rien à la sortie", () => {
    // Le défaut qu'on veut voir: un état oublié entre deux tampons fait un clic
    // toutes les 21 ms, et un nombre d'échantillons qui dérive.
    const input = second(44_100);
    const whole = new Resampler(44_100).push(input);
    const chunked = new Resampler(44_100);
    const pieces: number[] = [];
    for (let at = 0; at < input.length; at += 1024)
      pieces.push(...chunked.push(input.subarray(at, at + 1024)));
    expect(pieces.length).toBe(whole.length);
    for (let at = 0; at < whole.length; at += 1) expect(pieces[at]).toBeCloseTo(whole[at], 6);
  });

  it("un tampon vide ne dérange pas l'état", () => {
    const voice = Float32Array.from([0.5, -0.25, 0.75]);
    const plain = new Resampler(44_100);
    const interrupted = new Resampler(44_100);
    plain.push(voice);
    interrupted.push(voice);
    expect(interrupted.push(new Float32Array(0)).length).toBe(0);
    expect(Array.from(interrupted.push(voice))).toEqual(Array.from(plain.push(voice)));
  });
});

describe("rouvrir la socket du micro", () => {
  it("attend de plus en plus, jusqu'au plafond", () => {
    expect(nextReconnectDelay(null)).toBe(500);
    expect(nextReconnectDelay(500)).toBe(1000);
    expect(nextReconnectDelay(4000)).toBe(5000);
    expect(nextReconnectDelay(5000)).toBe(5000);
  });
});

const sockets: FakeSocket[] = [];
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  binaryType = "";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  send = vi.fn();
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }
}

type Processor = { onaudioprocess: ((event: unknown) => void) | null };
const processors: Processor[] = [];
const contexts: { close: ReturnType<typeof vi.fn> }[] = [];
let contextRate = 48_000;
class FakeContext {
  sampleRate = contextRate;
  destination = {};
  close = vi.fn(async () => {});
  constructor() {
    contexts.push(this);
  }
  async resume() {}
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
  createScriptProcessor() {
    const processor = {
      onaudioprocess: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    processors.push(processor);
    return processor;
  }
}

function fakeTrack() {
  return { stop: vi.fn() };
}

/** Une demande de micro qui ne répond que quand l'essai le décide. */
function pendingPermission() {
  const track = fakeTrack();
  let grant: () => void = () => {};
  const asked = new Promise<MediaStream>((resolve) => {
    grant = () => resolve({ getTracks: () => [track] } as unknown as MediaStream);
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(() => asked) },
  });
  return { track, grant };
}

function speak() {
  const buffer = new Float32Array(1024).fill(0.1);
  processors.at(-1)!.onaudioprocess!({
    inputBuffer: { getChannelData: () => buffer },
  });
}

describe("le cycle de vie du micro", () => {
  beforeEach(() => {
    sockets.length = 0;
    processors.length = 0;
    contexts.length = 0;
    contextRate = 48_000;
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("AudioContext", FakeContext);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("couper pendant la demande rend la piste et n'ouvre rien", async () => {
    const { track, grant } = pendingPermission();
    const mic = new MicStream((path) => path);
    const started = mic.start();
    mic.stop();
    grant();
    expect(await started).toBe(false);
    expect(track.stop).toHaveBeenCalled();
    expect(mic.status()).toBe("off");
    expect(contexts).toHaveLength(0);
    expect(sockets).toHaveLength(0);
  });

  it("sans coupure, la même demande ouvre le micro et sa socket", async () => {
    const { track, grant } = pendingPermission();
    const mic = new MicStream((path) => path);
    const started = mic.start();
    grant();
    expect(await started).toBe(true);
    expect(track.stop).not.toHaveBeenCalled();
    expect(mic.status()).toBe("on");
    expect(sockets).toHaveLength(1);
  });

  it("un navigateur à 44,1 kHz envoie autant de voix qu'à 48 kHz", async () => {
    // 10 tampons de 1024 à 44,1 kHz font 232 ms, soit 11 146 échantillons à
    // 48 kHz et 23 morceaux de 480. Envoyés tels quels, ils en feraient 21, et
    // le worker les jouerait 9 % trop vite.
    contextRate = 44_100;
    const { grant } = pendingPermission();
    const mic = new MicStream((path) => path);
    const started = mic.start();
    grant();
    await started;
    for (let buffer = 0; buffer < 10; buffer += 1) speak();
    expect(sockets[0].send).toHaveBeenCalledTimes(23);
  });

  it("un navigateur à 48 kHz envoie sa voix sans la changer de taille", async () => {
    const { grant } = pendingPermission();
    const mic = new MicStream((path) => path);
    const started = mic.start();
    grant();
    await started;
    for (let buffer = 0; buffer < 10; buffer += 1) speak();
    // 10 240 échantillons, moins le dernier qui attend le tampon suivant.
    expect(sockets[0].send).toHaveBeenCalledTimes(21);
  });

  it("une socket tombée se rouvre, de plus en plus lentement", async () => {
    const { grant } = pendingPermission();
    const mic = new MicStream((path) => path);
    const started = mic.start();
    grant();
    await started;
    sockets[0].onclose!();
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1].onclose!();
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    // Ouverte, elle repart du premier délai.
    sockets[2].onopen!();
    sockets[2].onclose!();
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(4);
  });

  it("un micro coupé ne rouvre pas sa socket", async () => {
    const { grant } = pendingPermission();
    const mic = new MicStream((path) => path);
    const started = mic.start();
    grant();
    await started;
    const socket = sockets[0];
    mic.stop();
    socket.onclose!();
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(1);
  });

  it("prendre une place après avoir ouvert le micro rouvre la socket avec le reçu", async () => {
    const { grant } = pendingPermission();
    let receipt: string | null = null;
    const mic = new MicStream(
      (path) => path,
      () => receipt,
    );
    const started = mic.start();
    grant();
    await started;
    expect(sockets[0].url).toBe("/mic");
    speak();
    expect(sockets).toHaveLength(1);
    receipt = "abc-2";
    speak();
    expect(sockets).toHaveLength(2);
    expect(sockets[0].close).toHaveBeenCalled();
    expect(sockets[1].url).toBe("/mic?seat=abc-2");
    // L'ancienne socket qui finit de se fermer ne relance rien.
    sockets[0].onclose!();
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(2);
  });
});
