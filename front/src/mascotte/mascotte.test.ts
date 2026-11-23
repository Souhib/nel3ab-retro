/**
 * La mascotte: les scènes abstraites, la version courte, la pose clé, et le
 * refus de l'image du jeu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { oublierPourEssai } from "../lib/effets";
import { ZONE_JEU } from "../lib/focus-jeu";
import { DUREES, jouer, pourTransition, RENDU, SCENES, sceneEnCours, version } from "./index";

type Fs = { readFileSync: (chemin: string, codage: "utf-8") => string };
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
const ici = (relatif: string) => new URL(relatif, import.meta.url).pathname;

function animations() {
  const joues: { el: Element; options: KeyframeAnimationOptions }[] = [];
  const finir = vi.fn();
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    writable: true,
    value(this: Element, _images: unknown, options: KeyframeAnimationOptions) {
      joues.push({ el: this, options });
      return { finished: Promise.resolve(), finish: finir, cancel: () => {} };
    },
  });
  return { joues, finir };
}

function reduit(oui: boolean) {
  vi.stubGlobal("matchMedia", (requete: string) => ({
    matches: oui && requete.includes("reduce"),
  }));
}

beforeEach(() => {
  localStorage.clear();
  oublierPourEssai();
  reduit(false);
  document.body.innerHTML = `<aside id="coin"></aside><div id="zone" ${ZONE_JEU}><span id="dedans"></span></div>`;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (Element.prototype as { animate?: unknown }).animate;
  document.body.innerHTML = "";
});

const coin = () => document.getElementById("coin") as HTMLElement;

describe("les scènes", () => {
  it("les dix-neuf identifiants communs, chacun avec ses deux durées", () => {
    expect([...SCENES].sort()).toEqual(
      [
        "arrivee",
        "depart",
        "attente",
        "chercher",
        "premiere-image",
        "rebrancher",
        "arret",
        "coupe",
        "decroche",
        "redemarre",
        "endort",
        "dort",
        "ouvre",
        "range",
        "depot",
        "refus",
        "pret",
        "fier",
        "demo",
      ].sort(),
    );
    for (const scene of SCENES) {
      expect(DUREES[scene].courte, scene).toBeLessThanOrEqual(DUREES[scene].complete);
      if (scene !== "demo") expect(DUREES[scene].complete, scene).toBeLessThanOrEqual(2750);
    }
  });

  it("complète la première fois dans ce navigateur, courte ensuite", () => {
    expect(version("arrivee")).toBe("complete");
    expect(version("arrivee")).toBe("courte");
    // Une autre scène a sa propre première fois.
    expect(version("depart")).toBe("complete");
    // Une version demandée est jouée telle quelle, et ne compte pas.
    expect(version("ouvre", "courte")).toBe("courte");
    expect(version("ouvre")).toBe("complete");
  });

  it("une mémoire illisible ou refusée rejoue la version complète", () => {
    localStorage.setItem("nel3ab:mascotte-vues", "{cassé");
    expect(version("pret")).toBe("complete");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("refusé");
    });
    expect(version("pret")).toBe("complete");
    vi.restoreAllMocks();
  });
});

describe("jouer", () => {
  it("dessine le personnage dans l'hôte et joue la scène, complète puis courte", async () => {
    const { joues } = animations();
    const premiere = jouer("arrivee", { hote: coin() });
    expect(coin().classList.contains("rt-mascotte-hote")).toBe(true);
    expect(coin().querySelectorAll(".rt-mascotte")).toHaveLength(1);
    expect(premiere.version).toBe("complete");
    expect(joues[0]?.options.duration).toBe(DUREES.arrivee.complete);
    await premiere.fini;
    const seconde = jouer("arrivee", { hote: coin() });
    expect(seconde.version).toBe("courte");
    expect(joues[1]?.options.duration).toBe(DUREES.arrivee.courte);
    // Toujours un seul personnage.
    expect(coin().querySelectorAll(".rt-mascotte")).toHaveLength(1);
  });

  it("une nouvelle scène finit la précédente", () => {
    const { finir } = animations();
    jouer("chercher", { hote: coin() });
    expect(sceneEnCours(coin())).toBe("chercher");
    jouer("premiere-image", { hote: coin() });
    expect(finir).toHaveBeenCalledTimes(1);
    expect(sceneEnCours(coin())).toBe("premiere-image");
  });

  it("refuse un hôte sur l'image du jeu, sans rien dessiner", () => {
    const { joues } = animations();
    const dedans = document.getElementById("dedans") as HTMLElement;
    const lecture = jouer("fier", { hote: dedans });
    expect(lecture.refusee).toBe(true);
    expect(dedans.querySelector(".rt-mascotte")).toBeNull();
    const zone = document.getElementById("zone") as HTMLElement;
    expect(jouer("fier", { hote: zone }).refusee).toBe(true);
    expect(joues).toHaveLength(0);
  });

  it("en mouvement réduit, la pose clé seule, et la phrase reste", () => {
    const { joues } = animations();
    reduit(true);
    const region = document.createElement("p");
    const lecture = jouer("endort", { hote: coin(), region, phrase: "La salle va fermer." });
    expect(lecture.version).toBeNull();
    expect(joues).toHaveLength(0);
    expect(region.textContent).toBe("La salle va fermer.");
    const el = coin().querySelector(".rt-mascotte") as HTMLElement;
    expect(el.dataset.scene).toBe("endort");
    expect(el.dataset.tourne).toBe("non");
    expect(el.style.opacity).toBe("0.5");
  });

  it("refuse une scène inconnue", () => {
    expect(() => jouer("danse" as never, { hote: coin() })).toThrow();
  });

  it("l'hôte coupe ce qui dépasse: une scène ne sort pas de sa boîte", () => {
    const css = fs.readFileSync(ici("../effets.css"), "utf-8");
    expect(css).toMatch(/\.rt-mascotte-hote \{[^}]*overflow: hidden;/);
  });

  it("le rendu se remplace en un seul endroit", () => {
    // Le contrat: chaque scène a sa pose clé dans le rendu en service.
    animations();
    const el = RENDU.dessiner(coin());
    for (const scene of SCENES) {
      expect(() => RENDU.poseCle(el, scene), scene).not.toThrow();
      expect(RENDU.jouer(el, scene, "courte"), scene).toHaveLength(1);
    }
  });
});

describe("quelle scène pour quel changement", () => {
  it("chaque état de la salle a sa scène", () => {
    expect(pourTransition(null, "connexion")).toEqual({ scene: "rebrancher", version: "complete" });
    expect(pourTransition("coupee", "connexion")).toEqual({
      scene: "rebrancher",
      version: "courte",
    });
    expect(pourTransition("repos", "demarrage")?.scene).toBe("chercher");
    expect(pourTransition("demarrage", "vit")?.scene).toBe("premiere-image");
    expect(pourTransition("vit", "figee")?.scene).toBe("arret");
    expect(pourTransition("vit", "coupee")?.scene).toBe("coupe");
    expect(pourTransition("vit", "injoignable")?.scene).toBe("decroche");
    expect(pourTransition("repos", "fermeture")?.scene).toBe("endort");
    expect(pourTransition("fermeture", "fermee")?.scene).toBe("dort");
    expect(pourTransition(null, "repos")?.scene).toBe("attente");
  });

  it("rien quand rien ne change, ni quand l'image revient d'ailleurs", () => {
    expect(pourTransition("vit", "vit")).toBeNull();
    expect(pourTransition("figee", "vit")).toBeNull();
  });

  it("pendant une partie, seuls l'arrivée, le départ et « prêt » se jouent", () => {
    expect(pourTransition(null, null, { evenement: "place", enPartie: true })?.scene).toBe(
      "arrivee",
    );
    expect(pourTransition(null, null, { evenement: "spectateur", enPartie: true })?.scene).toBe(
      "depart",
    );
    expect(pourTransition(null, null, { evenement: "fier", enPartie: true })).toBeNull();
    expect(pourTransition(null, "repos", { enPartie: true })).toBeNull();
    expect(pourTransition("vit", "figee", { enPartie: true })).toBeNull();
  });

  it("dit la version courte quand la scène a déjà été vue", () => {
    expect(pourTransition(null, null, { evenement: "salle-ouverte", dejaVu: true })).toEqual({
      scene: "ouvre",
      version: "courte",
    });
  });

  it("un état ou un événement inconnu est une erreur, pas un silence", () => {
    expect(() => pourTransition(null, "dodo" as never)).toThrow();
    expect(() => pourTransition(null, null, { evenement: "toString" as never })).toThrow();
  });
});
