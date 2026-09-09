import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { useRename } from "./me";
import { ROOM_KEY } from "./room";
vi.mock("../client", () => ({
  renameMe: async () => ({ data: { name: "Nouveau", login: "one" } }),
}));
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
