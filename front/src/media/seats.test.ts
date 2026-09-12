import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InputStream } from "./input";

const sockets: FakeSocket[] = [];
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  onmessage = (_event: { data: ArrayBuffer | string }) => {};
  onclose: (() => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }
  send() {}
  close() {}
  room(port: number, busy = [1, 0, 0, 0]) {
    this.onmessage({ data: new Uint8Array([4, port, 1, 0, ...busy]).buffer });
  }
}
let stream: InputStream;
const announced = vi.fn();
const receipt = "a".repeat(32) + "-1";
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("navigator", { getGamepads: () => [] });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  sockets.length = 0;
  announced.mockClear();
  stream = new InputStream(
    (path) => path,
    announced,
    () => {},
  );
  stream.start();
});
afterEach(() => {
  stream.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("rendre sa manette efface aussi l'occupation locale et le droit de lancer", () => {
  sockets[0].room(1);
  expect(stream.state().deciding).toBe(true);
  stream.watchOnly();
  expect(stream.state().port).toBeNull();
  expect(stream.state().busy[0]).toBe(false);
  expect(stream.state().deciding).toBe(false);
  expect(announced).toHaveBeenLastCalledWith(null, null);
});
it("quitter la session annonce sa place rendue même si le salon reste ouvert", () => {
  sockets[0].room(1);
  announced.mockClear();
  stream.stop();
  expect(announced).toHaveBeenCalledWith(null, null);
});
it("relie le numéro à son attribution et ne répète pas chaque changement voisin", () => {
  expect(sockets[0].url).toContain("identity=1");
  sockets[0].room(1);
  sockets[0].onmessage({ data: `seat ${receipt}` });
  expect(announced).toHaveBeenLastCalledWith(1, receipt);
  announced.mockClear();
  sockets[0].room(1, [1, 1, 0, 0]);
  expect(announced).not.toHaveBeenCalled();
  sockets[0].onmessage({ data: "seat malformed" });
  expect(announced).not.toHaveBeenCalled();
});
it("une ancienne connexion ne renomme pas la nouvelle attribution", () => {
  sockets[0].room(1);
  stream.take(2);
  sockets[1].room(2, [0, 1, 0, 0]);
  sockets[1].onmessage({ data: `seat ${receipt}` });
  announced.mockClear();
  sockets[0].onmessage({ data: `seat ${"b".repeat(32)}-2` });
  sockets[0].room(1);
  expect(stream.state().port).toBe(2);
  expect(announced).not.toHaveBeenCalled();
});

it("demande sa place précédente après une coupure, sans la prendre de force", () => {
  sockets[0].room(2, [0, 1, 0, 0]);
  sockets[0].onclose!();
  vi.advanceTimersByTime(1000);
  expect(sockets.length).toBeGreaterThan(1);
  expect(sockets.at(-1)?.url).toContain("prefer=2");
  expect(sockets.at(-1)?.url).not.toContain("take=");
});

it("une reprise retardée vise une attribution et ne se rejoue pas à la reconnexion", () => {
  stream.take(2, receipt);
  expect(sockets.at(-1)?.url).toContain(`take=2&expected=${receipt}`);
  sockets.at(-1)!.room(2);
  sockets.at(-1)!.onclose!();
  vi.advanceTimersByTime(1000);
  expect(sockets.at(-1)?.url).toContain("prefer=2");
  expect(sockets.at(-1)?.url).not.toContain("expected=");
  expect(sockets.at(-1)?.url).not.toContain("take=");
});

it("une fermeture sans réponse libère l'état local puis redemande poliment", () => {
  const old = sockets[0];
  old.room(2, [0, 1, 0, 0]);
  old.readyState = 2;
  vi.advanceTimersByTime(2000);
  expect(stream.state().port).toBeNull();
  expect(stream.state().deciding).toBe(false);
  expect(sockets).toHaveLength(2);
  expect(sockets[1].url).toContain("prefer=2");
  expect(sockets[1].url).not.toContain("take=");
  sockets[1].room(2, [0, 1, 0, 0]);
  old.room(1);
  expect(stream.state().port).toBe(2);
});

it("une socket ouverte mais muette ne conserve pas sa place locale indéfiniment", () => {
  sockets[0].room(1);
  vi.advanceTimersByTime(6000);
  expect(stream.state().port).toBeNull();
  expect(sockets.length).toBeGreaterThan(1);
});

it("les réponses du worker conservent la prise pendant la même durée", () => {
  sockets[0].room(1);
  for (let i = 0; i < 12; i++) {
    sockets[0].room(1);
    vi.advanceTimersByTime(1000);
  }
  expect(sockets).toHaveLength(1);
  expect(stream.state().port).toBe(1);
});

it("revenir après une suspension du navigateur laisse une grâce aux réponses en attente", () => {
  sockets[0].room(1);
  vi.advanceTimersByTime(1000);
  const clock = vi.spyOn(performance, "now").mockReturnValue(60_000);
  vi.advanceTimersByTime(1000);
  expect(stream.state().port).toBe(1);
  expect(sockets).toHaveLength(1);
  clock.mockRestore();
});
