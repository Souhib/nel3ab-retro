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
    expect(logo?.dataset.refus).toBe("");
  });

  it("en mouvement réduit aussi, le logo dit la pose clé, pas la scène d'avant", () => {
    jouer("arrivee", { hote: hote("coin"), version: "complete", contexte: { joueur: "3" } });
    const logo = hote("coin").querySelector<HTMLElement>(".rt-mascotte");
    expect(logo?.dataset.refus).toContain("start-3");
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("reduce"),
      addEventListener() {},
    }));
    jouer("fier", { hote: hote("coin") });
    expect(enAttente()).toBe(0);
    expect(logo?.dataset.version).toBe("cle");
    expect(logo?.dataset.refus).toBe("");
  });
});

/* ── Relecture du 24 novembre 2026 ────────────────────────────────────── */

/** Une mise en page à la main : jsdom n'en a pas. Chaque sélecteur reçoit
 * la boîte que Chrome lui donnerait ; un essai la change pour simuler la
 * colonne qui défile, la fenêtre qui rétrécit, ou l'image que Ctrl agrandit. */
function miseEnPage(depart: Record<string, [number, number, number, number]>) {
  const boites = new Map(Object.entries(depart));
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const b = [...boites].find(([sel]) => this.matches(sel))?.[1] ?? [0, 0, 0, 0];
    return DOMRect.fromRect({ x: b[0], y: b[1], width: b[2], height: b[3] });
  });
  return boites;
}
/** Le logo au pied d'une colonne, à 2 px par pixel d'Aïn, et l'image à
 * gauche, loin de lui. */
const COLONNE: Record<string, [number, number, number, number]> = {
  '[data-hote="coin"] > canvas': [40, 600, 228, 62],
  '[data-sol="coin"]': [40, 650, 228, 1],
  '[data-ancre="devant"]': [80, 650, 2, 1],
  "#screen": [300, 0, 600, 400],
};
const cadreDe = () => document.querySelector("[data-cadre]") as HTMLElement;
const logoDuCoin = () => hote("coin").querySelector("canvas.rt-mascotte") as HTMLCanvasElement;
const boiteDe = (acteur: string) => {
  const cv = [
    ...document.querySelectorAll<HTMLCanvasElement>(`.rt-ain-sprite[data-acteur="${acteur}"]`),
  ].find((x) => !x.hidden);
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(cv?.style.transform ?? "");
  const s = (cv?.dataset.serre ?? "").split(" ").map(Number);
  return m ? [+m[1] + s[0], +m[2] + s[1], +m[1] + s[2], +m[2] + s[3]] : null;
};

