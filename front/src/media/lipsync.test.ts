import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Session } from "./session";
import { SoundStream } from "./sound";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

function sessionAt(videoOffset: number) {
  const session = new Session(document.createElement("canvas"), vi.fn(), 0.5, false);
  Object.assign(session.video, { offset: videoOffset, connected: true, priming: false });
  const lag = (session.video as unknown as { lags: { push: (n: number) => void } }).lags;
  lag.push(1000);
  return session;
}

it("soustrait le tampon déjà appliqué à la vidéo et ne double pas la compensation", () => {
  const session = sessionAt(1080);
  vi.spyOn(session.sound, "gapAgainst").mockImplementation((picture) =>
    picture === null ? null : 1120 - picture,
  );
  session.setLipsync(true);
  expect(session.video.anchorMs()).toBe(1120);
  session.setLipsync(true);
  expect(session.video.anchorMs()).toBe(1120);
  session.refresh();
  expect(session.getSnapshot().soundGapMs).toBe(0);
  session.setLipsync(false);
  expect(session.video.anchorMs()).toBe(1080);
  session.refresh();
  expect(session.getSnapshot().soundGapMs).toBe(40);
});

it("suit l'horaire du son lorsqu'il redescend, sans avancer artificiellement la vidéo", () => {
  const session = sessionAt(1080);
  let audio = 1480;
  vi.spyOn(session.sound, "gapAgainst").mockImplementation((picture) =>
    picture === null ? null : audio - picture,
  );
  session.setLipsync(true);
  expect(session.video.anchorMs()).toBe(1480);
  audio = 1090;
  session.refresh();
  expect(session.video.anchorMs()).toBe(1090);
  expect(session.getSnapshot().soundGapMs).toBe(0);
  audio = 1060;
  session.refresh();
  expect(session.video.anchorMs()).toBe(1080);
  expect(session.getSnapshot().soundGapMs).toBe(-20);
});

it("ne prétend pas mesurer un décalage avant l'image ou sans son", () => {
  const session = sessionAt(1080);
  vi.spyOn(session.sound, "gapAgainst").mockReturnValue(null);
  session.setLipsync(true);
  session.refresh();
  expect(session.video.anchorMs()).toBe(1080);
  expect(session.getSnapshot().soundGapMs).toBeNull();
  Object.assign(session.video, { offset: null });
  vi.spyOn(session.sound, "gapAgainst").mockImplementation((picture) =>
    picture === null ? null : 1120 - picture,
  );
  session.refresh();
  expect(session.getSnapshot().soundGapMs).toBeNull();
});

it("compare le morceau réellement programmé, même si l'avance cible dit autre chose", () => {
  const sound = new SoundStream((path) => path, 0.5, false);
  Object.assign(sound, {
    context: { state: "running", outputLatency: 0.02 },
    scheduledOffset: 1100,
    lead: 0.4,
  });
  (sound as unknown as { lags: { push: (n: number) => void } }).lags.push(1000);
  expect(sound.gapAgainst(1080)).toBeCloseTo(40);
  expect(sound.gapAgainst(1150)).toBeCloseTo(-30);
  expect(sound.gapAgainst(null)).toBeNull();
  Object.assign(sound, { context: { state: "suspended" } });
  expect(sound.gapAgainst(1080)).toBeNull();
});

it("garde assez d'images pour le retard audio choisi, puis rend les places en le retirant", () => {
  const session = sessionAt(1080);
  const before = session.video.stats().room;
  session.video.setLipsync(400);
  expect(session.video.stats().room).toBeGreaterThanOrEqual(before + 20);
  session.video.setLipsync(0);
  expect(session.video.stats().room).toBe(before);
});

it("mesure l'instant demandé à Web Audio et oublie cet horaire quand la salle ferme", () => {
  const sound = new SoundStream((path) => path, 0.5, false);
  const start = vi.fn();
  vi.spyOn(performance, "now").mockReturnValue(2000);
  Object.assign(sound, {
    context: {
      state: "running",
      currentTime: 10,
      outputLatency: 0.02,
      createBuffer: () => ({ getChannelData: () => new Float32Array(480) }),
      createBufferSource: () => ({ connect: vi.fn(), start }),
    },
    gain: {},
    playAt: 10.1,
    lead: 0.4,
  });
  const data = new ArrayBuffer(8 + 480 * 2 * 2);
  new DataView(data).setBigUint64(0, 1_000_000n, true);
  (sound as unknown as { onChunk: (event: MessageEvent) => void }).onChunk(
    new MessageEvent("message", { data }),
  );
  expect(start).toHaveBeenCalledWith(10.1);
  expect(sound.gapAgainst(1080)).toBeCloseTo(40);
  sound.setIdle(true);
  expect(sound.gapAgainst(1080)).toBeNull();
});
