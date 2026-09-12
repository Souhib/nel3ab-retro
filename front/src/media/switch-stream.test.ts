import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InputStream } from "./input";
import { SwitchInput } from "./switch";
let stream: InputStream, source: SwitchInput;
let pad: Gamepad;
let sockets: FakeSocket[];
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  sent: Uint8Array[] = [];
  onmessage: ((event: { data: ArrayBuffer | string }) => void) | null = null;
  constructor() {
    sockets.push(this);
  }
  send(bytes: Uint8Array) {
    this.sent.push(bytes);
  }
  close() {
    this.readyState = 3;
  }
}
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  sockets = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  pad = {
    id: "standard",
    connected: true,
    index: 0,
    mapping: "standard",
    axes: [0.25, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })),
  } as unknown as Gamepad;
  vi.stubGlobal("navigator", { getGamepads: () => [pad] });
  source = new SwitchInput();
  stream = new InputStream(
    (p) => p,
    () => {},
    () => {},
    false,
    source,
  );
  stream.start();
  sockets[0].onmessage!({ data: new Uint8Array([4, 2, 1, 0, 0, 1, 0, 0]).buffer });
});
afterEach(() => {
  stream.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const tick = () => vi.advanceTimersByTime(4);
const last = () => sockets[0].sent.at(-1)!;
it("the real input pump emits only Switch frames, with no Wii extension announcement", () => {
  expect(sockets[0].sent).toEqual([]);
  tick();
  expect(last()).toHaveLength(15);
  expect([...last().slice(0, 3)]).toEqual([0x53, 1, 2]);
  expect(new DataView(last().buffer).getInt16(7, true)).toBe(8192);
  Object.assign(pad.buttons[5], { value: 1, pressed: true });
  tick();
  expect(last()[3]).toBe(1 << 5);
  stream.blockGameplay(true);
  tick();
  expect([...last().slice(3)]).toEqual(Array(12).fill(0));
  expect(source.reading.buttons).toBe(1 << 5);
  stream.blockGameplay(false);
  Object.assign(pad.buttons[5], { value: 0, pressed: false });
  tick();
  expect(last()[3]).toBe(0);
});
it("keyboard capture, release and editable fields keep their existing priorities", () => {
  source.begin("R", "key");
  dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft", cancelable: true }));
  tick();
  expect(last()[3]).toBe(0);
  dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowLeft" }));
  dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" }));
  tick();
  expect(last()[3]).toBe(1 << 5);
  expect(new DataView(last().buffer).getInt16(7, true)).toBe(8192);
  dispatchEvent(new Event("blur"));
  tick();
  expect(last()[3]).toBe(0);
  source.begin("A", "key");
  const input = document.createElement("input");
  document.body.append(input);
  input.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyM", bubbles: true }));
  expect(source.capturing).not.toBeNull();
  input.remove();
});
it("Dolphin's default pump still uses the thirteen-byte contract", () => {
  stream.stop();
  sockets = [];
  stream = new InputStream(
    (p) => p,
    () => {},
  );
  stream.start();
  sockets[0].onmessage!({ data: new Uint8Array([4, 2, 1, 0, 0, 1, 0, 0]).buffer });
  tick();
  expect(last()).toHaveLength(13);
  expect(last()[2]).toBe(2);
});
it("the selected Switch device receives vibration and appears in the snapshot", () => {
  const first = {
    playEffect: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
  };
  const second = {
    playEffect: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
  };
  Object.assign(pad, { vibrationActuator: first });
  const other = { ...pad, id: "second pad", index: 1, vibrationActuator: second };
  vi.stubGlobal("navigator", { getGamepads: () => [pad, other] });
  source.selected = 1;
  tick();
  expect(stream.state().using).toBe(1);
  expect(stream.state().padId).toBe("second pad");
  sockets[0].onmessage!({ data: new Uint8Array([2, 255]).buffer });
  expect(second.playEffect).toHaveBeenCalledOnce();
  expect(first.playEffect).not.toHaveBeenCalled();
  sockets[0].onmessage!({ data: new Uint8Array([2, 0]).buffer });
  expect(second.reset).toHaveBeenCalledOnce();
  expect(first.reset).not.toHaveBeenCalled();
});

it("the worker format greeting selects Switch before the first frame; a fresh Dolphin connection resets it", () => {
  stream.stop();
  stream = new InputStream(
    (p) => p,
    () => {},
    () => {},
    false,
  );
  stream.start();
  let socket = sockets.at(-1)!;
  socket.onmessage!({ data: "format switch" });
  socket.onmessage!({ data: new Uint8Array([4, 1, 1, 0, 1, 0, 0, 0]).buffer });
  tick();
  expect(socket.sent.at(-1)).toHaveLength(15);
  expect(stream.switchActive()).toBe(true);
  stream.watchOnly();
  stream.play();
  socket = sockets.at(-1)!;
  socket.onmessage!({ data: new Uint8Array([4, 1, 1, 0, 1, 0, 0, 0]).buffer });
  tick();
  expect(socket.sent.at(-1)).toHaveLength(13);
  expect(stream.switchActive()).toBe(false);
});

it("can configure Dolphin for the next game while Switch keeps receiving neutral Switch frames", () => {
  stream.blockGameplay(true, "dolphin");
  tick();
  stream.beginCapture("A", "pad");
  Object.assign(pad.buttons[3], { value: 1, pressed: true });
  tick();
  expect(stream.state().capturing).toBeNull();
  expect(stream.state().profile?.buttons.A).toEqual({ button: 3, rest: 0 });
  expect(last()).toHaveLength(15);
  expect([...last().slice(3)]).toEqual(Array(12).fill(0));
  expect(source.profile.devices).toEqual({});
  Object.assign(pad.buttons[3], { value: 0, pressed: false });
  (pad.axes as number[])[0] = 0;
  tick();
  stream.blockGameplay(false);
  Object.assign(pad.buttons[3], { value: 1, pressed: true });
  tick();
  expect(last()[3]).toBe(1 << 3);
});
