/**
 * Les signaux que la vidéo publie pour l'état de liaison (`liaison.ts`).
 *
 * Le 21 novembre 2026, la salle envoyait ses messages vides et plus aucune
 * image. `lastHeard` le savait, mais ne sortait pas du flux; `sinceArrivalMs`
 * ne comptait que les images passées par le décodeur. Ces essais tiennent la
 * séparation dont la règle a besoin: un message vide dit « la salle est là »,
 * jamais « une image est arrivée ».
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VideoStream } from "./video";

type FakeSocket = {
  onopen: () => void;
  onclose: () => void;
  onmessage: (event: { data: ArrayBuffer }) => void;
  close: ReturnType<typeof vi.fn>;
};
let sockets: FakeSocket[] = [];
let paint: FrameRequestCallback;
const last = () => sockets[sockets.length - 1] as FakeSocket;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sockets = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(8 * 8 * 4).fill(200) }),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    paint = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "WebSocket",
    class {
      static OPEN = 1;
      readyState = 1;
      send = vi.fn();
      close = vi.fn();
      constructor() {
        sockets.push(this as unknown as FakeSocket);
      }
    },
  );
  vi.stubGlobal(
    "VideoDecoder",
    class {
      decodeQueueSize = 0;
      configure = vi.fn();
      close = vi.fn();
      private callbacks: VideoDecoderInit;
      constructor(callbacks: VideoDecoderInit) {
        this.callbacks = callbacks;
      }
      decode(chunk: { timestamp: number }) {
        this.callbacks.output({
          timestamp: chunk.timestamp,
          displayWidth: 640,
          displayHeight: 480,
          close: vi.fn(),
        } as unknown as VideoFrame);
      }
    },
  );
  vi.stubGlobal("EncodedVideoChunk", function EncodedVideoChunk(this: object, init: object) {
    Object.assign(this, init);
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Une image-clé, comme la salle l'envoie, derrière son instant de capture. */
function image(): ArrayBuffer {
  const message = new Uint8Array(8 + 12);
  new DataView(message.buffer).setBigUint64(0, BigInt(Math.round(performance.now() * 1000)), true);
  message.set([0, 0, 1, 0x67, 0x42, 0, 0x1e, 0, 0, 1, 0x65, 1], 8);
  return message.buffer;
}

function images(count: number) {
  for (let i = 0; i < count; i++) {
    paint(performance.now());
    last().onmessage({ data: image() });
    vi.advanceTimersByTime(16);
  }
}

function ouverte(): VideoStream {
  const video = new VideoStream(document.createElement("canvas"), (p) => p);
  video.start();
  last().onopen();
  return video;
}

it("un message vide dit que la salle est là, pas qu'une image est arrivée", () => {
  const video = ouverte();
  images(60);
  // Trois secondes de messages vides, comme pendant le gel du 21 novembre.
  for (let i = 0; i < 6; i++) {
    vi.advanceTimersByTime(500);
    paint(performance.now());
    last().onmessage({ data: new ArrayBuffer(0) });
  }
  const stats = video.stats();
  expect(stats.sinceHeardMs).not.toBeNull();
  expect(stats.sinceHeardMs).toBeLessThan(100);
  expect(stats.sinceUnitMs).toBeGreaterThanOrEqual(3000);
  video.stop();
});

it("jumeau: une image fraîche rafraîchit les deux", () => {
  const video = ouverte();
  images(60);
  const stats = video.stats();
  expect(stats.sinceUnitMs).toBeLessThan(100);
  expect(stats.sinceHeardMs).toBeLessThan(100);
  expect(stats.units).toBe(60);
  video.stop();
});

it("compte les images qui arrivent même quand personne ne peint (onglet caché)", () => {
  const video = ouverte();
  images(10);
  // Plus de rafraîchissement: les images sont jetées avant le décodeur, mais
  // elles sont bien ARRIVÉES, et ce n'est pas un gel de la salle.
  vi.advanceTimersByTime(1000);
  for (let i = 0; i < 20; i++) last().onmessage({ data: image() });
  const stats = video.stats();
  expect(stats.units).toBe(30);
  expect(stats.sinceUnitMs).toBeLessThan(50);
  expect(stats.sinceArrivalMs).toBeGreaterThanOrEqual(1000);
  video.stop();
});

it("date la dernière image peinte, et rien avant la première", () => {
  const video = ouverte();
  expect(video.stats().sincePaintedMs).toBeNull();
  images(60);
  const peinte = video.stats();
  expect(peinte.painted).toBeGreaterThan(0);
  expect(peinte.sincePaintedMs).toBeLessThan(100);
  vi.advanceTimersByTime(2500);
  expect(video.stats().sincePaintedMs).toBeGreaterThanOrEqual(2500);
  video.stop();
});

it("dit depuis quand la vidéo est coupée, et depuis quand elle est ouverte", () => {
  const video = new VideoStream(document.createElement("canvas"), (p) => p);
  video.start();
  // Avant la première ouverture: on attend depuis le départ, pas depuis toujours.
  vi.advanceTimersByTime(800);
  expect(video.stats().downForMs).toBeGreaterThanOrEqual(800);
  expect(video.stats().downForMs).toBeLessThan(900);
  expect(video.stats().sinceStartedMs).toBeGreaterThanOrEqual(800);
  last().onopen();
  vi.advanceTimersByTime(300);
  expect(video.stats().downForMs).toBeNull();
  expect(video.stats().sinceOpenedMs).toBeGreaterThanOrEqual(300);
  last().onclose();
  vi.advanceTimersByTime(1200);
  expect(video.stats().downForMs).toBeGreaterThanOrEqual(1200);
  expect(video.stats().sinceOpenedMs).toBeNull();
  video.stop();
});

it("relancer l'image rouvre la seule socket vidéo, et garde l'heure de la dernière image", () => {
  const video = ouverte();
  images(30);
  vi.advanceTimersByTime(4000);
  const avant = sockets.length;
  const ancienne = last();
  video.relancer();
  expect(ancienne.close).toHaveBeenCalled();
  expect(sockets.length).toBe(avant + 1);
  expect(video.stats().connected).toBe(false);
  // La durée du gel ne repart pas de zéro: elle dit ce que la personne a vu.
  expect(video.stats().sinceUnitMs).toBeGreaterThanOrEqual(4000);
  last().onopen();
  expect(video.stats().connected).toBe(true);
  video.stop();
});

it("jumeau: relancer un flux arrêté ne rouvre rien", () => {
  const video = ouverte();
  video.stop();
  const avant = sockets.length;
  video.relancer();
  expect(sockets.length).toBe(avant);
});

it("réessayer une arrivée sans image lui rend toute son attente", () => {
  // Sans ça, « Réessayer » au bout de quinze secondes laissait l'écran dire
  // aussitôt « l'image n'arrive pas »: l'attente comptait depuis la toute
  // première tentative.
  const video = new VideoStream(document.createElement("canvas"), (p) => p);
  video.start();
  vi.advanceTimersByTime(16_000);
  video.relancer();
  expect(video.stats().sinceStartedMs).toBeLessThan(100);
  video.stop();
});

it("jumeau: relancer une image déjà peinte ne fait pas croire à une arrivée", () => {
  const video = ouverte();
  images(60);
  vi.advanceTimersByTime(5000);
  video.relancer();
  expect(video.stats().painted).toBeGreaterThan(0);
  expect(video.stats().sinceStartedMs).toBeGreaterThanOrEqual(5000);
  video.stop();
});
