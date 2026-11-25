/**
 * Ton étiquette tapée dans la légende de « Ta manette » (D7 du plan
 * manettes) : le numéro de ta place, sa couleur et ton nom, à côté du dessin
 * et jamais collée sur la coque. Elle dit à qui est la manette qu'on règle.
 * Qui regarde n'a pas de place, donc pas d'étiquette ; le dessin de ce que le
 * jeu reçoit n'en a jamais.
 */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InputState } from "../../media/input";
import { InputStream } from "../../media/input";
import { SwitchInput } from "../../media/switch";
import type { EntreeDolphin, TrameDolphin } from "./Dolphin";
import type { TramePro } from "./Pro";
import { Reglage } from "./Reglage";

const rien = () => {};
afterEach(() => localStorage.clear());

const entree = (): EntreeDolphin => ({
  beginCapture: vi.fn(),
  cancelCapture: vi.fn(),
  beginLesson: vi.fn(),
  skipLessonStep: vi.fn(),
  reprendreLecon: vi.fn(() => true),
  oublierSuspension: vi.fn(),
  useP: vi.fn(),
  resetPad: vi.fn(),
  resetKeys: vi.fn(),
  pickKeys: vi.fn(),
  newKeys: vi.fn(),
  forgetKeys: vi.fn(),
  keyProfileNamed: vi.fn(() => null),
  rendreKeys: vi.fn(),
  surReglage: () => rien,
});

const etat = (port: number | null): InputState => ({
  ...new InputStream(() => "", rien).state(),
  port,
});

function dolphin(port: number | null, etiquette?: TrameDolphin["etiquette"]) {
  const trame: TrameDolphin = {
    genre: "dolphin",
    console: "gc",
    tenue: 0,
    state: etat(port),
    input: entree(),
    refresh: rien,
    etiquette,
  };
  return render(
    <Reglage onglet="manette" onOnglet={rien} onFermer={rien} autres={false} vit trame={trame} />,
  );
}

function pro(place: TramePro["place"], etiquette?: TramePro["etiquette"]) {
  const trame: TramePro = {
    genre: "pro",
    console: "Xbox 360",
    xbox: true,
    manette: "manette Xbox 360",
    source: new SwitchInput(),
    input: { switchActive: () => true, surReglage: () => rien },
    place,
    etiquette,
  };
  return render(
    <Reglage onglet="manette" onOnglet={rien} onFermer={rien} autres={false} vit trame={trame} />,
  );
}

/** Les deux légendes des dessins : celle de ce que le jeu reçoit, puis la
 * tienne. La précondition : deux dessins, sinon rien n'est vérifié. */
function legendes(container: HTMLElement) {
  const figures = [...container.querySelectorAll(".n3-dessins figure.n3-controller")];
  expect(figures).toHaveLength(2);
  const [jeu, tienne] = figures as [HTMLElement, HTMLElement];
  expect(tienne.querySelector("figcaption")?.textContent).toContain("Ta manette");
  return { jeu, tienne };
}

describe("ton étiquette dans la légende de « Ta manette »", () => {
  it("dit ta place et ton nom, à côté de ta manette Dolphin", () => {
    const { container } = dolphin(2, { nom: "Lina", lettres: "LI2" });
    const { jeu, tienne } = legendes(container);
    const etiquette = tienne.querySelector("figcaption .n3-etiquette");
    expect(etiquette).toHaveAttribute("data-place", "2");
    expect(etiquette?.textContent).toContain("Lina");
    expect(tienne.querySelector("figcaption")?.textContent).toContain("2P");
    // Les initiales de la salle, pour l'effet « initiales ».
    expect(etiquette?.querySelector(".rt-initiales")?.textContent).toBe("LI2");
    // À côté du dessin, pas collée sur la coque.
    expect(tienne.querySelector("svg .n3-etiquette")).toBeNull();
    // Le jumeau : le dessin du jeu n'a pas d'étiquette.
    expect(jeu.querySelector(".n3-etiquette")).toBeNull();
  });

  it("dit aussi ta place à côté de ta manette en trame Pro", () => {
    const { container } = pro(3, { nom: "Bo" });
    const { jeu, tienne } = legendes(container);
    const etiquette = tienne.querySelector("figcaption .n3-etiquette");
    expect(etiquette).toHaveAttribute("data-place", "3");
    expect(etiquette?.textContent).toContain("Bo");
    expect(tienne.querySelector("figcaption")?.textContent).toContain("3P");
    expect(jeu.querySelector(".n3-etiquette")).toBeNull();
  });

  it("le jumeau : qui regarde n'a pas d'étiquette, même avec un nom", () => {
    const sansPlace = dolphin(null, { nom: "Lina" });
    expect(legendes(sansPlace.container).tienne.querySelector(".n3-etiquette")).toBeNull();
    sansPlace.unmount();
    const proSansPlace = pro(null, { nom: "Bo" });
    expect(legendes(proSansPlace.container).tienne.querySelector(".n3-etiquette")).toBeNull();
  });

  it("le jumeau : sans nom connu, la légende reste celle d'avant", () => {
    const { container } = dolphin(1);
    expect(legendes(container).tienne.querySelector(".n3-etiquette")).toBeNull();
  });
});
