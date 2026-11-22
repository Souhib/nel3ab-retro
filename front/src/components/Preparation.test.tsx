import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

/** Un panneau où Benoît a déjà confirmé, ou non, vu par `qui`. */
function rendre(qui: string, benoitPret: boolean, allowed: number[] = [1, 0]) {
  const input = new InputStream((s) => s, vi.fn(), vi.fn());
  vi.spyOn(input, "attribution").mockReturnValue(qui);
  const send = vi.fn().mockResolvedValue(undefined);
  render(
    <Preparation
      pending={{
        ...pending,
        allowed,
        players: [
          pending.players[0],
          { ...pending.players[1], ready: benoitPret, pad: benoitPret ? allowed[0] : null },
        ],
      }}
      game={{ index: 1, name: "Mario Kart Wii", console: allowed.length > 1 ? "wii" : "gc" }}
      input={input}
      state={input.state()}
      selected={allowed[0] as 0 | 1}
      onSelect={vi.fn()}
      send={send}
    />,
  );
  return send;
}

it("le chef lance en un geste, avec son propre choix (audit P6)", async () => {
  const send = rendre("alice", true);
  // « Je suis prêt » puis « Lancer » disaient deux fois la même chose.
  expect(screen.queryByRole("button", { name: "Je suis prêt" })).toBeNull();
  const lancer = screen.getByRole("button", { name: "Lancer le jeu" });
  expect(lancer).toBeEnabled();
  fireEvent.click(lancer);
  expect(send).toHaveBeenCalledWith({ action: "launch", pad: 1, id: "round-one" });
});

it("le chef attend un joueur qui se prépare, et le dit", () => {
  rendre("alice", false);
  expect(screen.getByRole("button", { name: "Lancer le jeu" })).toBeDisabled();
  expect(screen.getByText("En attente de Benoît.")).toBeVisible();
  // Le jumeau: pas de raccourci avant le délai.
  expect(screen.queryByRole("button", { name: /sans attendre/ })).toBeNull();
});

it("le chef lance sans attendre un absent, après le délai", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const send = rendre("alice", false);
    await act(async () => {
      vi.advanceTimersByTime(21_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Lancer sans attendre Benoît" }));
    expect(send).toHaveBeenCalledWith({
      action: "launch",
      pad: 1,
      sans_attendre: true,
      id: "round-one",
    });
  } finally {
    vi.useRealTimers();
  }
});

it("les autres confirment, et ne lancent pas", () => {
  rendre("benoit", false);
  expect(screen.getByRole("button", { name: "Je suis prêt" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Lancer le jeu" })).toBeNull();
});

it("un seul appareil se nomme, sans liste à une seule option", () => {
  rendre("alice", true, [0]);
  expect(screen.queryByRole("combobox", { name: "Ma configuration pour ce jeu" })).toBeNull();
  expect(screen.getByText("Ton appareil : manette GameCube")).toBeVisible();
  // Le jumeau: deux appareils gardent leur liste.
  cleanup();
  rendre("alice", true, [1, 0]);
  expect(screen.getByRole("combobox", { name: "Ma configuration pour ce jeu" })).toBeVisible();
});
