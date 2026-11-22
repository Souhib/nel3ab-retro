/**
 * Le nom de l'appareil d'un joueur prêt, dans la préparation d'un jeu.
 *
 * La préparation lit `padLabel` (lib/saves). Le 22 novembre 2026, une première
 * correction de ce nom a fait afficher « appareil 4 inconnu · prêt » à chaque
 * joueur prêt d'un jeu Switch, Switch 2 ou Xbox 360 : leur seul appareil est la
 * manette Pro, code 4, que `padLabel` ne connaissait pas. Avant, la même ligne
 * disait « manette GameCube · prêt ». Ce fichier rend la vraie préparation pour
 * le voir, sans toucher au composant.
 */
import { render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Preparation as Pending } from "../client";
import { InputStream } from "../media/input";
import { Preparation } from "./Preparation";

beforeEach(() => localStorage.clear());

/** La ligne « P1 » d'une préparation où Alice est prête avec l'appareil `pad`. */
function ligne(allowed: number[], pad: number): string {
  const pending: Pending = {
    id: "manche",
    game: 1,
    save: 0,
    starter: "alice",
    allowed,
    players: [{ port: 1, claim: "alice", name: "Alice", pad, ready: true }],
  };
  const input = new InputStream((s) => s, vi.fn(), vi.fn());
  vi.spyOn(input, "attribution").mockReturnValue("benoit");
  const { container } = render(
    <Preparation
      pending={pending}
      input={input}
      state={input.state()}
      selected={0}
      onSelect={vi.fn()}
      send={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  const said = container.querySelector(".n3-preparation-players small")?.textContent;
  // La précondition: sans ligne de joueur, les attentes d'en dessous ne
  // vérifieraient rien.
  if (said === undefined || said === null) throw new Error("aucune ligne de joueur rendue");
  return said;
}

it("un joueur prêt d'un jeu Pro a la manette Pro, ni inconnue ni GameCube", () => {
  const said = ligne([4], 4);
  expect(said).toBe("manette Pro · prêt");
  expect(said).not.toMatch(/inconnu|GameCube/);
});

it("le jumeau Wii: chaque place garde le nom de son appareil", () => {
  expect(ligne([1, 0, 2, 3], 1)).toBe("Wiimote et Nunchuk · prêt");
  expect(ligne([1, 0, 2, 3], 0)).toBe("manette GameCube · prêt");
});
