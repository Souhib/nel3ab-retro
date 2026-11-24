/**
 * Le dessin d'Aïn : les tailles des grilles, la palette, le logo à l'unité
 * d'Aïn comparé au logo de la page, et la peinture.
 */
import { afterEach, describe, expect, it } from "vitest";

import { pixelsDuLogo } from "../lib/logo";
import {
  ACCESSOIRES,
  AH,
  AW,
  B_ET,
  boiteSerree,
  BULLES,
  dessinerAin,
  dessinerLogo,
  dessinerTete,
  FENTE_X,
  grilleBulle,
  lirePalette,
  LOGO_H,
  LOGO_W,
  oeil,
  PALETTE,
  peindre,
  PIED_X,
  PIED_Y,
  reliefJoueur,
  TH,
  TW,
  type Grille,
} from "./dessin";

const lettres = (g: Grille) => new Set(g.join("").replaceAll(".", ""));
const enPalette = (g: Grille) => [...lettres(g)].every((ch) => ch in PALETTE);

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

describe("Aïn", () => {
  it("tient dans sa grille de 32 × 36, toutes ses couleurs dans la palette", () => {
    const g = dessinerAin({});
    expect(g).toHaveLength(AH);
    for (const ligne of g) expect(ligne).toHaveLength(AW);
    expect(enPalette(g)).toBe(true);
  });

  it("pose ses pieds sur la ligne du sol, au milieu de la colonne des pieds", () => {
    const g = dessinerAin({});
    // Les pieds rouges finissent juste au-dessus du sol ; la ligne du sol est
    // le contour noir sous eux, la dernière ligne dessinée.
    expect(g[PIED_Y - 1]).toContain("R");
    expect(g[PIED_Y]).not.toContain("R");
    const b = boiteSerree(g) as number[];
    expect(b[3]).toBe(PIED_Y + 1);
    // La colonne des pieds est le milieu de la figure, relief compris.
    expect(Math.abs((b[0] + b[2]) / 2 - PIED_X)).toBeLessThanOrEqual(1);
  });

  it("se retourne en Ɛ : le corps est le miroir du 3", () => {
    const corpsDe = (g: Grille) =>
      g.map((l) => [...l].map((ch) => (ch === "Y" ? "#" : ".")).join(""));
    const trois = corpsDe(dessinerAin({ oeil: "ferme", sansPieds: true, sansRelief: true }));
    const e = corpsDe(
      dessinerAin({ forme: "e", oeil: "ferme", sansPieds: true, sansRelief: true }),
    );
    const b3 = boiteSerree(trois);
    const be = boiteSerree(e);
    expect(b3 && be).not.toBeNull();
    const rogne = (g: Grille, b: number[]) => g.slice(b[1], b[3]).map((l) => l.slice(b[0], b[2]));
    const miroir = rogne(e, be as number[]).map((l) => [...l].reverse().join(""));
    // Les paupières fermées sont dans la peau : on ne compare que les « # ».
    const sansOeil = (g: string[]) => g.map((l) => l.replaceAll(".", "#"));
    expect(miroir.length).toBe(rogne(trois, b3 as number[]).length);
    expect(sansOeil(miroir)).toEqual(sansOeil(rogne(trois, b3 as number[])));
  });

  it("prend le relief d'un joueur : sa teinte sombre, sa couleur, sa teinte sombre", () => {
    expect(reliefJoueur("3")).toEqual(["7", "3", "7"]);
    const g = dessinerAin({ relief: reliefJoueur("3") });
    expect(lettres(g).has("3")).toBe(true);
    expect(lettres(g).has("C")).toBe(false);
    // Jumeau : sans relief demandé, le relief du logo.
    expect(lettres(dessinerAin({})).has("C")).toBe(true);
  });

  it("s'étire sans sortir de sa grille", () => {
    const g = dessinerAin({ barres: B_ET, pieds: "rentres", penche: 2 });
    expect(g).toHaveLength(AH);
    expect(boiteSerree(g)).not.toBeNull();
  });

  it("dessine les six yeux, chacun différent", () => {
    const yeux = (["ouvert", "mi", "ferme", "heureux", "grand", "croix"] as const).map((o) =>
      oeil(o).join("|"),
    );
    expect(new Set(yeux).size).toBe(6);
    // La pupille suit le regard.
    expect(oeil("ouvert", 1, 0)).not.toEqual(oeil("ouvert", -1, 0));
  });
});

describe("la tête seule", () => {
  it("tient dans 30 × 20, pour la barre du téléphone", () => {
    const g = dessinerTete({});
    expect(g).toHaveLength(TH);
    for (const ligne of g) expect(ligne).toHaveLength(TW);
    expect(enPalette(g)).toBe(true);
    // Pas de pieds dans la barre.
    expect(lettres(g).has("R")).toBe(false);
  });
});

