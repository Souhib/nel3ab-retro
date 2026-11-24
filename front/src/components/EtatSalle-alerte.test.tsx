/**
 * La secousse de la fiche et le son grave à l'entrée d'une panne (plan
 * etats, effets « secousse » et « sons »). Le socle décide s'ils jouent
 * (niveau « tout », sons allumés, jeu sans le focus) ; ici, on vérifie
 * QUAND la fiche et la scène les demandent : à l'entrée seulement.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { modeleEtat } from "../lib/etat-modele";
import { GardeSignalement } from "../lib/garde-signalement";
import type { Liaison } from "../media/liaison";

const secouer = vi.fn((_el: HTMLElement) => true);
const sonMenu = vi.fn((_son: string) => true);
vi.mock("../retro/secousse", () => ({ secouer: (el: HTMLElement) => secouer(el) }));
vi.mock("../retro/sons", () => ({ sonMenu: (son: string) => sonMenu(son) }));

const { FicheEtat, ScenesDesEtats } = await import("./EtatSalle");

beforeEach(() => {
  secouer.mockClear();
  sonMenu.mockClear();
});

const rappels = () => ({
  onRelancer: vi.fn(),
  onReessayer: vi.fn(),
  onQuitter: vi.fn(),
  onSignaler: vi.fn().mockResolvedValue(undefined),
  garde: new GardeSignalement(),
  onReduire: vi.fn(),
  onGarder: vi.fn(),
  onRester: vi.fn(),
  onRevenir: vi.fn(),
  onGarderLegere: vi.fn(),
});
const modele = (liaison: Liaison) =>
  modeleEtat({
    liaison,
    salle: 1,
    contexte: { salon: true },
    fermeDans: 0,
    place: true,
    legerePassee: false,
    legere: false,
    neige: true,
  });
const gel: Liaison = {
  etat: "figee",
  depuisMs: 9000,
  son: true,
  manette: true,
  niveau: "bandeau",
  apresRelance: false,
};
const coupee = (depuisMs: number): Liaison => ({ etat: "coupee", cause: "reseau", depuisMs });

describe("la secousse de la fiche", () => {
  it("secoue la fiche quand une panne la remplace", () => {
    const r = rappels();
    const { rerender } = render(
      <FicheEtat modele={modele(gel)} rappels={r} onPropositionVue={vi.fn()} />,
    );
    expect(secouer).not.toHaveBeenCalled();
    rerender(<FicheEtat modele={modele(coupee(1000))} rappels={r} onPropositionVue={vi.fn()} />);
    expect(secouer).toHaveBeenCalledTimes(1);
    expect(secouer.mock.calls[0]?.[0]).toBe(document.querySelector("#liaison"));
  });
  it("jumeau : ni au montage (la feuille qui s'ouvre plus tard), ni quand la durée avance", () => {
    const r = rappels();
    const { rerender } = render(
      <FicheEtat modele={modele(coupee(1000))} rappels={r} onPropositionVue={vi.fn()} />,
    );
    rerender(<FicheEtat modele={modele(coupee(4000))} rappels={r} onPropositionVue={vi.fn()} />);
    expect(secouer).not.toHaveBeenCalled();
  });
});

describe("le son grave d'une panne", () => {
  const hote = () => null;
  it("joue une fois à l'entrée de la coupure, même sans arbitre ni hôte", () => {
    const { rerender } = render(
      <ScenesDesEtats moment={{ liaison: { etat: "ok" }, fermeDans: 0 }} hote={hote} />,
    );
    rerender(<ScenesDesEtats moment={{ liaison: coupee(1000), fermeDans: 0 }} hote={hote} />);
    rerender(<ScenesDesEtats moment={{ liaison: coupee(4000), fermeDans: 0 }} hote={hote} />);
    expect(sonMenu.mock.calls).toEqual([["erreur"]]);
  });
  it("jumeau : une image figée ne fait pas de bruit", () => {
    const { rerender } = render(
      <ScenesDesEtats moment={{ liaison: { etat: "ok" }, fermeDans: 0 }} hote={hote} />,
    );
    rerender(<ScenesDesEtats moment={{ liaison: gel, fermeDans: 0 }} hote={hote} />);
    expect(sonMenu).not.toHaveBeenCalled();
  });
});
