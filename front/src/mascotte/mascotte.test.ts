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

/** Les images à la main, et des toiles qui ne peignent rien (jsdom n'a pas
 * de contexte 2D). */
function images() {
  let attente = new Map<number, FrameRequestCallback>();
  let suivant = 1;
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    attente.set(suivant, f);
    return suivant++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => attente.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({ clearRect() {}, fillRect() {}, drawImage() {} }) as unknown as CanvasRenderingContext2D,
  );
  const une = (ms = 16) => {
    const lot = attente;
    attente = new Map();
    for (const f of lot.values()) f(performance.now() + ms);
  };
  return {
    get enAttente() {
      return attente.size;
    },
    /** Une image : ce qui attendait, une fois. */
    une,
    vider(max = 2000) {
      for (let n = 0; attente.size > 0; n++) {
        if (n > max) throw new Error("une boucle tourne encore");
        une(n * 16);
      }
    },
  };
}
const visibles = () =>
  [...document.querySelectorAll<HTMLCanvasElement>(".rt-ain-sprite")]
    .filter((cv) => !cv.hidden)
    .map((cv) => cv.dataset.acteur);

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
  vi.restoreAllMocks();
  for (const calque of document.querySelectorAll(".rt-ain-calque")) calque.remove();
  delete (Element.prototype as { animate?: unknown }).animate;
  document.body.innerHTML = "";
});

const coin = () => document.getElementById("coin") as HTMLElement;

describe("les scènes", () => {
  it("les vingt-deux identifiants communs, chacun avec ses deux durées", () => {
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
        "spectateur",
        "attente-chargement",
        "hoquet",
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
  it("dessine Aïn dans l'hôte et joue la scène, complète puis courte", async () => {
    animations();
    const h = images();
    const premiere = jouer("arrivee", { hote: coin() });
    expect(coin().classList.contains("rt-mascotte-hote")).toBe(true);
    expect(coin().querySelectorAll(".rt-mascotte")).toHaveLength(1);
    expect(premiere.version).toBe("complete");
    // Une scène demande des images tant qu'elle joue, plus après.
    expect(h.enAttente).toBe(1);
    h.vider();
    await premiere.fini;
    const seconde = jouer("arrivee", { hote: coin() });
    expect(seconde.version).toBe("courte");
    h.vider();
    await seconde.fini;
    expect(h.enAttente).toBe(0);
    // Toujours un seul personnage.
    expect(coin().querySelectorAll(".rt-mascotte")).toHaveLength(1);
  });

  it("une nouvelle scène finit la précédente ; la première image rentre Aïn", () => {
    animations();
    const h = images();
    jouer("chercher", { hote: coin() });
    expect(sceneEnCours(coin())).toBe("chercher");
    // Quelques images : la scène joue.
    for (let i = 0; i < 3; i++) h.une();
    expect(h.enAttente).toBe(1);
    jouer("premiere-image", { hote: coin() });
    expect(sceneEnCours(coin())).toBe("premiere-image");
    expect(visibles()).toEqual([]);
    expect(h.enAttente).toBe(0);
  });

  it("refuse un hôte sur l'image du jeu, sans rien dessiner", () => {
    const { joues } = animations();
    images();
    const dedans = document.getElementById("dedans") as HTMLElement;
    const lecture = jouer("fier", { hote: dedans });
    expect(lecture.refusee).toBe(true);
    expect(dedans.querySelector(".rt-mascotte")).toBeNull();
    const zone = document.getElementById("zone") as HTMLElement;
    expect(jouer("fier", { hote: zone }).refusee).toBe(true);
    expect(joues).toHaveLength(0);
    expect(document.querySelector(".rt-ain-calque")).toBeNull();
  });

  it("en mouvement réduit, la pose clé seule, sans image demandée, et la phrase reste", () => {
    animations();
    const h = images();
    reduit(true);
    const region = document.createElement("p");
    const lecture = jouer("endort", { hote: coin(), region, phrase: "La salle va fermer." });
    expect(lecture.version).toBeNull();
    expect(h.enAttente).toBe(0);
    expect(region.textContent).toBe("La salle va fermer.");
    // La pose clé : Aïn dans le logo, le « z » au-dessus.
    expect(visibles()).toEqual(["bulle"]);
  });

  it("refuse une scène inconnue", () => {
    expect(() => jouer("danse" as never, { hote: coin() })).toThrow();
  });

  it("le calque des sprites ne prend pas le pointeur et vit hors de la zone de jeu", () => {
    const css = fs.readFileSync(ici("../effets.css"), "utf-8");
    expect(css).toMatch(/\.rt-ain-calque \{[^}]*pointer-events: none;/);
    images();
    jouer("arrivee", { hote: coin() });
    const calque = document.querySelector(".rt-ain-calque");
    expect(calque?.closest(`[${ZONE_JEU}]`)).toBeNull();
  });

  it("le rendu se remplace en un seul endroit", () => {
    // Le contrat: chaque scène a sa pose clé dans le rendu en service.
    animations();
    images();
    expect(RENDU.nom).toBe("Aïn");
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

  it("pendant une partie, seules les scènes du logo se jouent", () => {
    expect(pourTransition(null, null, { evenement: "place", enPartie: true })?.scene).toBe(
      "arrivee",
    );
    expect(pourTransition(null, null, { evenement: "spectateur", enPartie: true })?.scene).toBe(
      "spectateur",
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
