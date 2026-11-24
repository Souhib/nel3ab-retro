/**
 * Le moteur d'Aïn : le décor lu dans le DOM, et le planificateur qui refuse
 * un trajet qui toucherait l'image. L'essai rouge fait grandir l'image sur
 * le chemin d'un bond.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  boiteAin,
  imageDe,
  interp,
  lireDecor,
  MARGE_PX,
  Plan,
  SansAncre,
  touche,
  verifier,
  type Ancre,
  type Boite,
  type Decor,
  type Point,
  type Zone,
} from "./moteur";

const ancre = (x: number, y: number, w: number, h: number): Ancre => ({
  x,
  y,
  w,
  h,
  cx: x + w / 2,
  cy: y + h / 2,
  droite: x + w,
  bas: y + h,
});
const boite = (a: Ancre, m = 0): Boite => [a.x - m, a.y - m, a.droite + m, a.bas + m];

/** Un décor écrit : l'image en haut à gauche, le logo en bas à droite, un
 * sol commun sous les deux. Unité : 2 px par pixel d'Aïn. */
function decor(o: { image?: Ancre | null; ancres?: Record<string, Ancre> } = {}): Decor {
  const image = o.image === undefined ? ancre(0, 0, 400, 300) : o.image;
  const zones = (): Zone[] => (image ? [{ nom: "image", b: boite(image, MARGE_PX + 0.6) }] : []);
  return {
    c: 2,
    tete: false,
    maison: [600, 500],
    logo: [490, 450],
    largeur: 800,
    ancre: (nom) => o.ancres?.[nom] ?? null,
    zones,
    sols: () => [{ nom: "bas", x0: 0, x1: 800, y: 500 }],
    passages: () => [],
    image: () => image,
  };
}

