/**
 * Le lecteur d'Aïn : la boucle ne tourne que pendant une scène, la scène
 * cède quand la page prend du retard, et les trois façons de finir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CEDE_MS, Theatre } from "./lecteur";
import { Plan, type Decor } from "./moteur";

/** Une horloge d'images à la main : chaque `image(ms)` avance le temps et
 * appelle les demandes en attente. */
function horloge() {
  let maintenant = 1000;
  let attente = new Map<number, FrameRequestCallback>();
  let suivant = 1;
  vi.spyOn(performance, "now").mockImplementation(() => maintenant);
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    attente.set(suivant, f);
    return suivant++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => attente.delete(id));
  return {
    get enAttente() {
      return attente.size;
    },
    /** Fait passer les images jusqu'à ce que plus rien n'en demande ; une
     * boucle sans fin échoue au lieu de bloquer l'essai. */
    vider(max = 1000) {
      let n = 0;
      while (attente.size > 0) {
        if (++n > max) throw new Error(`une boucle tourne encore après ${max} images`);
        this.image(16);
      }
      return n;
    },
    image(ms = 16) {
      maintenant += ms;
      const lot = attente;
      attente = new Map();
      for (const f of lot.values()) f(maintenant);
      return lot.size;
    },
  };
}

const decor = (): Decor => ({
  c: 2,
  tete: false,
  maison: [600, 500],
  logo: [490, 450],
  largeur: 800,
  ancre: () => null,
  zones: () => [],
  sols: () => [{ nom: "bas", x0: 0, x1: 800, y: 500 }],
  passages: () => [],
  image: () => null,
});

let logo: HTMLCanvasElement;
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        clearRect() {},
        fillRect() {},
        drawImage() {},
        fillStyle: "",
      }) as unknown as CanvasRenderingContext2D,
  );
  logo = document.createElement("canvas");
  document.body.append(logo);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const sprites = () =>
  [...document.querySelectorAll<HTMLCanvasElement>(".rt-ain-sprite")].filter((cv) => !cv.hidden);

