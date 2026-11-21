import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ME_KEY, useMe, useMenuIdentity, useRename } from "./me";
import { ROOM_KEY } from "./room";
import { launchPicks } from "./saves";
const { readMe } = vi.hoisted(() => ({ readMe: vi.fn() }));
vi.mock("../client", () => ({
  readMe,
  renameMe: async () => ({ data: { name: "Nouveau", login: "one" } }),
}));
afterEach(() => readMe.mockReset());

it("retrouve le compte à l'ouverture du menu après une réponse sans identité", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ME_KEY, { name: "", login: null });
  let complete: ((value: { data: { name: string; login: string } }) => void) | undefined;
  readMe.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, rerender, unmount } = renderHook(
    ({ open }) => ({ me: useMe(), checking: useMenuIdentity(open) }),
    { wrapper, initialProps: { open: false } },
  );
  expect(readMe).not.toHaveBeenCalled();
  expect(launchPicks(Boolean(result.current.me.data?.login)).map((pick) => pick.id)).toEqual(["0"]);
  rerender({ open: true });
  await waitFor(() => expect(readMe).toHaveBeenCalledTimes(1));
  expect(result.current.checking).toBe(true);
  expect(complete).toBeDefined();
  await act(async () => complete!({ data: { name: "Souhib", login: "verified@example.com" } }));
  await waitFor(() => expect(result.current.me.data?.login).toBe("verified@example.com"));
  expect(result.current.checking).toBe(false);
  expect(launchPicks(Boolean(result.current.me.data?.login)).map((pick) => pick.id)).toEqual([
    "0",
    "2",
  ]);
  rerender({ open: false });
  rerender({ open: true });
  expect(readMe).toHaveBeenCalledTimes(1);
  unmount();
  client.clear();
});

it("un pseudo seul reste anonyme et chaque réouverture permet une nouvelle lecture", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ME_KEY, { name: "Souhib", login: null });
  readMe.mockResolvedValue({ data: { name: "Souhib", login: null } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, rerender, unmount } = renderHook(
    ({ open }) => ({ me: useMe(), checking: useMenuIdentity(open) }),
    { wrapper, initialProps: { open: false } },
  );
  expect(readMe).not.toHaveBeenCalled();
  const reopen = async (count: number) => {
    rerender({ open: true });
    await waitFor(() => expect(readMe).toHaveBeenCalledTimes(count));
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.me.data?.login).toBeNull();
    expect(launchPicks(Boolean(result.current.me.data?.login)).map((pick) => pick.id)).toEqual([
      "0",
    ]);
    rerender({ open: false });
  };
  await reopen(1);
  await reopen(2);
  unmount();
  client.clear();
});

it("ne relit pas une identité vérifiée à chaque ouverture du menu", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ME_KEY, { name: "Souhib", login: "verified@example.com" });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, rerender, unmount } = renderHook(
    ({ open }) => ({ me: useMe(), checking: useMenuIdentity(open) }),
    { wrapper, initialProps: { open: true } },
  );
  expect(result.current.checking).toBe(false);
  rerender({ open: false });
  rerender({ open: true });
  expect(result.current.me.data?.login).toBe("verified@example.com");
  expect(readMe).not.toHaveBeenCalled();
  unmount();
  client.clear();
});

it("le pseudo poussé par le salon ne revient pas à l'ancienne réponse HTTP", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const old = { people: [{ name: "Ancien" }] };
  const current = { people: [{ name: "Nouveau" }] };
  const query = vi.fn(async () => old);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, unmount } = renderHook(
    () => ({
      room: useQuery({ queryKey: ROOM_KEY, queryFn: query, staleTime: Infinity }),
      rename: useRename(() => client.setQueryData(ROOM_KEY, current)),
    }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.room.data).toEqual(old));
  await act(async () => {
    await result.current.rename.mutateAsync("Nouveau");
  });
  await waitFor(() => expect(result.current.room.isFetching).toBe(false));
  expect(client.getQueryData(ROOM_KEY)).toEqual(current);
  unmount();
  client.clear();
});
