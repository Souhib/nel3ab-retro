/**
 * La fiche d'une décision, partagée par le menu et le rayonnage : qui ne
 * choisit pas la lit sans bouton qui agit (B8), et ses identifiants suivent
 * sa base.
 */
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FicheDeLigne } from "../../lib/menu";
import { Fiche } from "./Fiche";

const fiche = (plus: Partial<FicheDeLigne> = {}): FicheDeLigne => ({
  consequence: "Kart des Ruelles s'arrête pour les 4 joueurs.",
  agir: "Lancer",
  annuler: "Revenir à la liste",
  choix: [
    { id: "neuve", label: "nouvelle partie" },
    { id: "mienne", label: "ma sauvegarde" },
  ],
  suite: "Le jeu part tout de suite.",
  onAgir: vi.fn(),
  ...plus,
});

describe("Fiche", () => {
  it("qui choisit : la barre [data-lancer], « Lancer » sur le choix coché, et ce qui suit", () => {
    const f = fiche();
    const { container } = render(
      <Fiche
        titre="Tennis Lunaire"
        fiche={f}
        coche="mienne"
        onCocher={() => {}}
        onRevenir={() => {}}
      />,
    );
    expect(container.querySelector("[data-lancer]")).not.toBeNull();
    expect(container.textContent).toContain("Le jeu part tout de suite.");
    fireEvent.click(document.getElementById("ficheAgir")!);
    expect(f.onAgir).toHaveBeenCalledWith("mienne");
  });

  it("qui ne choisit pas : la phrase de qui choisit, aucun bouton qui agit, des choix grisés", () => {
    const f = fiche({ refus: "Lina choisit le jeu et la sauvegarde." });
    const { container } = render(
      <Fiche
        titre="Tennis Lunaire"
        fiche={f}
        coche="neuve"
        onCocher={() => {}}
        onRevenir={() => {}}
      />,
    );
    expect(container.querySelector("[data-lancer]")).toBeNull();
    expect(document.getElementById("ficheAgir")).toBeNull();
    expect(container.textContent).toContain("Lina choisit le jeu et la sauvegarde.");
    expect(container.textContent).not.toContain("Kart des Ruelles");
    expect(container.textContent).not.toContain("tout de suite");
    expect((document.getElementById("ficheChoix") as HTMLFieldSetElement).disabled).toBe(true);
    // « Revenir » reste : la fiche se ferme comme elle s'ouvre.
    expect(document.getElementById("ficheRevenir")).not.toBeNull();
  });

  it("préfixe ses identifiants par sa base, pour tenir à côté de celle du menu", () => {
    render(
      <>
        <Fiche titre="A" fiche={fiche()} coche="neuve" onCocher={() => {}} onRevenir={() => {}} />
        <Fiche
          titre="B"
          base="ficheJeu"
          fiche={fiche()}
          coche="neuve"
          onCocher={() => {}}
          onRevenir={() => {}}
        />
      </>,
    );
    for (const id of [
      "fiche",
      "ficheJeu",
      "ficheAgir",
      "ficheJeuAgir",
      "fiche-neuve",
      "ficheJeu-neuve",
    ])
      expect(document.querySelectorAll(`#${id}`), id).toHaveLength(1);
    // Deux groupes de radios distincts : cocher l'un ne décoche pas l'autre.
    const noms = [...document.querySelectorAll<HTMLInputElement>("input[type=radio]")].map(
      (r) => r.name,
    );
    expect(new Set(noms)).toEqual(new Set(["fiche-choix", "ficheJeu-choix"]));
  });

  it("occupée : choix et « Lancer » grisés tant que les sauvegardes se lisent", () => {
    render(
      <Fiche
        titre="Tennis Lunaire"
        fiche={fiche({ occupe: true })}
        coche="neuve"
        onCocher={() => {}}
        onRevenir={() => {}}
      />,
    );
    expect((document.getElementById("ficheAgir") as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById("ficheChoix") as HTMLFieldSetElement).disabled).toBe(true);
  });

  it("le jumeau : une fiche prête laisse agir et choisir", () => {
    render(
      <Fiche titre="T" fiche={fiche()} coche="neuve" onCocher={() => {}} onRevenir={() => {}} />,
    );
    expect((document.getElementById("ficheAgir") as HTMLButtonElement).disabled).toBe(false);
    expect((document.getElementById("ficheChoix") as HTMLFieldSetElement).disabled).toBe(false);
  });
});
