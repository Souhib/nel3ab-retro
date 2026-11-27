/**
 * Une session arrêtée reste arrêtée.
 *
 * Le 26 novembre 2026, la salle a compté deux pages qui écoutaient le son et
 * deux qui regardaient l'image, pour une seule page ouverte. La page venait de
 * reconstruire sa session en quittant « manette seule ». Dans le même instant,
 * un effet de `App.tsx` appelait encore `video.start()` et `setIdle(false)` sur
 * l'ancienne session, déjà arrêtée, et l'écoute du geste qui réveille le son
 * lui appartenait encore. L'ancienne session rouvrait ses flux, et le volume ne
 * réglait plus que la nouvelle : à 0 %, le son continuait. Sur le banc de
 * `etats-navigateur`, l'aller-retour laissait deux sockets d'image ouvertes.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { armerReveilDuSon } from "./reveil-son";
import { Session } from "./session";

type Fake = { url: string; closed: boolean };
const sockets: Fake[] = [];
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  binaryType = "";
  closed = false;
  onmessage: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }
  send() {}
  close() {
    this.closed = true;
  }
}

/** Ce que `SoundStream` appelle d'un contexte audio, et rien de plus. */
class FakeContext {
  state = "running";
  currentTime = 0;
  sampleRate = 48_000;
  destination = {};
  createGain() {
    return { gain: { value: 1, setTargetAtTime() {} }, connect() {} };
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(1) };
  }
  createBufferSource() {
    return { connect() {}, start() {} };
  }
  createMediaStreamDestination() {
    return { stream: {} };
  }
  async resume() {}
  async close() {
    this.state = "closed";
  }
}

const ouvertes = (chemin: string) =>
  sockets.filter((s) => s.url.endsWith(chemin) && !s.closed).length;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sockets.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal(
    "Audio",
    class {
      srcObject: unknown = null;
      setAttribute() {}
      play() {
        return Promise.resolve();
      }
      pause() {}
    },
  );
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function enMarche(): Promise<Session> {
  const session = new Session(document.createElement("canvas"), () => {}, 0.5, false);
  session.start();
  await session.sound.start();
  // La précondition, affirmée et non supposée : sans elle, l'essai ne
  // prouverait rien de ce que la suite referme.
  expect(ouvertes("/video")).toBe(1);
  expect(ouvertes("/sound")).toBe(1);
  return session;
}

it("une session arrêtée ne rouvre ni l'image ni le son, quoi qu'on lui demande ensuite", async () => {
  const ancienne = await enMarche();
  const reveil = armerReveilDuSon(ancienne.sound);
  ancienne.stop();
  expect(ouvertes("/video")).toBe(0);
  expect(ouvertes("/sound")).toBe(0);

  // Ce que la page faisait à l'ancienne session le 26 novembre, dans l'ordre.
  ancienne.video.start();
  ancienne.sound.setIdle(true);
  ancienne.sound.setIdle(false);
  window.dispatchEvent(new Event("click"));
  await ancienne.sound.start();
  ancienne.sound.setVolume(0.3);
  ancienne.relancerImage();
  vi.advanceTimersByTime(10_000);
  reveil();

  expect(ouvertes("/video")).toBe(0);
  expect(ouvertes("/sound")).toBe(0);
});

it("le jumeau : une session en marche reprend son image après une pause", async () => {
  const session = await enMarche();
  session.video.stop();
  expect(ouvertes("/video")).toBe(0);
  session.video.start();
  expect(ouvertes("/video")).toBe(1);
  session.sound.setIdle(true);
  expect(ouvertes("/sound")).toBe(0);
  session.sound.setIdle(false);
  expect(ouvertes("/sound")).toBe(1);
  session.stop();
});