describe("le planificateur", () => {
  it("accepte un bond libre, loin de l'image", () => {
    const P = new Plan(decor(), "essai");
    P.sortir(60).aller([450, 500]).rentre();
    expect(verifier(P)).toBe(true);
    expect(P.refus).toBeNull();
  });

  it("ROUGE : l'image grandit jusque sur le chemin, le plan est refusé", () => {
    // Le même trajet ; l'image descend jusqu'à 470 px, au-dessus du sol.
    const P = new Plan(decor({ image: ancre(0, 0, 520, 470) }), "essai");
    P.sortir(60).aller([450, 500]).rentre();
    expect(verifier(P)).toBe(false);
    expect(P.refus).toMatch(/l'image du jeu/);
  });

  it("abaisse un arc qui touche l'image plutôt que de refuser", () => {
    // L'image finit à 420 px : un grand arc y monte, un arc plat passe.
    const P = new Plan(decor({ image: ancre(300, 0, 200, 380) }), "essai");
    P.sortir(60).saute([350, 500], 400, 60);
    expect(verifier(P)).toBe(true);
    expect(P.abaisses).toBeGreaterThan(0);
    // Jumeau : sans image, l'arc reste entier.
    const libre = new Plan(decor({ image: null }), "essai");
    libre.sortir(60).saute([350, 500], 400, 60);
    expect(verifier(libre)).toBe(true);
    expect(libre.abaisses).toBe(0);
  });

  it("ne vérifie pas Aïn tant qu'il est dans le logo", () => {
    // L'image recouvre la maison : tant qu'il ne sort pas, rien ne touche.
    const d = decor({ image: ancre(560, 440, 80, 80) });
    const dedans = new Plan(d, "essai").tient(300, { oeil: "heureux" });
    expect(verifier(dedans)).toBe(true);
    const dehors = new Plan(d, "essai").sortir(60).tient(300);
    expect(verifier(dehors)).toBe(false);
  });

  it("vérifie aussi sa bulle", () => {
    // Une zone juste au-dessus de sa tête : Aïn passe, sa bulle non.
    const d = decor({ image: null });
    const tete = boiteAin(d, {}, "1", [300, 500]).b;
    const Z: Zone[] = [{ nom: "texte", b: [tete[0], tete[1] - 30, tete[2], tete[1] - 2] }];
    const sans = new Plan(
      d,
      "essai",
      {},
      { pose: {}, pied: [300, 500], scene: "x", enLair: false },
    );
    sans.tient(200, { oeil: "ouvert" });
    expect(verifier(sans, Z)).toBe(true);
    const avec = new Plan(
      d,
      "essai",
      {},
      { pose: {}, pied: [300, 500], scene: "x", enLair: false },
    );
    avec.tient(200, { oeil: "ouvert", fx: [{ t: "excl", c: "R" }] });
    expect(verifier(avec, Z)).toBe(false);
    expect(avec.refus).toMatch(/sa bulle/);
  });

  it("vérifie un objet que porte Aïn, sur sa trajectoire réelle", () => {
    // La cartouche sur sa tête monte au-dessus de lui : une zone haute
    // la touche, pas Aïn.
    const d = decor({ image: null });
    const A = boiteAin(d, {}, "1", [300, 500]).b;
    const Z: Zone[] = [{ nom: "controle", b: [0, A[1] - 14, 800, A[1] - 1] }];
    const P = new Plan(d, "essai", {}, { pose: {}, pied: [300, 500], scene: "x", enLair: false });
    P.tient(200);
    expect(verifier(P, Z)).toBe(true);
    P.objet("cartouche", 0, 200, null, null, { sur: "tete" });
    expect(verifier(P, Z)).toBe(false);
    expect(P.refus).toMatch(/cartouche/);
  });
});

describe("le plan", () => {
  it("une ancre absente lève SansAncre, pour passer à la version suivante", () => {
    const P = new Plan(decor(), "essai");
    expect(() => P.pt("start-3")).toThrow(SansAncre);
    const Q = new Plan(decor({ ancres: { "start-3": ancre(100, 400, 30, 26) } }), "essai");
    expect(Q.pt("start-3")).toEqual([115, 400]);
  });

  it("un bond monte en arc et finit où il vise", () => {
    const p = {
      t0: 0,
      t1: 100,
      de: [0, 100] as Point,
      vers: [100, 100] as Point,
      arc: 20,
      ease: "lin" as const,
    };
    expect(interp(p, 0)).toEqual([0, 100]);
    expect(interp(p, 50)).toEqual([50, 80]);
    expect(interp(p, 100)).toEqual([100, 100]);
  });

  it("part de là où il attendait quand il était dehors", () => {
    const P = new Plan(
      decor(),
      "essai",
      {},
      { pose: { forme: "e" }, pied: [200, 500], scene: "arret", enLair: false },
    );
    expect(P.depuisDehors).toBe(true);
    expect(P.pos).toEqual([200, 500]);
    expect(P.dehorsA(0)).toBe(true);
    P.rentre();
    expect(P.pos).toEqual([600, 500]);
  });

  it("retombe sur le sol quand une scène l'a coupé en l'air", () => {
    const P = new Plan(
      decor(),
      "essai",
      {},
      { pose: {}, pied: [200, 440], scene: "x", enLair: true },
    );
    expect(P.pos).toEqual([200, 500]);
    expect(P.t).toBeGreaterThan(0);
  });
});

describe("le décor lu dans la page", () => {
  const rects = new Map<Element, Ancre>();
  afterEach(() => {
    rects.clear();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });
  function page(sansImage: "oui" | "non") {
    document.body.innerHTML = `
      <div data-cadre data-sans-image="${sansImage}">
        <div data-zone-jeu id="zone"><canvas id="screen"></canvas></div>
        <button id="quitter">Quitter</button>
        <button id="cache" hidden>Caché</button>
        <button data-ancre="start-1" id="start">1P</button>
        <span data-texte id="pret">1P PRÊT</span>
        <p data-interdit="ligne" id="ligne">2 joueurs</p>
        <i data-sol="coin" id="sol"></i>
        <div data-hote="coin"><canvas data-ancre="logo" id="logo"></canvas></div>
      </div>`;
    const poser = (id: string, a: Ancre) => rects.set(document.getElementById(id) as Element, a);
    poser("zone", ancre(0, 0, 500, 400));
    poser("screen", ancre(50, 20, 400, 300));
    poser("quitter", ancre(600, 10, 80, 30));
    poser("start", ancre(100, 420, 30, 26));
    poser("pret", ancre(90, 450, 60, 12));
    poser("ligne", ancre(560, 300, 200, 20));
    poser("sol", ancre(540, 380, 240, 2));
    poser("logo", ancre(560, 330, 228, 62));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const a = rects.get(this) ?? ancre(0, 0, 0, 0);
        return {
          left: a.x,
          top: a.y,
          width: a.w,
          height: a.h,
          right: a.droite,
          bottom: a.bas,
          x: a.x,
          y: a.y,
          toJSON: () => a,
        } as DOMRect;
      },
    );
    const racine = document.querySelector("[data-cadre]") as HTMLElement;
    return lireDecor(racine, document.getElementById("logo") as Element);
  }

  it("l'image est la toile, plus 4 px, dès qu'une image est peinte", () => {
    const d = page("non");
    const img = d.zones().find((z) => z.nom === "image");
    expect(img?.b[0]).toBeCloseTo(50 - MARGE_PX - 0.6);
    expect(img?.b[3]).toBeCloseTo(320 + MARGE_PX + 0.6);
  });

  it("sans image peinte, l'écran noir n'est pas interdit (le plateau)", () => {
    const d = page("oui");
    expect(d.zones().some((z) => z.nom === "image")).toBe(false);
    expect(imageDe(document)).toBeNull();
  });

  it("les contrôles, la ligne et les mots sont interdits ; les ancres, les sols et le caché non", () => {
    const d = page("non");
    const noms = d
      .zones()
      .map((z) => z.nom)
      .sort();
    expect(noms).toEqual(["controle", "image", "ligne", "texte"]);
    const quitter = d.zones().find((z) => z.nom === "controle");
    expect(quitter && touche(quitter.b, [600, 10, 601, 11])).toBe(true);
  });

  it("l'échelle vient de la taille du logo, la maison de sa fente", () => {
    const d = page("non");
    expect(d.c).toBe(2);
    expect(d.maison).toEqual([560 + 59 * 2, 330 + 25 * 2]);
    expect(d.sols()).toEqual([{ nom: "coin", x0: 540, x1: 780, y: 380 }]);
    expect(d.ancre("start-1")?.cx).toBe(115);
    expect(d.ancre("absente")).toBeNull();
  });

  it("le bouton qui porte sa maison reste un obstacle : Aïn n'en sort pas par-dessus ses mots", () => {
    document.body.innerHTML = `
      <div data-cadre data-sans-image="oui">
        <button id="salle"><span data-hote="barre"><canvas id="tete"></canvas></span>La salle</button>
        <button id="autre">Son</button>
      </div>`;
    rects.set(document.getElementById("salle") as Element, ancre(0, 0, 120, 44));
    rects.set(document.getElementById("tete") as Element, ancre(4, 10, 30, 20));
    rects.set(document.getElementById("autre") as Element, ancre(130, 0, 60, 44));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const a = rects.get(this) ?? ancre(0, 0, 0, 0);
        return {
          left: a.x,
          top: a.y,
          width: a.w,
          height: a.h,
          right: a.droite,
          bottom: a.bas,
          x: a.x,
          y: a.y,
          toJSON: () => a,
        } as DOMRect;
      },
    );
    const d = lireDecor(
      document.querySelector("[data-cadre]") as Element,
      document.getElementById("tete") as Element,
      { tete: true },
    );
    // « La salle » porte sa tête, mais ses mots ne doivent pas être
    // couverts : la scène s'y joue en pose, sans sprite (cadre-navigateur,
    // 844×390, 23 novembre 2026).
    expect(
      d
        .zones()
        .map((z) => z.qui)
        .sort(),
    ).toEqual(["#autre", "#salle"]);
  });

  it("le contenu d'un <details> fermé ne gêne pas ; ouvert, il gêne", () => {
    document.body.innerHTML = `
      <div data-cadre data-sans-image="oui">
        <details id="autres"><summary id="titre">Autres</summary><button id="mic">Micro</button></details>
        <div data-hote="coin"><canvas id="logo"></canvas></div>
      </div>`;
    rects.set(document.getElementById("titre") as Element, ancre(0, 0, 100, 30));
    rects.set(document.getElementById("mic") as Element, ancre(0, 40, 100, 30));
    rects.set(document.getElementById("logo") as Element, ancre(0, 100, 228, 62));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const a = rects.get(this) ?? ancre(0, 0, 0, 0);
        return {
          left: a.x,
          top: a.y,
          width: a.w,
          height: a.h,
          right: a.droite,
          bottom: a.bas,
          x: a.x,
          y: a.y,
          toJSON: () => a,
        } as DOMRect;
      },
    );
    const racine = document.querySelector("[data-cadre]") as Element;
    const logo = document.getElementById("logo") as Element;
    expect(
      lireDecor(racine, logo)
        .zones()
        .map((z) => z.qui),
    ).toEqual(["#titre"]);
    (document.getElementById("autres") as HTMLDetailsElement).open = true;
    expect(
      lireDecor(racine, logo)
        .zones()
        .map((z) => z.qui)
        .sort(),
    ).toEqual(["#mic", "#titre"]);
  });
  it("le plateau n'a pas de logo : ce qui se mesure du logo se mesure d'Aïn, à sa place", () => {
    document.body.innerHTML = `
      <div data-cadre data-sans-image="oui">
        <div data-zone-jeu><p data-texte id="phrase">Bo choisit le jeu.</p>
          <div data-hote="plateau"><span id="plateau"></span></div></div>
      </div>`;
    rects.set(document.getElementById("phrase") as Element, ancre(416, 362, 304, 22));
    rects.set(document.getElementById("plateau") as Element, ancre(500, 400, 256, 96));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const a = rects.get(this) ?? ancre(0, 0, 0, 0);
        return {
          left: a.x,
          top: a.y,
          width: a.w,
          height: a.h,
          right: a.droite,
          bottom: a.bas,
          x: a.x,
          y: a.y,
          toJSON: () => a,
        } as DOMRect;
      },
    );
    const racine = document.querySelector("[data-cadre]") as Element;
    const d = lireDecor(racine, document.getElementById("plateau") as Element, {
      plateau: true,
      c: 2.5,
    });
    // Ses pieds au milieu du bas du plateau ; le logo est celui dont il
    // serait le 3 (fente à 48, pieds à 25 lignes du haut).
    expect(d.maison).toEqual([628, 496]);
    expect(d.logo).toEqual([628 - 59 * 2.5, 496 - 25 * 2.5]);
    // Le haut de sa tête est sous la phrase, pas le coin du plateau.
    expect(d.logo[1]).toBeGreaterThan(384);
    expect(d.zones().map((z) => z.nom)).toEqual(["texte"]);
  });

  it("ce qui défile sous le pied collé de la colonne ne gêne pas ; sa part visible, si", () => {
    document.body.innerHTML = `
      <div data-cadre data-sans-image="oui">
        <aside id="side">
          <button id="dessous">Tes touches</button>
          <button id="moitie">Autres réglages</button>
          <button id="dessus">Menu</button>
          <div id="pied" style="position: sticky">
            <div data-hote="coin"><canvas id="logo"></canvas></div></div>
        </aside>
      </div>`;
    rects.set(document.getElementById("pied") as Element, ancre(1000, 740, 304, 161));
    rects.set(document.getElementById("logo") as Element, ancre(1040, 830, 228, 62));
    rects.set(document.getElementById("dessous") as Element, ancre(1012, 800, 280, 40));
    rects.set(document.getElementById("moitie") as Element, ancre(1012, 720, 280, 40));
    rects.set(document.getElementById("dessus") as Element, ancre(1012, 600, 280, 40));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const a = rects.get(this) ?? ancre(0, 0, 0, 0);
        return {
          left: a.x,
          top: a.y,
          width: a.w,
          height: a.h,
          right: a.droite,
          bottom: a.bas,
          x: a.x,
          y: a.y,
          toJSON: () => a,
        } as DOMRect;
      },
    );
    const racine = document.querySelector("[data-cadre]") as Element;
    const zones = lireDecor(racine, document.getElementById("logo") as Element).zones();
    expect(zones.map((z) => z.qui)).toEqual(["#moitie", "#dessus"]);
    // De « Autres réglages », seule la part au-dessus du pied gêne.
    expect(zones[0].b[3]).toBeCloseTo(740 + MARGE_PX / 2 + 0.3);
    // Le jumeau : sans pied collé, les trois gênent.
    (document.getElementById("pied") as HTMLElement).style.position = "static";
    expect(
      lireDecor(racine, document.getElementById("logo") as Element)
        .zones()
        .map((z) => z.qui),
    ).toEqual(["#dessous", "#moitie", "#dessus"]);
  });

  it("sans image, un bouton posé dans la zone de jeu (l'écran éteint) est un obstacle", () => {
    document.body.innerHTML = `
      <div data-cadre data-sans-image="oui">
        <div data-zone-jeu id="zone" role="button" tabindex="0">
          <button id="choisir">Choisir un jeu</button>
          <div data-hote="plateau"><span id="plateau"></span></div></div>
      </div>`;
    rects.set(document.getElementById("zone") as Element, ancre(0, 0, 1200, 900));
    rects.set(document.getElementById("choisir") as Element, ancre(560, 360, 160, 40));
    rects.set(document.getElementById("plateau") as Element, ancre(500, 420, 256, 96));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const a = rects.get(this) ?? ancre(0, 0, 0, 0);
        return {
          left: a.x,
          top: a.y,
          width: a.w,
          height: a.h,
          right: a.droite,
          bottom: a.bas,
          x: a.x,
          y: a.y,
          toJSON: () => a,
        } as DOMRect;
      },
    );
    const racine = document.querySelector("[data-cadre]") as Element;
    const d = lireDecor(racine, document.getElementById("plateau") as Element, { plateau: true });
    // Le bouton, oui ; la zone elle-même, même visable, non.
    expect(d.zones().map((z) => z.qui)).toEqual(["#choisir"]);
  });
});
