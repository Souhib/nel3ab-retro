import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VideoStream } from "./video";
import { SoundStream } from "./sound";

const sockets: FakeSocket[] = [];
class FakeSocket {
  readyState = 1;
  onclose: (() => void) | null = null;
  onopen: (() => void) | null = null;
  close = vi.fn();
  send = vi.fn();
  constructor() {
    sockets.push(this);
  }
}
let frames: Map<number, FrameRequestCallback>;
let next: number;

beforeEach(() => {
  localStorage.clear();
  sockets.length = 0;
  frames = new Map();
  next = 0;
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("fermer la vidéo annule peinture et reconnexion ; relancer crée une seule boucle", () => {
  const video = new VideoStream(document.createElement("canvas"), (path) => path);
  video.start();
  video.start();
  expect(sockets).toHaveLength(1);
  expect(frames.size).toBe(1);
  sockets[0]!.onclose!();
  video.stop();
  expect(frames.size).toBe(0);
  vi.advanceTimersByTime(2000);
  expect(sockets).toHaveLength(1);
  video.setHalf(true);
  video.setHalf(false);
  expect(sockets).toHaveLength(1);
  video.start();
  expect(sockets).toHaveLength(2);
  expect(frames.size).toBe(1);
  video.stop();
});

it("les images en attente sont rendues au navigateur quand le jeu se ferme", () => {
  const video = new VideoStream(document.createElement("canvas"), (path) => path);
  const close = vi.fn();
  Object.assign(video, { queue: [{ frame: { close } }] });
  video.start();
  expect(close).not.toHaveBeenCalled();
  video.stop();
  expect(close).toHaveBeenCalledOnce();
  video.stop();
  expect(close).toHaveBeenCalledOnce();
});

it("le son reprend avec son contexte autorisé et ignore une ancienne reconnexion", () => {
  const sound = new SoundStream((path) => path, 0.5, false);
  const context = { close: vi.fn() };
  Object.assign(sound, { context });
  sound.setIdle(true);
  expect(sockets).toHaveLength(0);
  sound.setIdle(false);
  expect(sockets).toHaveLength(1);
  sockets[0]!.onclose!();
  sound.setIdle(true);
  vi.advanceTimersByTime(2000);
  expect(sockets).toHaveLength(1);
  expect(context.close).not.toHaveBeenCalled();
  sound.setIdle(false);
  expect(sockets).toHaveLength(2);
  sockets[1]!.onclose!();
  sound.setIdle(true);
  sound.setIdle(false);
  vi.advanceTimersByTime(2000);
  expect(sockets).toHaveLength(3);
  sound.stop();
  expect(context.close).toHaveBeenCalledOnce();
});

it("la sourdine ferme la socket du son, et le volume remonté la rouvre une fois", () => {
  // Le 23 septembre 2026, un volume à zéro laissait passer 1,5 Mbit/s de son que
  // personne n'entendait, sur les liaisons qui en avaient le moins les moyens.
  const sound = new SoundStream((path) => path, 0.5, false);
  Object.assign(sound, { context: { close: vi.fn() } });
  sound.setIdle(true);
  sound.setIdle(false);
  expect(sockets).toHaveLength(1);

  sound.setVolume(0);
  expect(sockets[0]!.close).toHaveBeenCalled();
  // La socket fermée exprès ne se rouvre pas toute seule.
  sockets[0]!.onclose!();
  vi.advanceTimersByTime(2000);
  expect(sockets).toHaveLength(1);
  // Ni en sortant du repos pendant la sourdine.
  sound.setIdle(true);
  sound.setIdle(false);
  expect(sockets).toHaveLength(1);

  sound.setVolume(0.4);
  expect(sockets).toHaveLength(2);
  sound.stop();
});

it("changer le volume sans passer par zéro ne touche pas à la socket", () => {
  const sound = new SoundStream((path) => path, 0.5, false);
  Object.assign(sound, { context: { close: vi.fn() } });
  sound.setIdle(true);
  sound.setIdle(false);
  sound.setVolume(0.2);
  sound.setVolume(0.9);
  expect(sockets).toHaveLength(1);
  expect(sockets[0]!.close).not.toHaveBeenCalled();
  sound.stop();
});

it("une page ouverte en sourdine ne demande aucun son", () => {
  const sound = new SoundStream((path) => path, 0, false);
  Object.assign(sound, { context: { close: vi.fn() } });
  sound.setIdle(true);
  sound.setIdle(false);
  expect(sockets).toHaveLength(0);
  sound.setVolume(0.3);
  expect(sockets).toHaveLength(1);
  sound.stop();
});
