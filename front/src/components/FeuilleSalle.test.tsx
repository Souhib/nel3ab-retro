import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { entreesDeLaFeuille } from "../lib/feuille";
import { BarreSalle } from "./BarreSalle";
import { FeuilleSalle } from "./FeuilleSalle";

const RECT = { x: 0, y: 412, w: 390, h: 432 };
const ENTREES = entreesDeLaFeuille({
  sonCoupe: false,
  manette: "montree",
  plein: "ecran-accueil",
  pleinActif: false,
});

describe("la feuille « La salle »", () => {
  it("porte les gestes de la partie à mi-hauteur, et pas la colonne", () => {
    render(
      <FeuilleSalle
        hauteur="mi"
        rect={RECT}
        titre="Salle 1"
        entrees={ENTREES}
        onEntree={vi.fn()}
        onFermer={vi.fn()}
      >
        <aside id="side" />
      </FeuilleSalle>,
    );
    const feuille = document.querySelector<HTMLDialogElement>("#feuilleSalle");
    expect(feuille?.dataset.hauteur).toBe("mi");
    expect(feuille?.style.top).toBe("412px");
    expect(screen.getByRole("button", { name: /Toute la salle/ })).toBeTruthy();
    // Le jumeau : la colonne n'est montée qu'agrandie.
    expect(document.querySelector("#side")).toBeNull();
  });

  it("agrandie, porte la colonne et plus les gestes", () => {
    render(
      <FeuilleSalle
        hauteur="agrandie"
        rect={RECT}
        titre="Salle 1"
        entrees={ENTREES}
        onEntree={vi.fn()}
        onFermer={vi.fn()}
      >
        <aside id="side" />
      </FeuilleSalle>,
    );
    expect(document.querySelector("#side")).not.toBeNull();
    expect(document.querySelector("[data-entree]")).toBeNull();
  });

  it("remonte « Toute la salle » pour être agrandie, et garde l'écran d'accueil pour elle", () => {
    const onEntree = vi.fn();
    render(
      <FeuilleSalle
        hauteur="mi"
        rect={RECT}
        titre="Salle 1"
        entrees={ENTREES}
        onEntree={onEntree}
        onFermer={vi.fn()}
      >
        {null}
      </FeuilleSalle>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Toute la salle/ }));
    expect(onEntree).toHaveBeenCalledWith("toute-la-salle");
    fireEvent.click(screen.getByRole("button", { name: /écran d'accueil/ }));
    expect(onEntree).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#aideEcranAccueil")).not.toBeNull();
  });

  it("se ferme par « Fermer », nommé en mots", () => {
    const onFermer = vi.fn();
    render(
      <FeuilleSalle
        hauteur="mi"
        rect={RECT}
        titre="Salle 1"
        entrees={ENTREES}
        onEntree={vi.fn()}
        onFermer={onFermer}
      >
        {null}
      </FeuilleSalle>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(onFermer).toHaveBeenCalledTimes(1);
  });
});

describe("la barre de la salle", () => {
  const RECT_BARRE = { x: 0, y: 47, w: 390, h: 52 };

  it("ouvre la feuille par « La salle », qui dit le son coupé en mots", () => {
    const onSalle = vi.fn();
    render(
      <BarreSalle
        rect={RECT_BARRE}
        nomSalle="Salle 1"
        jeu="Mario Kart"
        sonCoupe
        onSalle={onSalle}
      />,
    );
    const bouton = document.querySelector<HTMLButtonElement>("#laSalle");
    expect(bouton?.getAttribute("aria-label")).toMatch(/^Son coupé\./);
    expect(bouton?.dataset.geste).toBe("feuille");
    fireEvent.click(bouton as HTMLButtonElement);
    expect(onSalle).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Mario Kart")).toBeTruthy();
  });

  it("ne dit pas le son coupé quand il joue, et n'écrit pas de jeu sans jeu", () => {
    render(
      <BarreSalle
        rect={RECT_BARRE}
        nomSalle="Salle 1"
        jeu={null}
        sonCoupe={false}
        onSalle={vi.fn()}
      />,
    );
    expect(document.querySelector("#laSalle")?.getAttribute("aria-label")).not.toMatch(/Son coupé/);
    expect(document.querySelector("#jeuDeLaBarre")).toBeNull();
  });
});
