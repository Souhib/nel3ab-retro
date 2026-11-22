/**
 * Le son et la manette, comme témoins de l'état de liaison.
 *
 * Pendant le gel du 21 novembre 2026, le son continuait: c'est ce qui permet
 * de dire « le jeu tourne sur la machine » au lieu de supposer une cause. Ces
 * deux flux publient donc depuis quand ils ont entendu la salle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputStream } from "./input";
import { SoundStream } from "./sound";

type Fake = { onmessage: (event: { data: ArrayBuffer | string }) => void; url: string };
const sockets: Fake[] = [];
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  onmessage = (_event: { data: ArrayBuffer | string }) => {};
  onclose: (() => void) | null = null;
  binaryType = "";
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }
  send() {}
  close() {}
}

/** Un contexte audio réduit à ce que `SoundStream` appelle. Suspendu, comme
 * sur un iPhone qu'un appel vient d'interrompre. */
class FakeContext {
  state = "suspended";
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
  async close() {}
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sockets.length = 0;
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
  vi.stubGlobal("navigator", { getGamepads: () => [] });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const morceau = (octets: number) => new Uint8Array(octets).buffer;

describe("le son", () => {
  it("date le dernier morceau reçu, même quand le navigateur ne le joue pas", async () => {
    const sound = new SoundStream((p) => p, 0.5, false);
    expect(sound.stats().sinceChunkMs).toBeNull();
    await sound.start();
    const socket = sockets.find((s) => s.url === "/sound") as Fake;
    socket.onmessage({ data: morceau(8 + 3840) });
    vi.advanceTimersByTime(300);
    const vu = sound.stats().sinceChunkMs;
    expect(vu).toBeGreaterThanOrEqual(300);
    expect(vu).toBeLessThan(400);
    sound.stop();
  });

  it("jumeau: un message vide n'est pas du son", async () => {
    const sound = new SoundStream((p) => p, 0.5, false);
    await sound.start();
    const socket = sockets.find((s) => s.url === "/sound") as Fake;
    socket.onmessage({ data: morceau(8) });
    expect(sound.stats().sinceChunkMs).toBeNull();
    sound.stop();
  });
});

describe("la manette", () => {
  it("date le dernier message de la salle, et rien avant le premier", () => {
    const input = new InputStream(
      (p) => p,
      () => {},
      () => {},
    );
    input.start();
    // Une socket créée n'a encore rien dit: ce n'est pas un témoin.
    expect(input.state().sinceHeardMs).toBeNull();
    sockets[sockets.length - 1]?.onmessage({
      data: new Uint8Array([4, 1, 1, 0, 1, 0, 0, 0, 0]).buffer,
    });
    vi.advanceTimersByTime(700);
    const vu = input.state().sinceHeardMs;
    expect(vu).toBeGreaterThanOrEqual(700);
    expect(vu).toBeLessThan(800);
    input.stop();
  });
});
