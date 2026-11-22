import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Liaison } from "../media/liaison";
import { EtatSalle } from "./EtatSalle";
import { LigneParlee } from "./LigneParlee";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function montrer(liaison: Liaison) {
  const gestes = {
    onRelancer: vi.fn(),
    onReessayer: vi.fn(),
    onQuitter: vi.fn(),
    onSignaler: vi.fn().mockResolvedValue(undefined),
    onReduire: vi.fn(),
    onGarder: vi.fn(),
    onPropositionVue: vi.fn(),
  };
  const rendu = render(<EtatSalle liaison={liaison} salle={1} {...gestes} />);
  return { ...gestes, ...rendu };
}

const gel = (depuisMs: number, niveau: "pastille" | "bandeau"): Liaison => ({
  etat: "figee",
  depuisMs,
  son: true,
  manette: true,
  niveau,
});

describe("l'image figée, dite sur l'image", () => {
  it("un bandeau avec la phrase, le fait, et les deux gestes qui marchent", () => {
    const { onRelancer } = montrer(gel(14_000, "bandeau"));
    const bandeau = document.querySelector("#liaison");
    expect(bandeau).not.toBeNull();
    expect(bandeau?.getAttribute("data-etat")).toBe("figee");
    expect(screen.getByText("L'image ne bouge plus depuis 14 s.")).toBeVisible();
    expect(screen.getByText("Le son arrive encore: le jeu tourne sur la machine.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Relancer l'image" }));
    expect(onRelancer).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Signaler" })).toBeEnabled();
  });

  it("une pastille d'abord, sans bouton qui gênerait la partie", () => {
    montrer(gel(3000, "pastille"));
    expect(screen.getByText("Image figée")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("jumeau: une salle qui va bien n'affiche rien", () => {
    const { container } = montrer({ etat: "ok" });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("les pannes, chacune avec son geste", () => {
  it("la salle fermée renvoie à la liste des salles", () => {
    montrer({ etat: "fermee" });
    expect(screen.getByText("La salle 1 est fermée.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Les salles" })).toHaveAttribute("href", "/");
  });

  it("la salle injoignable propose de réessayer tout de suite", () => {
    const { onReessayer } = montrer({ etat: "injoignable", siteRepond: true, depuisMs: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(onReessayer).toHaveBeenCalledTimes(1);
  });
});

describe("l'arrivée", () => {
  const arrivee = (perdue: boolean): Liaison => ({
    etat: "arrivee",
    etape: "image",
    depuisMs: perdue ? 16_000 : 2000,
    perdue,
    salleRepond: true,
  });

  it("montre ses étapes sans sortie tant que l'attente est normale", () => {
    montrer(arrivee(false));
    expect(screen.getByText("la salle répond")).toBeVisible();
    expect(screen.getByText("première image")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("à quinze secondes, propose de réessayer ou de quitter, et les deux marchent", () => {
    const { onReessayer, onQuitter } = montrer(arrivee(true));
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    fireEvent.click(screen.getByRole("button", { name: "Quitter la salle" }));
    expect(onReessayer).toHaveBeenCalledTimes(1);
    expect(onQuitter).toHaveBeenCalledTimes(1);
  });
});

describe("la proposition de format réduit (E3)", () => {
  it("se note « proposée » une seule fois, quand elle est affichée", () => {
    const { onPropositionVue, onReduire, rerender } = montrer({ etat: "irreguliere" });
    expect(onPropositionVue).toHaveBeenCalledTimes(1);
    rerender(
      <EtatSalle
        liaison={{ etat: "irreguliere" }}
        salle={1}
        onRelancer={vi.fn()}
        onReessayer={vi.fn()}
        onQuitter={vi.fn()}
        onSignaler={vi.fn()}
        onReduire={onReduire}
        onGarder={vi.fn()}
        onPropositionVue={onPropositionVue}
      />,
    );
    expect(onPropositionVue).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Passer en réduit" }));
    expect(onReduire).toHaveBeenCalledTimes(1);
  });

  it("jumeau: une proposition cachée par un gel n'est pas notée", () => {
    const { onPropositionVue } = montrer(gel(9000, "bandeau"));
    expect(screen.queryByRole("button", { name: "Passer en réduit" })).toBeNull();
    expect(onPropositionVue).not.toHaveBeenCalled();
  });
});

describe("la ligne parlée", () => {
  it("existe dès le départ, vide, polie et atomique", () => {
    render(<LigneParlee liaison={{ etat: "ok" }} salle={1} demande={null} delai={10} />);
    const ligne = screen.getByRole("status");
    expect(ligne).toHaveAttribute("aria-atomic", "true");
    expect(ligne).toHaveTextContent("");
  });

  it("dit le changement d'état, et ne se réécrit pas quand seule la durée avance", () => {
    const { rerender } = render(
      <LigneParlee liaison={{ etat: "ok" }} salle={1} demande={null} delai={10} />,
    );
    rerender(<LigneParlee liaison={gel(3000, "pastille")} salle={1} demande={null} delai={10} />);
    const ligne = screen.getByRole("status");
    expect(ligne).toHaveTextContent("L'image ne bouge plus. Le son arrive encore.");
    const noeud = ligne.firstChild;
    rerender(<LigneParlee liaison={gel(14_000, "bandeau")} salle={1} demande={null} delai={10} />);
    expect(ligne.firstChild).toBe(noeud);
    expect(ligne).toHaveTextContent("L'image ne bouge plus. Le son arrive encore.");
    rerender(<LigneParlee liaison={{ etat: "ok" }} salle={1} demande={null} delai={10} />);
    expect(ligne).toHaveTextContent("L'image est revenue.");
  });

  it("annonce une demande de manette une fois, sans décompte", () => {
    const { rerender } = render(
      <LigneParlee liaison={{ etat: "ok" }} salle={1} demande={null} delai={10} />,
    );
    rerender(
      <LigneParlee
        liaison={{ etat: "ok" }}
        salle={1}
        demande={{ from: "Lina", port: 2 }}
        delai={10}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Lina demande ta manette 2. Tu as 10 secondes pour répondre. Sans réponse, tu la gardes.",
    );
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole("status").textContent).not.toMatch(/\b7\b/);
  });
});
