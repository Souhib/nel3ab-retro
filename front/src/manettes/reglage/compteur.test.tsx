/** Le compteur d'étape du pas à pas : « 03/16 » en chiffres d'afficheur
 * (effet « chiffres »), qui roule d'un cran au niveau tout (effet
 * « compteur »). Le lecteur d'écran garde « Étape 3 sur 16 ». */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { changerNiveau, oublierPourEssai } from "../../lib/effets";
import { PasAPas } from "./PasAPas";

const rien = () => {};
const pas = (etape: number) => (
  <PasAPas
    etape={etape}
    total={16}
    attendRelache={false}
    consigne="Appuie."
    onPasser={rien}
    onArreter={rien}
  />
);

afterEach(() => {
  oublierPourEssai();
  localStorage.clear();
});

describe("le compteur d'étape", () => {
  it("écrit l'étape sur deux chiffres, et la dit entière au lecteur d'écran", () => {
    const { container, rerender } = render(pas(3));
    const valeur = container.querySelector(".n3-pas-compteur .rt-afficheur-valeur");
    expect(valeur?.textContent).toBe("03/16");
    expect(container.querySelector("#pasTitre")?.textContent).toContain("Étape 3 sur 16");
    rerender(pas(4));
    expect(container.querySelector(".n3-pas-compteur .rt-afficheur-valeur")?.textContent).toBe(
      "04/16",
    );
  });

  it("roule au niveau tout le seul chiffre qui change", () => {
    changerNiveau("tout");
    const { container, rerender } = render(pas(3));
    rerender(pas(4));
    const roulent = [...container.querySelectorAll(".n3-pas-compteur .rt-roule")].map(
      (s) => s.textContent,
    );
    expect(roulent).toEqual(["4"]);
  });

  it("ne roule pas au niveau conseillé", () => {
    changerNiveau("conseille");
    const { container, rerender } = render(pas(3));
    rerender(pas(4));
    expect(container.querySelectorAll(".n3-pas-compteur .rt-roule")).toHaveLength(0);
    expect(container.querySelector(".n3-pas-compteur .rt-afficheur-valeur")?.textContent).toBe(
      "04/16",
    );
  });
});
