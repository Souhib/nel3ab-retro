/** Les sons du réglage : une pièce quand une étape est retenue, un son grave
 * quand la manette se débranche. Jamais pour une consigne ni une étape. */
import { act, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Annonces } from "../../media/lesson";
import { InputStream, type EvenementReglage } from "../../media/input";
import type { Moment } from "./marques";
import { Reglage } from "./Reglage";
import { sonnerReglage } from "./sons";

const sonMenu = vi.hoisted(() => vi.fn(() => true));
vi.mock("../../retro/sons", async (original) => ({
  ...(await original<typeof import("../../retro/sons")>()),
  sonMenu,
}));

it("joue une pièce à chaque réponse retenue et un son grave au débranchement", () => {
  const annonces = new Annonces<Moment>();
  const jouer = vi.fn(() => true);
  const arreter = sonnerReglage((ecoute) => annonces.ecouter(ecoute), jouer);
  annonces.emettre({ type: "etape", control: "A" });
  annonces.emettre({ type: "relache" });
  annonces.emettre({ type: "fin" });
  // Jumeau : ni une étape, ni un relâché, ni la fin ne sonnent.
  expect(jouer).not.toHaveBeenCalled();
  annonces.emettre({ type: "recu", control: "A", indice: "b0" });
  annonces.emettre({ type: "suspendu" });
  expect(jouer.mock.calls).toEqual([["piece"], ["erreur"]]);
  arreter();
  annonces.emettre({ type: "recu", control: "A", indice: "b0" });
  expect(jouer).toHaveBeenCalledTimes(2);
});

it("le panneau branche les sons du socle sur la boucle d'entrée", () => {
  const ecoutes = new Set<(e: EvenementReglage) => void>();
  const vrai = new InputStream(
    () => "",
    () => {},
  );
  const input = Object.assign(Object.create(vrai) as InputStream, {
    surReglage: (ecoute: (e: EvenementReglage) => void) => {
      ecoutes.add(ecoute);
      return () => ecoutes.delete(ecoute);
    },
  });
  render(
    <Reglage
      onglet="manette"
      onOnglet={() => {}}
      onFermer={() => {}}
      autres={false}
      vit
      trame={{
        genre: "dolphin",
        console: "gc",
        tenue: 0,
        state: vrai.state(),
        input,
        refresh: () => {},
      }}
    />,
  );
  sonMenu.mockClear();
  act(() => ecoutes.forEach((ecoute) => ecoute({ type: "recu", control: "A", indice: "b0" })));
  expect(sonMenu).toHaveBeenCalledWith("piece");
});
