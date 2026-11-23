/**
 * Le rendu d'Aïn branché sur `jouer()` : ses maisons (logo, bord du
 * panneau, barre, plateau), le niveau Sobre, et la première image qui coupe
 * le plateau même sans demande.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { changerNiveau, oublierPourEssai } from "../lib/effets";
import { jouer, poserMascotte } from "./index";

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

describe("un seul Aïn", () => {
  const logo = () => hote("coin").querySelector("canvas.rt-mascotte") as HTMLCanvasElement;
  const cadre = () => document.querySelector("[data-cadre]") as HTMLElement;

  it("sur le plateau, le logo du coin montre sa place en pointillés, et la retrouve à la première image", async () => {
    poserMascotte(hote("coin"));
    jouer("chercher", { hote: hote("plateau") });
    images(20);
    expect(visibles()).toContain("ain");
    expect(logo().hasAttribute("data-dehors")).toBe(true);
    cadre().setAttribute("data-sans-image", "non");
    await Promise.resolve();
    expect(logo().hasAttribute("data-dehors")).toBe(false);
  });

  it("jumeau : sans scène sur le plateau, le logo garde Aïn", () => {
    poserMascotte(hote("coin"));
    poserMascotte(hote("plateau"));
    images(20);
    expect(logo().hasAttribute("data-dehors")).toBe(false);
  });

  it("une scène du coin rentre d'abord Aïn du plateau : jamais deux", () => {
    poserMascotte(hote("coin"));
    jouer("chercher", { hote: hote("plateau") });
    images(20);
    jouer("fier", { hote: hote("coin") });
    expect(visibles().filter((a) => a === "ain").length).toBeLessThanOrEqual(1);
    expect(enAttente()).toBe(1);
    images(400);
    expect(logo().hasAttribute("data-dehors")).toBe(false);
  });
});

describe("le retour au logo", () => {
  const cadre = () => document.querySelector("[data-cadre]") as HTMLElement;
  // jsdom n'a pas de mise en page : le logo, son sol et la marque « devant »
  // reçoivent la boîte que Chrome leur donnerait au pied d'une colonne
  // (logo à 2 px par pixel d'Aïn). Sans elles, aucune ancre n'existe et la
  // scène se replie dans le logo : Aïn ne sortirait jamais.
  beforeEach(() => {
    const boites: [string, [number, number, number, number]][] = [
      ['[data-hote="coin"] > canvas', [40, 600, 228, 62]],
      ['[data-sol="coin"]', [40, 650, 228, 1]],
      ['[data-ancre="devant"]', [80, 650, 2, 1]],
    ];
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const b = boites.find(([sel]) => this.matches(sel))?.[1] ?? [0, 0, 0, 0];
        return DOMRect.fromRect({ x: b[0], y: b[1], width: b[2], height: b[3] });
      },
    );
  });

  it("Aïn resté dehors pendant une panne rentre quand la salle revit", async () => {
    cadre().setAttribute("data-sans-image", "non");
    cadre().setAttribute("data-etat", "decroche");
    jouer("decroche", { hote: hote("coin"), version: "complete" });
    images(400);
    expect(visibles()).toContain("ain");
    cadre().setAttribute("data-etat", "vit");
    await Promise.resolve();
    images(400);
    expect(visibles()).not.toContain("ain");
    expect(enAttente()).toBe(0);
  });

  it("jumeau : tant que la panne dure, il reste dehors", async () => {
    cadre().setAttribute("data-sans-image", "non");
    cadre().setAttribute("data-etat", "decroche");
    jouer("decroche", { hote: hote("coin"), version: "complete" });
    images(400);
    cadre().setAttribute("data-etat", "arret");
    await Promise.resolve();
    images(400);
    expect(visibles()).toContain("ain");
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

  it("le logo dit la version vraiment jouée, pas celle demandée", () => {
    // Sans START dans ce décor, la complète se replie, et le refus nomme
    // l'ancre : `jouer()` rend pourtant « complete », la version demandée.
    const lu = jouer("arrivee", {
      hote: hote("coin"),
      version: "complete",
      contexte: { joueur: "3" },
    });
    const logo = hote("coin").querySelector<HTMLElement>(".rt-mascotte");
    expect(lu.version).toBe("complete");
    expect(logo?.dataset.version).toMatch(/^(courte|pose|cle)$/);
    expect(logo?.dataset.refus).toContain("start-3");
    changerNiveau("sobre");
    jouer("arrivee", { hote: hote("coin"), contexte: { joueur: "3" } });
    expect(logo?.dataset.version).toBe("cle");
  });
});
