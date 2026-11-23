/**
 * Le rendu d'Aïn branché sur `jouer()` : ses maisons (logo, bord du
 * panneau, barre, plateau), le niveau Sobre, et la première image qui coupe
 * le plateau même sans demande.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { changerNiveau, oublierPourEssai } from "../lib/effets";
import { jouer } from "./index";

let attente = new Map<number, FrameRequestCallback>();
let suivant = 1;
const enAttente = () => attente.size;
function images(n: number) {
  for (let i = 0; i < n && attente.size; i++) {
    const lot = attente;
    attente = new Map();
    for (const f of lot.values()) f(performance.now() + i * 16);
  }
}
const visibles = () =>
  [...document.querySelectorAll<HTMLCanvasElement>(".rt-ain-sprite")]
    .filter((cv) => !cv.hidden)
    .map((cv) => cv.dataset.acteur);

beforeEach(() => {
  localStorage.clear();
  oublierPourEssai();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    attente.set(suivant, f);
    return suivant++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => attente.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({ clearRect() {}, fillRect() {}, drawImage() {} }) as unknown as CanvasRenderingContext2D,
  );
  // `jouer` du socle prend la pose clé sans `animate` (jsdom n'en a pas).
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    writable: true,
    value: () => ({}),
  });
  document.body.innerHTML = `
    <div data-cadre data-sans-image="oui" data-etat="repos">
      <div data-zone-jeu><canvas id="screen"></canvas></div>
      <div id="plateau" data-hote="plateau"></div>
      <div id="bord" data-hote="bord-panneau"></div>
      <div id="coin" data-hote="coin"></div>
      <span id="barre" data-hote="barre"></span>
    </div>`;
});
afterEach(() => {
  attente = new Map();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (Element.prototype as { animate?: unknown }).animate;
  document.body.innerHTML = "";
});
const hote = (id: string) => document.getElementById(id) as HTMLElement;

describe("les maisons d'Aïn", () => {
  it("le coin porte le logo : une toile, l'ancre du logo", () => {
    jouer("attente", { hote: hote("coin") });
    const logo = hote("coin").querySelector("canvas.rt-mascotte");
    expect(logo?.getAttribute("data-ancre")).toBe("logo");
  });

  it("le bord du panneau joue avec le personnage du coin, sans en dessiner un second", () => {
    jouer("attente", { hote: hote("coin") });
    images(200);
    const lecture = jouer("arrivee", { hote: hote("bord"), contexte: { joueur: "2" } });
    expect(lecture.refusee).toBe(false);
    expect(hote("bord").querySelector("canvas")).toBeNull();
    expect(document.querySelectorAll("canvas.rt-mascotte")).toHaveLength(1);
    expect(enAttente()).toBe(1);
  });

  it("sans logo, le bord du panneau ne joue rien", () => {
    const lecture = jouer("arrivee", { hote: hote("bord") });
    expect(enAttente()).toBe(0);
    expect(lecture.version).toBe("complete");
    expect(document.querySelector("canvas.rt-mascotte")).toBeNull();
  });

  it("la barre porte la tête seule", () => {
    jouer("fier", { hote: hote("barre") });
    expect(hote("barre").querySelector("canvas.rt-mascotte")).not.toBeNull();
  });
});

describe("le plateau", () => {
  it("joue sur l'écran noir, et une image peinte le coupe sans demande", async () => {
    jouer("chercher", { hote: hote("plateau") });
    images(20);
    expect(visibles()).toContain("ain");
    // Une image arrive : le cadre le dit, personne n'appelle la mascotte.
    document.querySelector("[data-cadre]")?.setAttribute("data-sans-image", "non");
    await Promise.resolve();
    expect(visibles()).toEqual([]);
    expect(enAttente()).toBe(0);
  });

  it("jumeau : sans image, la scène continue", async () => {
    jouer("chercher", { hote: hote("plateau") });
    images(20);
    document.querySelector("[data-cadre]")?.setAttribute("data-etat", "demarrage");
    await Promise.resolve();
    expect(visibles()).toContain("ain");
    expect(enAttente()).toBe(1);
  });
});

describe("les niveaux", () => {
  it("au niveau Sobre, la pose clé : aucune image demandée", () => {
    changerNiveau("sobre");
    jouer("arrivee", { hote: hote("coin"), contexte: { joueur: "3" } });
    expect(enAttente()).toBe(0);
    expect(visibles()).toEqual(["bulle"]);
  });

  it("jumeau : au niveau conseillé, la scène joue", () => {
    jouer("arrivee", { hote: hote("coin"), contexte: { joueur: "3" } });
    expect(enAttente()).toBe(1);
  });
});
