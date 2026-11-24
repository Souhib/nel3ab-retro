/**
 * Fermer le jeu, fermer la salle (chantier menus, relecture du 24 novembre
 * 2026) : la transition du socle, dans le bon ordre, et rien sur un refus.
 *
 * `Element.animate` n'existe pas dans jsdom : chaque animation est un double
 * dont la fin se déclenche à la main, pour prouver ce qui attend quoi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLE, oublierPourEssai, type Niveau } from "../../lib/effets";
import { fermerLaSalle, fermerLeJeu, refusDeFermeture } from "./gestes";

type Lancee = { el: Element; images: Keyframe[]; finir: () => void };
let lancees: Lancee[] = [];

beforeEach(() => {
  lancees = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    writable: true,
    value: vi.fn(function (this: Element, images: Keyframe[]) {
      let finir = () => {};
      const finished = new Promise<void>((fin) => {
        finir = fin;
      });
      lancees.push({ el: this, images, finir });
      return { finished, cancel: () => {} } as unknown as Animation;
    }),
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

afterEach(() => {
  localStorage.clear();
  oublierPourEssai();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const regler = (niveau: Niveau) => {
  localStorage.setItem(CLE, JSON.stringify({ niveau, sons: false }));
  oublierPourEssai();
};
/** Laisse passer les promesses en attente. */
const laisser = () => new Promise((fin) => setTimeout(fin, 0));

describe("fermer la salle", () => {
  it("ne part qu'après la fin de l'extinction", async () => {
    regler("conseille");
    const racine = document.body.appendChild(document.createElement("div"));
    const partir = vi.fn();
    const refus = vi.fn();
    const fin = fermerLaSalle({
      fermer: () => Promise.resolve(),
      partir,
      surface: () => racine,
      refus,
    });
    await laisser();
    expect(lancees).toHaveLength(1);
    expect(lancees[0]!.el).toBe(racine);
    expect(JSON.stringify(lancees[0]!.images)).toContain("scale(0, 0)");
    expect(partir).not.toHaveBeenCalled();
    lancees[0]!.finir();
    await laisser();
    expect(partir).toHaveBeenCalledTimes(1);
    // La suite de l'animation, pour que la promesse finisse.
    await new Promise((f) => setTimeout(f, 300));
    for (const l of lancees.slice(1)) l.finir();
    await fin;
    expect(refus).not.toHaveBeenCalled();
  });

  it("le jumeau : mouvement réduit, la page part tout de suite", async () => {
    regler("tout");
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    const partir = vi.fn();
    await fermerLaSalle({
      fermer: () => Promise.resolve(),
      partir,
      surface: () => document.body,
      refus: vi.fn(),
    });
    expect(partir).toHaveBeenCalledTimes(1);
    expect(lancees).toHaveLength(0);
  });

  it("un refus du salon : ni extinction ni départ, la phrase du refus", async () => {
    regler("tout");
    const partir = vi.fn();
    const refus = vi.fn();
    await fermerLaSalle({
      fermer: () => Promise.reject({ detail: "une partie tourne" }),
      partir,
      surface: () => document.body,
      refus,
    });
    expect(refus).toHaveBeenCalledWith("La salle n'a pas fermé : une partie tourne.");
    expect(partir).not.toHaveBeenCalled();
    expect(lancees).toHaveLength(0);
    expect(refusDeFermeture(new Error("x"))).toBe("La salle n'a pas pu fermer. Réessaie.");
  });
});

describe("fermer le jeu", () => {
  it("au niveau « tout », l'iris se referme sur le menu avant « Fermeture… »", async () => {
    regler("tout");
    const menu = document.body.appendChild(document.createElement("section"));
    const enCours = vi.fn();
    const fin = fermerLeJeu({
      fermer: () => Promise.resolve(),
      enCours,
      surface: () => menu,
      refus: vi.fn(),
    });
    await laisser();
    expect(lancees).toHaveLength(1);
    expect(lancees[0]!.el).toBe(menu);
    expect(JSON.stringify(lancees[0]!.images)).toContain("circle(0% at 50% 50%)");
    expect(enCours).not.toHaveBeenCalled();
    lancees[0]!.finir();
    await laisser();
    expect(enCours).toHaveBeenCalledTimes(1);
    lancees[1]!.finir();
    await fin;
  });

  it("le jumeau : un refus n'anime rien et s'écrit", async () => {
    regler("tout");
    const enCours = vi.fn();
    const refus = vi.fn();
    await fermerLeJeu({
      fermer: () => Promise.reject(new Error("Le jeu ne se ferme pas.")),
      enCours,
      surface: () => document.body,
      refus,
    });
    expect(refus).toHaveBeenCalledWith("Le jeu ne se ferme pas.");
    expect(enCours).not.toHaveBeenCalled();
    expect(lancees).toHaveLength(0);
  });
});
