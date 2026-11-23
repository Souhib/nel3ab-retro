/** Les zones de clic posées sur le vrai dessin : à la souris, chaque pièce
 * cliquable a son disque invisible, que le plancher des inscriptions tient à
 * la taille rendue ; au doigt, le dessin n'a aucune pièce cliquable. */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Wiring } from "../../components/Wiring";
import { InputStream } from "../../media/input";
import { appliquerZones } from "./zones";

const pointeur = (grossier: boolean) =>
  vi.stubGlobal("matchMedia", (requete: string) => ({
    matches: requete === "(pointer: coarse)" ? grossier : false,
    media: requete,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

afterEach(() => vi.unstubAllGlobals());

const dessin = () => {
  const stream = new InputStream(
    () => "",
    () => {},
  );
  return render(<Wiring state={stream.state()} pad={0} selected="A" onSelect={() => {}} />)
    .container;
};

describe("les zones de clic du dessin", () => {
  it("à la souris, chaque pièce cliquable porte une zone, que la taille rendue élargit", () => {
    pointeur(false);
    const ici = dessin();
    const jeu = ici.querySelector("[data-padmap]")!;
    const boutons = jeu.querySelectorAll('[role="button"]');
    expect(boutons.length).toBeGreaterThan(10);
    for (const bouton of boutons) expect(bouton.querySelector("circle.n3-zone")).not.toBeNull();
    const zoneA = jeu.querySelector<SVGCircleElement>('[data-part="Z"] circle.n3-zone')!;
    const avant = Number(zoneA.getAttribute("r"));
    // À 1,2 px par unité, 12 px de rayon font 10 unités : la zone grandit.
    appliquerZones(jeu, 1.2);
    expect(Number(zoneA.getAttribute("r"))).toBeGreaterThan(avant);
  });

  it("au doigt, aucune pièce n'est un bouton et aucune zone n'est posée", () => {
    pointeur(true);
    const ici = dessin();
    expect(ici.querySelectorAll('[role="button"]')).toHaveLength(0);
    expect(ici.querySelectorAll("circle.n3-zone")).toHaveLength(0);
  });
});
