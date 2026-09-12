import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Preparation } from "./Preparation";
import { InputStream } from "../media/input";
import type { Preparation as Pending } from "../client";

const pending: Pending = {
  id: "round-one",
  game: 1,
  save: 0,
  starter: "alice",
  allowed: [1, 0],
  players: [
    { port: 1, claim: "alice", name: "Alice", pad: null, ready: false },
    { port: 2, claim: "benoit", name: "Benoît", pad: null, ready: false },
  ],
};

beforeEach(() => localStorage.clear());

function show(qui: string, onLater?: () => void) {
  const input = new InputStream((s) => s, vi.fn(), vi.fn());
  vi.spyOn(input, "attribution").mockReturnValue(qui);
  render(
    <Preparation
      pending={pending}
      input={input}
      state={input.state()}
      selected={1}
      onSelect={vi.fn()}
      send={vi.fn().mockResolvedValue(undefined)}
      onLater={onLater}
    />,
  );
}

it("qui n'a pas lancé la préparation peut la mettre de côté", () => {
  const later = vi.fn();
  show("benoit", later);
  fireEvent.click(screen.getByRole("button", { name: "Plus tard" }));
  expect(later).toHaveBeenCalledOnce();
});

it("l'initiateur garde l'annulation, et n'a rien à mettre de côté", () => {
  // Le jumeau négatif: « Plus tard » ne doit pas remplacer « Annuler le
  // lancement » chez celui qui a lancé, sinon écarter le panneau laisserait une
  // préparation que plus personne ne peut arrêter.
  show("alice", vi.fn());
  expect(screen.getByRole("button", { name: "Annuler le lancement" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Plus tard" })).toBeNull();
});

it("sans échappatoire fournie, le panneau reste tel qu'il était", () => {
  show("benoit");
  expect(screen.queryByRole("button", { name: "Plus tard" })).toBeNull();
});
