import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VideoStream } from "./video";

let paint: FrameRequestCallback;
let socket: { onopen(): void; onmessage(event: { data: ArrayBuffer }): void };
const draw = vi.fn();
const released: number[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  draw.mockClear();
  released.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: draw,
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    paint = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ half: true }))),
  );
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
      close = vi.fn();
      private callbacks: VideoDecoderInit;
      constructor(callbacks: VideoDecoderInit) {
        this.callbacks = callbacks;
      }
      decode(chunk: { timestamp: number }) {
        this.callbacks.output({
          timestamp: chunk.timestamp,
          displayWidth: 1280,
          displayHeight: 720,
          close: () => released.push(chunk.timestamp / 1000),
        } as unknown as VideoFrame);
      }
    },
  );
  vi.stubGlobal("EncodedVideoChunk", function (this: object, init: object) {
    Object.assign(this, init);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function receive(captured: number) {
  const data = new Uint8Array(20);
  new DataView(data.buffer).setBigUint64(0, BigInt(captured * 1000), true);
  data.set([0, 0, 1, 0x67, 0x42, 0, 0x1e, 0, 0, 1, 0x65, 1], 8);
  socket.onmessage({ data: data.buffer });
}
function start() {
  const video = new VideoStream(document.createElement("canvas"), (p) => p);
  video.start();
  socket.onopen();
  paint(performance.now());
  receive(0);
  paint(performance.now());
  expect(draw).toHaveBeenCalledTimes(1);
  return video;
}
it("rattrape les images périmées après un blocage sans attendre de vider toute la file", () => {
  const video = start();
  vi.advanceTimersByTime(64);
  for (const time of [16, 32, 48, 96]) receive(time);
  paint(performance.now());
  expect(draw.mock.lastCall?.[0].timestamp).toBe(48_000);
  expect(video.stats().skipped).toBe(2);
  expect(released).toEqual([0, 16, 32, 48]);
  // The future frame stays owned until its actual display time or shutdown.
  expect(released).not.toContain(96);
  video.stop();
  expect(released).toEqual([0, 16, 32, 48, 96]);
});
it("garde chaque image d'un flux régulier et attend celles qui sont encore en avance", () => {
  const video = start();
  receive(16);
  paint(performance.now());
  expect(draw).toHaveBeenCalledTimes(1);
  for (const time of [16, 32, 48]) {
    if (time !== 16) receive(time);
    vi.advanceTimersByTime(16);
    paint(performance.now());
    expect(draw.mock.lastCall?.[0].timestamp).toBe(time * 1000);
  }
  expect(video.stats().skipped).toBe(0);
  expect(draw).toHaveBeenCalledTimes(4);
  video.stop();
});
