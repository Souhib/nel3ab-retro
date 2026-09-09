import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SetupProfiles } from "./SetupProfiles";
import {
  saveSetup,
  preferSetup,
  preferredSetup,
  setupGameKey,
  type SetupProfile,
} from "../lib/setups";
import { InputStream } from "../media/input";
const game = { index: 0, name: "Mario Kart Wii", console: "wii" };
const profile: SetupProfile = { kind: 1, device: null, standard: false, pad: null, keys: {} };
beforeEach(() => localStorage.clear());
function show(allowed = [0, 1], disabled = false) {
  const input = new InputStream((s) => s, vi.fn(), vi.fn());
  const applySetup = vi.spyOn(input, "applySetup");
  const onSelect = vi.fn();
  render(
    <SetupProfiles
      game={game}
      input={input}
      state={input.state()}
      selected={1}
      allowed={allowed}
      onSelect={onSelect}
      disabled={disabled}
    />,
  );
  return { applySetup, onSelect };
}
it("propose le profil du jeu sans charger ou confirmer à la place du joueur", () => {
  saveSetup("Conduite", profile);
  preferSetup(setupGameKey(game), "Conduite");
  const { applySetup, onSelect } = show();
  expect(screen.getByLabelText("Profil personnel de manette")).toHaveValue("Conduite");
  expect(applySetup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Charger"));
  expect(applySetup).toHaveBeenCalledWith("Conduite", expect.objectContaining({ kind: 1 }));
  expect(onSelect).toHaveBeenCalledWith(1);
  expect(screen.getByRole("status")).toHaveTextContent("Teste-le");
});
it("refuse un type incompatible et ne change ni les commandes ni le choix", () => {
  saveSetup("Conduite", profile);
  preferSetup(setupGameKey(game), "Conduite");
  const { applySetup, onSelect } = show([0]);
  fireEvent.click(screen.getByText("Charger"));
  expect(applySetup).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("incompatible");
});
it("retient et retire la préférence sans changer le profil", () => {
  saveSetup("Conduite", profile);
  const { applySetup } = show();
  fireEvent.change(screen.getByLabelText("Profil personnel de manette"), {
    target: { value: "Conduite" },
  });
  fireEvent.click(screen.getByText("Proposer ce profil pour ce jeu"));
  expect(preferredSetup(setupGameKey(game))).toBe("Conduite");
  fireEvent.click(screen.getByText("Retirer le choix pour ce jeu"));
  expect(preferredSetup(setupGameKey(game))).toBeNull();
  expect(applySetup).not.toHaveBeenCalled();
});
it("verrouille le chargement quand le joueur est prêt", () => {
  saveSetup("Conduite", profile);
  preferSetup(setupGameKey(game), "Conduite");
  show([1], true);
  expect(screen.getByText("Charger")).toBeDisabled();
});