describe("les bulles et les accessoires", () => {
  it("chaque bulle est cernée et dans la palette", () => {
    for (const t of Object.keys(BULLES) as (keyof typeof BULLES)[]) {
      const g = grilleBulle({ t });
      expect(enPalette(g), t).toBe(true);
      expect(
        g[0].replaceAll(".", "").length + g[g.length - 1].replaceAll(".", "").length,
        t,
      ).toBeGreaterThan(0);
    }
  });

  it("l'étiquette d'une place porte la couleur du joueur, pas une autre", () => {
    const g = grilleBulle({ t: "tag", j: "2" });
    expect(lettres(g)).toEqual(new Set(["2", "K"]));
    expect(lettres(grilleBulle({ t: "tag" }, "4"))).toEqual(new Set(["4", "K"]));
  });

  it("tous les accessoires sont dans la palette", () => {
    for (const [nom, g] of Object.entries(ACCESSOIRES)) expect(enPalette(g), nom).toBe(true);
    expect(ACCESSOIRES["cartouche-3"].length).toBeLessThan(ACCESSOIRES.cartouche.length);
  });
});

describe("le logo à l'unité d'Aïn", () => {
  const blocs = (g: Grille, x: number, y: number) =>
    [0, 1, 2].flatMap((dy) => [0, 1, 2].map((dx) => g[3 * y + dy][3 * x + dx]));

  it("a les lettres du logo de la page, trois pixels d'Aïn par pixel de logo", () => {
    const g = dessinerLogo(true);
    expect(g).toHaveLength(LOGO_H);
    for (const ligne of g) expect(ligne).toHaveLength(LOGO_W);
    const autres = pixelsDuLogo().filter((p) => !p.trois);
    expect(autres.length).toBeGreaterThan(50);
    for (const p of autres) expect(blocs(g, p.x, p.y), `${p.x},${p.y}`).toEqual(Array(9).fill("L"));
  });

  it("met Aïn dans la fente du 3 quand il est là", () => {
    const g = dessinerLogo(true);
    const fente = g.map((l) => l.slice(FENTE_X, FENTE_X + 21)).join("");
    expect(fente).toContain("Y");
    expect(fente).toContain("W");
  });

  it("laisse sa place en pointillés quand il est sorti, et rien d'autre", () => {
    const g = dessinerLogo(false);
    const fente = g.map((l) => l.slice(FENTE_X, FENTE_X + 21)).join("");
    expect(fente).not.toContain("Y");
    expect(fente).toContain("g");
    // Pointillés : jamais deux voisins à l'horizontale.
    for (const l of g) expect(l.slice(FENTE_X - 1, FENTE_X + 22)).not.toContain("gg");
  });

  it("s'éteint quand la salle dort : lettres ardoise, corps sombre, œil fermé", () => {
    const g = dessinerLogo(true, { eteint: true });
    expect(lettres(g).has("L")).toBe(false);
    expect(lettres(g).has("s")).toBe(true);
    expect(lettres(g).has("7")).toBe(true);
    expect(g.join("")).not.toContain("W");
  });
});

describe("la palette", () => {
  it("lit les jetons de la page quand ils existent", () => {
    document.documentElement.style.setProperty("--logo-lettre", "#123456");
    expect(lirePalette().L).toBe("#123456");
  });

  it("retombe sur la couleur écrite sans jeton", () => {
    expect(lirePalette().L).toBe("#eef0f2");
    expect(lirePalette(null).Y).toBe("#f2e14b");
  });
});

describe("peindre", () => {
  function toile() {
    const rects: { couleur: string; x: number; y: number; w: number; h: number }[] = [];
    const ctx = {
      fillStyle: "",
      clearRect: () => {},
      fillRect(x: number, y: number, w: number, h: number) {
        rects.push({ couleur: ctx.fillStyle, x, y, w, h });
      },
    };
    const cv = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    return { cv, rects };
  }

  it("peint chaque pixel à k pixels d'écran, sans trou entre deux voisins", () => {
    const { cv, rects } = toile();
    peindre(cv, ["YY", ".K"], 1.5, lirePalette(null));
    expect([cv.width, cv.height]).toEqual([3, 3]);
    expect(rects).toHaveLength(3);
    // Les deux pixels jaunes se touchent : 0 à 2, puis 2 à 3.
    expect(rects[0].x + rects[0].w).toBe(rects[1].x);
  });

  it("refuse une lettre hors de la palette plutôt que de peindre un trou", () => {
    const { cv } = toile();
    expect(() => peindre(cv, ["Q"], 1, lirePalette(null))).toThrow(/inconnue/);
  });
});
