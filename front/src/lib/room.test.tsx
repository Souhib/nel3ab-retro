import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLobby } from "./room";

const socket = vi.hoisted(() => ({
  connected: false,
  on: vi.fn(),
  volatile: { emit: vi.fn() },
  removeAllListeners: vi.fn(),
  close: vi.fn(),
}));
vi.mock("socket.io-client", () => ({ io: () => socket }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  socket.connected = false;
});
afterEach(() => vi.useRealTimers());

function visit() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () =>
      useLobby(
        "alice",
        "Alice",
        false,
        () => {},
        () => {},
        () => {},
      ),
    { wrapper },
  );
  const connect = () => {
    socket.connected = true;
    const listener = socket.on.mock.calls.find(([event]) => event === "connect");
    expect(listener).toBeDefined();
    act(() => listener![1]());
  };
  return {
    ...hook,
    connect,
    close: () => {
      hook.unmount();
      client.clear();
    },
  };
}

it("réannonce la place après le retour du salon, même sans reconnecter la manette", () => {
  const hook = visit();
  act(() => hook.result.current.seat(2, "worker-2"));
  expect(socket.volatile.emit).not.toHaveBeenCalled();
  hook.connect();
  expect(socket.volatile.emit).toHaveBeenLastCalledWith("seat", { port: 2, claim: "worker-2" });
  socket.volatile.emit.mockClear();
  act(() => vi.advanceTimersByTime(1000));
  expect(socket.volatile.emit).toHaveBeenCalledOnce();
  socket.connected = false;
  socket.volatile.emit.mockClear();
  act(() => vi.advanceTimersByTime(2000));
  expect(socket.volatile.emit).not.toHaveBeenCalled();
  hook.connect();
  expect(socket.volatile.emit).toHaveBeenCalledExactlyOnceWith("seat", {
    port: 2,
    claim: "worker-2",
  });
  hook.close();
  socket.volatile.emit.mockClear();
  act(() => vi.advanceTimersByTime(2000));
  expect(socket.volatile.emit).not.toHaveBeenCalled();
  expect(socket.close).toHaveBeenCalledOnce();
});

it("ne rejoue pas les anciennes places si on passe spectateur pendant la coupure", () => {
  const hook = visit();
  act(() => {
    hook.result.current.seat(1, "ancienne");
    hook.result.current.seat(3, "nouvelle");
    hook.result.current.seat(null, null);
  });
  expect(socket.volatile.emit).not.toHaveBeenCalled();
  hook.connect();
  expect(socket.volatile.emit).toHaveBeenCalledExactlyOnceWith("seat", { port: null, claim: null });
  hook.close();
});
