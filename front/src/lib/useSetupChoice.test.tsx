import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import type { Preparation } from "../client";
import type { Pad } from "./saves";
import { useSetupChoice } from "./useSetupChoice";

const preparation: Preparation = {
  id: "round-one",
  game: 1,
  save: 0,
  starter: "one",
  allowed: [1, 0],
  players: [{ port: 1, claim: "one", name: "Alice", pad: null, ready: false }],
};
beforeEach(() => localStorage.clear());
const start = () =>
  renderHook(
    ({ pad, pending }: { pad: Pad; pending: Preparation | null }) => useSetupChoice(pad, pending),
    { initialProps: { pad: 0 as Pad, pending: null as Preparation | null } },
  );

it("un navigateur neuf prépare la Wiimote annoncée par le worker", () => {
  const { result, rerender } = start();
  expect(result.current[0]).toBe(0);
  rerender({ pad: 1, pending: null });
  expect(result.current[0]).toBe(1);
  rerender({ pad: 1, pending: preparation });
  expect(result.current[0]).toBe(1);
});

it("une annonce de salle ne remplace pas le choix en cours d'édition", () => {
  const { result, rerender } = start();
  rerender({ pad: 0, pending: preparation });
  act(() => result.current[1](1));
  rerender({ pad: 0, pending: { ...preparation } });
  expect(result.current[0]).toBe(1);
  rerender({ pad: 0, pending: null });
  expect(result.current[0]).toBe(0);
});

it("le choix demandé depuis les réglages précède la préparation", () => {
  const { result, rerender } = start();
  act(() => result.current[1](1));
  rerender({ pad: 0, pending: preparation });
  expect(result.current[0]).toBe(1);
  rerender({ pad: 0, pending: { ...preparation, allowed: [3] } });
  expect(result.current[0]).toBe(3);
});
