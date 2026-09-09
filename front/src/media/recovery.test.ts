import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { VideoStream } from "./video";

let socket: {
  onopen: () => void;
  onclose: () => void;
  onmessage: (event: { data: ArrayBuffer }) => void;
};
let paint: FrameRequestCallback;
let output = false;
let decodes = 0;
let queued = false;
const closes = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  output = false;
  queued = false;
  decodes = 0;
  closes.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
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
        socket = this as unknown as typeof socket;
      }
    },
  );
  vi.stubGlobal(
    "VideoDecoder",
    class {
      state = "configured";
      decodeQueueSize = 0;
      configure = vi.fn();
      close = closes;
      private callbacks: VideoDecoderInit;
      constructor(callbacks: VideoDecoderInit) {
        this.callbacks = callbacks;
      }
      decode(chunk: { timestamp: number }) {
        decodes++;
        if (queued) this.decodeQueueSize++;
        if (output)
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
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function feed(video: VideoStream, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    paint(performance.now());
    const message = new Uint8Array(8 + 12);
    new DataView(message.buffer).setBigUint64(
      0,
      BigInt(Math.round(performance.now() * 1000)),
      true,
    );
    message.set([0, 0, 1, 0x67, 0x42, 0, 0x1e, 0, 0, 1, 0x65, 1], 8);
    socket.onmessage({ data: message.buffer });
    vi.advanceTimersByTime(16);
  }
  expect(decodes).toBeGreaterThan(10);
  return video.stats();
}
it("redémarre un décodeur neuf qui reçoit sans jamais produire sa première image", () => {
  const video = new VideoStream(document.createElement("canvas"), (p) => p);
  video.start();
  socket.onopen();
  const stats = feed(video, 200);
  expect(stats.shown).toBe(0);
  expect(stats.restarts).toBeGreaterThan(0);
  expect(closes).toHaveBeenCalled();
  video.stop();
});
it("ne redémarre pas celui qui produit pendant la même durée", () => {
  output = true;
  const video = new VideoStream(document.createElement("canvas"), (p) => p);
  video.start();
  socket.onopen();
  const stats = feed(video, 200);
  expect(stats.shown).toBeGreaterThan(100);
  expect(stats.restarts).toBe(0);
  expect(closes).not.toHaveBeenCalled();
  video.stop();
});
it("un nouveau lancement réautorise le format réduit refusé sur le jeu précédent", () => {
  const video = new VideoStream(document.createElement("canvas"), (p) => p);
  Object.assign(video, { deniedHalf: true });
  expect(video.stats().halfDenied).toBe(true);
  video.expectRestart();
  expect(video.stats().halfDenied).toBe(false);
});

it("récupère aussi quand la file du décodeur sature et arrête les soumissions", () => {
  queued = true;
  const video = new VideoStream(document.createElement("canvas"), (p) => p);
  video.start();
  socket.onopen();
  const stats = feed(video, 200);
  expect(stats.undecoded).toBeGreaterThan(10);
  expect(stats.shown).toBe(0);
  expect(stats.restarts).toBeGreaterThan(0);
  video.stop();
});

it("relit la capacité du worker au retour du lien, même sans annonce du salon", async () => {
  const fetch = vi
    .fn()
    .mockImplementation(async () => new Response(JSON.stringify({ half: false })));
  vi.stubGlobal("fetch", fetch);
  const video = new VideoStream(document.createElement("canvas"), (p) => p);
  video.start();
  socket.onopen();
  await vi.advanceTimersByTimeAsync(1);
  expect(video.stats().halfDenied).toBe(true);
  fetch.mockImplementation(async () => new Response(JSON.stringify({ half: true })));
  socket.onclose();
  await vi.advanceTimersByTimeAsync(1500);
  socket.onopen();
  await vi.advanceTimersByTimeAsync(1);
  expect(video.stats().halfDenied).toBe(false);
  video.stop();
});
