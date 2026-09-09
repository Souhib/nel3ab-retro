import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { SETUPS_STORED, useBindings } from "./bindings";

const service = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../client", () => ({
  readBindings: service.read,
  readRoomBindings: async () => ({ data: { pads: {}, keys: {} } }),
  keepBindings: vi.fn(),
}));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

async function visit(setups: Record<string, unknown>) {
  service.read.mockResolvedValue({ data: { pads: {}, keys: {}, setups } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useBindings("alice@example.test"), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  hook.unmount();
  client.clear();
}

it("une nouvelle visite charge aussi les profils complets de la personne", async () => {
  const saved = {
    "Kart personnel": { kind: 1, keys: {}, pad: null, device: null, standard: false },
  };
  await visit(saved);
  expect(JSON.parse(localStorage.getItem(SETUPS_STORED) ?? "{}")).toEqual(saved);
});

it("un profil supprimé sur un autre appareil ne survit pas dans le cache", async () => {
  localStorage.setItem(SETUPS_STORED, JSON.stringify({ ancien: { kind: 0 } }));
  await visit({});
  expect(JSON.parse(localStorage.getItem(SETUPS_STORED) ?? "{}")).toEqual({});
});
