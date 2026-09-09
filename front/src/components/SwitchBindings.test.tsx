import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SwitchBindings } from "./SwitchBindings";
import { InputStream } from "../media/input";
import type { Preparation } from "../client";
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
});
afterEach(() => vi.unstubAllGlobals());
function show(ready = false, pending = false) {
  const input = new InputStream((p) => p, vi.fn(), vi.fn());
  vi.spyOn(input, "attribution").mockReturnValue("claim-1");
  const block = vi.spyOn(input, "blockGameplay");
  const send = vi.fn().mockResolvedValue(undefined);
  const preparation = {
    id: "launch-1",
    starter: "claim-1",
    save: 0,
    players: [
      { claim: "claim-1", port: 1, name: "Alice", ready, pad: 4 },
      { claim: "claim-2", port: 2, name: "Benoit", ready: false, pad: 4 },
    ],
  } as Preparation;
  const view = render(
    <SwitchBindings
      input={input}
      source={input.switch}
      pending={pending ? preparation : null}
      send={send}
      close={vi.fn()}
    />,
  );
  return { input, block, send, ...view };
}
it("opens one correspondence list and leaves diagnostics closed; release on dismissal", () => {
  const { block, unmount } = show();
  expect(screen.getByText("Toutes les correspondances").closest("details")).toHaveAttribute("open");
  expect(
    screen.getByText("Diagnostic des boutons et des axes").closest("details"),
  ).not.toHaveAttribute("open");
  expect(block).toHaveBeenLastCalledWith(true);
  unmount();
  expect(block).toHaveBeenLastCalledWith(false);
});
it("saves and restores a named personal profile without marking the player ready", () => {
  const { input, send } = show(false, true);
  fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Tennis" } });
  fireEvent.click(screen.getByText("Enregistrer"));
  expect(input.switch.named.Tennis).toBeDefined();
  input.switch.profile.keys.A = "KeyM";
  fireEvent.change(screen.getByLabelText("Profil"), { target: { value: "Tennis" } });
  fireEvent.click(screen.getByText("Charger"));
  expect(input.switch.profile.keys.A).toBe("KeyX");
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByText("Lancer le jeu")).toBeDisabled();
  fireEvent.click(screen.getByText("Je suis prêt"));
  expect(send).toHaveBeenCalledWith({ id: "launch-1", action: "choose", pad: 4, ready: true });
});
it("a ready player must withdraw confirmation before changing a profile", () => {
  const { send } = show(true, true);
  expect(screen.getByText("Enregistrer")).toBeDisabled();
  expect(screen.getByText("Configuration d’origine")).toBeDisabled();
  expect(screen.getByText("Lancer le jeu")).toBeDisabled();
  fireEvent.click(screen.getByText("Modifier ma configuration"));
  expect(send).toHaveBeenCalledWith({ id: "launch-1", action: "choose", pad: 4, ready: false });
});