describe("la mise en page change sous ce qu'Aïn montre dehors", () => {
  /** Un ResizeObserver à la main : jsdom n'en a pas. `signaler` appelle
   * chaque observateur pour les éléments qu'il suit, comme Chrome quand une
   * taille change ou qu'un élément quitte la page (0 × 0). */
  let observateurs: { cb: ResizeObserverCallback; suivis: Set<Element> }[] = [];
  const signaler = () => {
    for (const o of observateurs)
      o.cb(
        [...o.suivis].map((target) => ({ target }) as ResizeObserverEntry),
        {} as ResizeObserver,
      );
  };
  beforeEach(() => {
    observateurs = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        suivis = new Set<Element>();
        constructor(cb: ResizeObserverCallback) {
          observateurs.push({ cb, suivis: this.suivis });
        }
        observe(el: Element) {
          this.suivis.add(el);
        }
        unobserve(el: Element) {
          this.suivis.delete(el);
        }
        disconnect() {
          this.suivis.clear();
        }
      },
    );
    cadreDe().setAttribute("data-sans-image", "non");
    cadreDe().setAttribute("data-etat", "vit");
  });

  it("Ctrl agrandit l'image sous la bulle d'endort : elle se tait", async () => {
    const boites = miseEnPage(COLONNE);
    jouer("endort", { hote: hote("coin"), version: "courte" });
    images(400);
    expect(visibles()).toEqual(["bulle"]);
    boites.set("#screen", [0, 0, 1400, 1050]);
    cadreDe().setAttribute("data-agrandie", "oui");
    await Promise.resolve();
    expect(visibles()).toEqual([]);
  });

  it("jumeau : l'image agrandie loin de la bulle, la bulle reste", async () => {
    const boites = miseEnPage(COLONNE);
    jouer("endort", { hote: hote("coin"), version: "courte" });
    images(400);
    boites.set("#screen", [300, 0, 700, 450]);
    cadreDe().setAttribute("data-agrandie", "oui");
    await Promise.resolve();
    expect(visibles()).toEqual(["bulle"]);
  });

  it("la maison démontée : plus rien d'Aïn dans la page, même sans geste", () => {
    miseEnPage(COLONNE);
    jouer("endort", { hote: hote("coin"), version: "courte" });
    images(400);
    expect(visibles()).toEqual(["bulle"]);
    hote("coin").remove();
    signaler();
    expect(visibles()).toEqual([]);
    expect(document.querySelectorAll(".rt-ain-calque")).toHaveLength(0);
  });

  it("la colonne défile : Aïn qui attendait devant le logo rentre, avec la pose clé de sa scène", () => {
    const boites = miseEnPage(COLONNE);
    jouer("decroche", { hote: hote("coin"), version: "complete" });
    images(400);
    expect(visibles()).toContain("ain");
    // Le défilement de 300 px : le logo monte, un bouton passe sous Aïn.
    cadreDe().insertAdjacentHTML("beforeend", '<button id="mesures">Mesures</button>');
    boites.set('[data-hote="coin"] > canvas', [40, 300, 228, 62]);
    boites.set('[data-sol="coin"]', [40, 350, 228, 1]);
    boites.set('[data-ancre="devant"]', [80, 350, 2, 1]);
    boites.set("#mesures", [40, 590, 140, 60]);
    hote("coin").dispatchEvent(new Event("scroll"));
    expect(visibles()).not.toContain("ain");
    expect(logoDuCoin().hasAttribute("data-dehors")).toBe(false);
    expect(logoDuCoin().dataset.version).toBe("cle");
    // La bulle de sa pose clé suit le logo, au-dessus de lui.
    const b = boiteDe("bulle");
    expect(visibles()).toEqual(["bulle"]);
    expect(b?.[3]).toBeLessThanOrEqual(300);
    expect(b?.[3]).toBeGreaterThan(260);
  });

  it("jumeau : un défilement qui ne bouge rien le laisse dehors", () => {
    miseEnPage(COLONNE);
    jouer("decroche", { hote: hote("coin"), version: "complete" });
    images(400);
    hote("coin").dispatchEvent(new Event("scroll"));
    expect(visibles()).toContain("ain");
    expect(logoDuCoin().hasAttribute("data-dehors")).toBe(true);
  });

  it("la fenêtre rétrécit, le logo part à gauche : Aïn ne reste pas seul hors de la page", () => {
    const boites = miseEnPage(COLONNE);
    jouer("decroche", { hote: hote("coin"), version: "complete" });
    images(400);
    expect(visibles()).toContain("ain");
    boites.set('[data-hote="coin"] > canvas', [10, 600, 228, 62]);
    boites.set('[data-sol="coin"]', [10, 650, 228, 1]);
    boites.set('[data-ancre="devant"]', [50, 650, 2, 1]);
    window.dispatchEvent(new Event("resize"));
    expect(visibles()).not.toContain("ain");
    expect(logoDuCoin().hasAttribute("data-dehors")).toBe(false);
  });

  it("une scène en cours dont la colonne défile est coupée : Aïn rentre, aucune image demandée", () => {
    const boites = miseEnPage(COLONNE);
    jouer("decroche", { hote: hote("coin"), version: "complete" });
    images(8);
    expect(enAttente()).toBe(1);
    boites.set('[data-hote="coin"] > canvas', [40, 300, 228, 62]);
    hote("coin").dispatchEvent(new Event("scroll"));
    expect(enAttente()).toBe(0);
    expect(visibles()).toEqual([]);
  });
});

describe("un contrôle qui arrive sous Aïn", () => {
  it("pendant une scène, un bouton monté sous lui coupe la scène : Aïn rentre", async () => {
    cadreDe().setAttribute("data-sans-image", "non");
    const boites = miseEnPage(COLONNE);
    jouer("decroche", { hote: hote("coin"), version: "complete" });
    images(30);
    expect(visibles()).toContain("ain");
    const a = boiteDe("ain") ?? [0, 0, 0, 0];
    boites.set("#choisir", [a[0], a[1], a[2] - a[0], a[3] - a[1]]);
    cadreDe().insertAdjacentHTML("beforeend", '<button id="choisir">Choisir un jeu</button>');
    await Promise.resolve();
    expect(visibles()).toEqual([]);
    expect(enAttente()).toBe(0);
  });

  it("jumeau : un bouton qui l'effleure d'une fraction de pixel (l'arrondi au pixel) ne coupe rien", async () => {
    cadreDe().setAttribute("data-sans-image", "non");
    const boites = miseEnPage(COLONNE);
    jouer("decroche", { hote: hote("coin"), version: "complete" });
    images(30);
    const a = boiteDe("ain") ?? [0, 0, 0, 0];
    // La zone d'un contrôle déborde de 2,3 px : son bord touche Aïn de 0,4 px.
    boites.set("#choisir", [a[0] - 60, a[1], 60 + 0.4 - 2.3, 20]);
    cadreDe().insertAdjacentHTML("beforeend", '<button id="choisir">Choisir un jeu</button>');
    await Promise.resolve();
    expect(visibles()).toContain("ain");
    expect(enAttente()).toBe(1);
  });

  it("jumeau : un bouton monté loin de lui ne coupe rien", async () => {
    cadreDe().setAttribute("data-sans-image", "non");
    const boites = miseEnPage(COLONNE);
    jouer("decroche", { hote: hote("coin"), version: "complete" });
    images(30);
    boites.set("#choisir", [900, 20, 100, 30]);
    cadreDe().insertAdjacentHTML("beforeend", '<button id="choisir">Choisir un jeu</button>');
    await Promise.resolve();
    expect(visibles()).toContain("ain");
    expect(enAttente()).toBe(1);
  });
});

