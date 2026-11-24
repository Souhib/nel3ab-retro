/**
 * La scène « pret » de la préparation (chantier menus) : un joueur qui se
 * dit prêt, puis le dernier, par l'arbitre de la salle.
 */
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Participant } from "../client";
import type { Arbitre } from "../lib/scenes-salle";
import { ContexteArbitre } from "./Cadre";
import { useScenePret, useSceneRefus } from "./Preparation";

const joueur = (claim: string, ready: boolean): Participant => ({
  port: 1,
  claim,
  name: claim,
  ready,
  pad: null,
});

describe("useScenePret", () => {
  it("joue « un », puis « tous », et rien sur le même message", () => {
    const demander = vi.fn<Arbitre["demander"]>(() => null);
    const a: Arbitre = { demander, couper: vi.fn(), enCours: () => null };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ContexteArbitre.Provider value={a}>{children}</ContexteArbitre.Provider>
    );
    const debut = [joueur("a", false), joueur("b", false)];
    const un = [joueur("a", true), joueur("b", false)];
    const tous = [joueur("a", true), joueur("b", true)];
    const { rerender } = renderHook(({ p }) => useScenePret(p), {
      wrapper,
      initialProps: { p: debut },
    });
    // L'arrivée ne joue rien.
    expect(demander).not.toHaveBeenCalled();
    rerender({ p: un });
    rerender({ p: [...un] });
    rerender({ p: tous });
    expect(demander.mock.calls.map((c) => [c[0].scene, c[0].par, c[0].contexte?.mode])).toEqual([
      ["pret", "menus", "un"],
      ["pret", "menus", "tous"],
    ]);
  });
});

describe("useSceneRefus", () => {
  it("joue « refus » pour un refus nouveau, une fois, et rien sans refus", () => {
    const demander = vi.fn<Arbitre["demander"]>(() => null);
    const a: Arbitre = { demander, couper: vi.fn(), enCours: () => null };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ContexteArbitre.Provider value={a}>{children}</ContexteArbitre.Provider>
    );
    const { rerender } = renderHook(({ r }) => useSceneRefus(r), {
      wrapper,
      initialProps: { r: "" },
    });
    expect(demander).not.toHaveBeenCalled();
    rerender({ r: "Le jeu ne se ferme pas." });
    // Le même texte rendu deux fois ne rejoue rien.
    rerender({ r: "Le jeu ne se ferme pas." });
    expect(demander.mock.calls.map((c) => [c[0].scene, c[0].par])).toEqual([["refus", "menus"]]);
    // Effacé puis revenu : c'est un nouveau refus.
    rerender({ r: "" });
    rerender({ r: "Le jeu ne se ferme pas." });
    expect(demander).toHaveBeenCalledTimes(2);
  });
});
