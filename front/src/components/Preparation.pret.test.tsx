/**
 * La scène « pret » de la préparation (chantier menus) : un joueur qui se
 * dit prêt, puis le dernier, par l'arbitre de la salle.
 */
import { render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Participant } from "../client";
import { CLE, oublierPourEssai, type Niveau } from "../lib/effets";
import type { Arbitre } from "../lib/scenes-salle";
import { ZONE_JEU } from "../lib/focus-jeu";
import { ContexteArbitre } from "./Cadre";
import { SceneRefus, useScenePret, useSceneRefus } from "./Preparation";

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

// Relecture du 24 novembre 2026 : l'effet « secousse » du plan (P10) n'était
// appelé nulle part. Un refus nouveau secoue le bloc qui l'écrit, au niveau
// « tout » seulement, et jamais ce qui touche l'image.
describe("la secousse d'un refus", () => {
  const regler = (niveau: Niveau) => {
    localStorage.setItem(CLE, JSON.stringify({ niveau, sons: false }));
    oublierPourEssai();
  };
  let secoues: Element[] = [];
  beforeEach(() => {
    secoues = [];
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      writable: true,
      value: vi.fn(function (this: Element) {
        secoues.push(this);
        return { finished: Promise.resolve(), cancel: () => {} } as unknown as Animation;
      }),
    });
  });
  afterEach(() => {
    localStorage.clear();
    oublierPourEssai();
    document.body.innerHTML = "";
  });

  it("au niveau « tout », secoue le bloc une fois par refus nouveau", () => {
    regler("tout");
    const bloc = document.body.appendChild(document.createElement("section"));
    const { rerender } = renderHook(({ r }) => useSceneRefus(r, () => bloc), {
      initialProps: { r: "" },
    });
    expect(secoues).toEqual([]);
    rerender({ r: "Refusé." });
    rerender({ r: "Refusé." });
    expect(secoues).toEqual([bloc]);
  });

  it("le jumeau : au niveau conseillé, rien ne tremble", () => {
    regler("conseille");
    const bloc = document.body.appendChild(document.createElement("section"));
    const { rerender } = renderHook(({ r }) => useSceneRefus(r, () => bloc), {
      initialProps: { r: "" },
    });
    rerender({ r: "Refusé." });
    expect(secoues).toEqual([]);
  });

  it("le refus d'un geste du menu secoue #menu, jamais un ancêtre de l'image", () => {
    regler("tout");
    document.body.innerHTML = `<section id="menu"></section>`;
    const { rerender } = render(<SceneRefus refus="" />);
    rerender(<SceneRefus refus="La salle n'a pas fermé." />);
    expect(secoues.map((e) => e.id)).toEqual(["menu"]);
    // Le jumeau : un #menu qui contiendrait la zone de jeu est refusé.
    document.body.innerHTML = `<section id="menu"><div ${ZONE_JEU}></div></section>`;
    rerender(<SceneRefus refus="Encore refusé." />);
    expect(secoues.map((e) => e.id)).toEqual(["menu"]);
  });
});