describe("la pose clé montrée en entier", () => {
  const reduit = () =>
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("reduce"),
      addEventListener() {},
    }));
  /** Le plateau d'un écran éteint de 1440 × 900 : 256 × 96 sous la phrase. */
  const ECRAN: Record<string, [number, number, number, number]> = {
    ...COLONNE,
    '[data-hote="plateau"] > .rt-mascotte': [500, 500, 256, 96],
    '[data-hote="plateau"]': [500, 500, 256, 96],
  };

  for (const [nom, regler] of [
    ["en mouvement réduit", reduit],
    ["au niveau Sobre", () => changerNiveau("sobre")],
  ] as const)
    it(`${nom}, sur le plateau, Aïn se montre immobile avec sa bulle, et le logo du coin montre sa place`, async () => {
      miseEnPage(ECRAN);
      poserMascotte(hote("coin"));
      regler();
      jouer("dort", { hote: hote("plateau"), contexte: { joueur: "2" } });
      expect(enAttente()).toBe(0);
      expect(visibles().sort()).toEqual(["ain", "bulle"]);
      const a = boiteDe("ain");
      // À sa place : les pieds au bas du plateau (596), au milieu.
      expect(Math.abs((a?.[3] ?? 0) - 596)).toBeLessThanOrEqual(3);
      expect(Math.abs(((a?.[0] ?? 0) + (a?.[2] ?? 0)) / 2 - 628)).toBeLessThan(12);
      expect(logoDuCoin().hasAttribute("data-dehors")).toBe(true);
      // La première image le renvoie au logo.
      cadreDe().setAttribute("data-sans-image", "non");
      await Promise.resolve();
      expect(visibles()).toEqual([]);
      expect(logoDuCoin().hasAttribute("data-dehors")).toBe(false);
    });

  it("jumeau : une pose clé qui ne reste pas rend Aïn au coin à la fin de son minuteur", () => {
    vi.useFakeTimers();
    miseEnPage(ECRAN);
    poserMascotte(hote("coin"));
    reduit();
    jouer("chercher", { hote: hote("plateau") });
    expect(visibles()).toEqual(["ain"]);
    vi.advanceTimersByTime(2300);
    expect(visibles()).toEqual([]);
    expect(logoDuCoin().hasAttribute("data-dehors")).toBe(false);
    vi.useRealTimers();
  });
});

describe("la panne finie, sa pose s'efface", () => {
  beforeEach(() => {
    cadreDe().setAttribute("data-sans-image", "non");
    cadreDe().setAttribute("data-etat", "figee");
  });

  it("la version courte d'arret finit dans le logo avec son « ! » : la salle revit, il s'efface", async () => {
    miseEnPage(COLONNE);
    jouer("arret", { hote: hote("coin"), version: "courte" });
    images(400);
    expect(visibles()).toEqual(["bulle"]);
    cadreDe().setAttribute("data-etat", "vit");
    await Promise.resolve();
    expect(visibles()).toEqual([]);
    expect(enAttente()).toBe(0);
  });

  it("la pose clé d'arret (mouvement réduit) s'efface aussi quand la salle revit", async () => {
    miseEnPage(COLONNE);
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("reduce"),
      addEventListener() {},
    }));
    jouer("arret", { hote: hote("coin") });
    expect(visibles()).toEqual(["bulle"]);
    cadreDe().setAttribute("data-etat", "vit");
    await Promise.resolve();
    expect(visibles()).toEqual([]);
  });

  it("jumeau : tant que la panne dure (figée puis coupée), la pose reste", async () => {
    miseEnPage(COLONNE);
    jouer("arret", { hote: hote("coin"), version: "courte" });
    images(400);
    cadreDe().setAttribute("data-etat", "coupee");
    await Promise.resolve();
    expect(visibles()).toEqual(["bulle"]);
  });
});

describe("le crochet des pilotes", () => {
  const crochet = () => (globalThis as { nel3abAin?: { jouer?: unknown } }).nel3abAin;
  afterEach(() => {
    delete (globalThis as { nel3abAin?: unknown }).nel3abAin;
    delete (navigator as { webdriver?: boolean }).webdriver;
  });

  it("n'existe que dans un navigateur piloté : il joue sans l'arbitre de la salle", async () => {
    // Un visiteur ordinaire : aucun moyen de jouer une scène par-dessus une
    // panne depuis la console (relecture du 24 novembre 2026).
    delete (globalThis as { nel3abAin?: unknown }).nel3abAin;
    Object.defineProperty(navigator, "webdriver", { value: false, configurable: true });
    vi.resetModules();
    await import("./index");
    expect(crochet()?.jouer).toBeUndefined();
    // Le jumeau : Chrome piloté par un pilote (`navigator.webdriver`).
    Object.defineProperty(navigator, "webdriver", { value: true, configurable: true });
    vi.resetModules();
    await import("./index");
    expect(typeof crochet()?.jouer).toBe("function");
  });
});