describe("rien ne tourne entre deux scènes", () => {
  it("la boucle part avec la scène et s'arrête avec elle", () => {
    const h = horloge();
    const th = new Theatre(logo, "logo", decor);
    expect(h.enAttente).toBe(0);
    const P = new Plan(th.relire(), "essai").sortir(60).aller([400, 500]).rentre();
    let finie = 0;
    th.lancer(P, () => finie++);
    expect(h.enAttente).toBe(1);
    // La scène se lit sur la maison tant qu'elle joue.
    expect(logo.dataset.scene).toBe("essai");
    const images = h.vider();
    expect(finie).toBe(1);
    expect(images).toBeGreaterThan(P.duree / 20);
    // Après la scène : aucune demande d'image, même cent images plus tard.
    for (let i = 0; i < 100; i++) expect(h.image(16)).toBe(0);
    expect(th.raf).toBe(0);
    expect(sprites()).toHaveLength(0);
    expect(th.present).toBe(true);
    expect(logo.dataset.scene).toBeUndefined();
    // Chaque sprite dit sa boîte serrée, en pixels de la page.
    const ain = document.querySelector<HTMLCanvasElement>('[data-acteur="ain"]');
    expect(ain?.dataset.serre?.split(" ").map(Number)).toHaveLength(4);
  });

  it("une pose clé ne demande aucune image, et finit par un minuteur", () => {
    vi.useFakeTimers();
    const h = horloge();
    const th = new Theatre(logo, "logo", decor);
    let finie = 0;
    th.poseCle(
      { pose: { oeil: "heureux", fx: [{ t: "etoile", c: "Y" }] }, tient: 2000 },
      "2",
      () => finie++,
    );
    expect(h.enAttente).toBe(0);
    expect(th.air.oeil).toBe("heureux");
    // La bulle est un sprite fixe au-dessus du logo.
    expect(sprites().map((cv) => cv.dataset.acteur)).toEqual(["bulle"]);
    vi.advanceTimersByTime(2000);
    expect(finie).toBe(1);
    expect(th.air.oeil).toBeUndefined();
    expect(sprites()).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe("la bulle chez lui", () => {
  it("ne se pose pas sur une zone : il garde son air sans bulle", () => {
    vi.useFakeTimers();
    horloge();
    // Une zone couvre tout ce qui est au-dessus du logo (les mots d'un
    // bouton qui porterait sa tête).
    const couvert = (): Decor => ({
      ...decor(),
      zones: () => [{ nom: "controle", b: [0, 0, 800, 449] }],
    });
    const th = new Theatre(logo, "logo", couvert);
    th.poseCle(
      { pose: { oeil: "heureux", fx: [{ t: "etoile", c: "Y" }] }, tient: 2000 },
      "2",
      () => {},
    );
    expect(th.air.oeil).toBe("heureux");
    expect(sprites()).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe("la scène cède", () => {
  it(`deux images de suite à plus de ${CEDE_MS} ms : saut à l'état final`, () => {
    const h = horloge();
    const th = new Theatre(logo, "logo", decor);
    const P = new Plan(th.relire(), "essai").sortir(60).tient(2000).rentre();
    let finie = 0;
    th.lancer(P, () => finie++);
    h.image(16);
    h.image(16);
    h.image(CEDE_MS + 10);
    expect(finie).toBe(0);
    h.image(CEDE_MS + 10);
    expect(finie).toBe(1);
    expect(th.mesure.cede).toBe(1);
    expect(h.enAttente).toBe(0);
  });

  it("jumeau : une seule image en retard ne fait pas céder", () => {
    const h = horloge();
    const th = new Theatre(logo, "logo", decor);
    const P = new Plan(th.relire(), "essai").sortir(60).tient(2000).rentre();
    th.lancer(P, () => {});
    h.image(16);
    h.image(CEDE_MS + 10);
    h.image(16);
    h.image(CEDE_MS + 10);
    expect(th.mesure.cede).toBe(0);
    expect(th.joue).toBe(true);
  });
});

describe("les trois façons de finir", () => {
  it("interrompue dehors, Aïn reste là ; la suivante part de là", () => {
    const h = horloge();
    const th = new Theatre(logo, "logo", decor);
    const P = new Plan(th.relire(), "essai").sortir(60).aller([300, 500]).tient(1000).rentre();
    th.lancer(P, () => {});
    // Avancer jusqu'à ce qu'il soit arrivé et attende.
    for (let i = 0; i < 60; i++) h.image(16);
    th.terminer("interrompre");
    expect(th.dehors?.pied[0]).toBeCloseTo(300, 0);
    expect(th.present).toBe(false);
    expect(sprites().map((cv) => cv.dataset.acteur)).toContain("ain");
    const Q = new Plan(th.relire(), "suite", {}, th.dehors);
    expect(Q.pos[0]).toBeCloseTo(300, 0);
  });

  it("coupée par la première image, Aïn est déjà rentré, sans objet", () => {
    const h = horloge();
    const th = new Theatre(logo, "logo", decor);
    const P = new Plan(th.relire(), "essai").sortir(60).aller([300, 500]).tient(1000);
    P.objet("cartouche", 100, 1500, null, null, { sur: "tete", reste: true });
    th.lancer(P, () => {});
    for (let i = 0; i < 40; i++) h.image(16);
    expect(sprites().length).toBeGreaterThan(0);
    th.terminer("couper");
    expect(sprites()).toHaveLength(0);
    expect(th.present).toBe(true);
    expect(th.dehors).toBeNull();
    expect(h.enAttente).toBe(0);
  });

  it("une scène qui finit dehors y laisse Aïn, immobile", () => {
    const h = horloge();
    const th = new Theatre(logo, "logo", decor);
    const P = new Plan(th.relire(), "essai").sortir(60).aller([300, 500]).tient(300);
    th.lancer(P, () => {});
    h.vider();
    expect(th.dehors).not.toBeNull();
    expect(th.present).toBe(false);
    expect(h.image(16)).toBe(0);
  });
});

describe("la pose clé lit le décor de maintenant", () => {
  it("le logo a bougé depuis le montage : sa bulle le suit et se montre", () => {
    vi.useFakeTimers();
    horloge();
    // Au montage, le logo est encore en haut, sous une ligne d'état ; la page
    // s'installe ensuite et le pose plus bas, loin d'elle.
    let y = 450;
    const bouge = (): Decor => ({
      ...decor(),
      logo: [490, y],
      maison: [608, y + 50],
      zones: () => [{ nom: "ligne", b: [400, 380, 700, 449] }],
    });
    const th = new Theatre(logo, "logo", bouge);
    y = 650;
    th.poseCle({ pose: { oeil: "ferme", fx: [{ t: "z", c: "W" }] }, reste: true }, "1", () => {});
    expect(sprites().map((cv) => cv.dataset.acteur)).toEqual(["bulle"]);
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(sprites()[0].style.transform);
    expect(Number(m?.[2])).toBeGreaterThan(600);
    expect(Number(m?.[2])).toBeLessThan(650);
    vi.useRealTimers();
  });
});

describe("effacer", () => {
  it("rend l'air neutre, sans bulle, sans objet, et finit la pose", () => {
    vi.useFakeTimers();
    horloge();
    const th = new Theatre(logo, "logo", decor);
    th.poseCle(
      { pose: { oeil: "grand", fx: [{ t: "excl", c: "R" }] }, reste: true },
      "1",
      () => {},
    );
    expect(sprites()).toHaveLength(1);
    th.effacer();
    expect(th.air).toEqual({});
    expect(th.poseFixe).toBeNull();
    expect(sprites()).toHaveLength(0);
    vi.useRealTimers();
  });
});
