/**
 * Le logo de la salle est celui que le propriétaire a choisi, case par case.
 *
 * `reference` est la fonction `logoSVG` de la page des effets du 23 novembre
 * 2026 (`da/retro/index.html`), recopiée sans changement pour le style
 * « escalier »: elle pose un carré d'un pixel par case, dans l'ordre de
 * peinture. Les deux dessins sont peints sur une grille de 38 × 10, et chaque
 * case doit finir de la même couleur. Une lettre déplacée d'un pixel, une
 * marche du relief oubliée ou deux calques peints dans le mauvais ordre
 * changent au moins une case.
 */
import { describe, expect, it } from "vitest";

import {
  GLYPHES,
  HAUTEUR,
  iconeOngletDataUrl,
  iconeOngletSVG,
  JETONS_LOGO,
  LARGEUR,
  LOGO_JOUR,
  LOGO_NUIT,
  logoSVG,
  MIRE,
  type CouleursLogo,
} from "./logo";

/* ── La page des effets, recopiée ──────────────────────────────────────── */
function reference(style: string, unite: number, opt: { lettre?: string; jour?: boolean } = {}) {
  const lettre = opt.lettre || "#eef0f2";
  const pts: { x: number; y: number; c: string; i: number }[] = [];
  let x = 0;
  let i = 0;
  for (const ch of "nel3ab") {
    const g = GLYPHES[ch as keyof typeof GLYPHES];
    const w = g[0].length;
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < w; c++) {
        if ((g[r] ?? "")[c] !== "#") continue;
        let col = lettre;
        if (ch === "3") col = style === "escalier" ? "#f2e14b" : (MIRE[c] ?? "");
        pts.push({ x: x + c, y: r, c: col, i });
      }
    x += w + 1;
    i++;
  }
  const W = x - 1;
  let w = W;
  let h = 7;
  const parts: string[] = [];
  const rect = (p: { x: number; y: number; c: string }, dx = 0, dy = 0, c = p.c) =>
    `<rect x="${p.x + dx}" y="${p.y + dy}" width="1" height="1" fill="${c}"/>`;
  if (style === "escalier") {
    const prof = opt.jour ? ["#9aa3c2", "#d06fd0", "#57d3f0"] : ["#4f63e0", "#d06fd0", "#57d3f0"];
    for (let k = 3; k >= 1; k--) for (const p of pts) parts.push(rect(p, k, k, prof[3 - k]));
    w += 3;
    h += 3;
  }
  for (const p of pts) parts.push(rect(p));
  return `<svg viewBox="0 0 ${w} ${h}" width="${w * unite}" height="${h * unite}">${parts.join("")}</svg>`;
}

type Grille = string[][];
const vide = (): Grille => Array.from({ length: HAUTEUR }, () => Array(LARGEUR).fill(""));

/** Peint les `<rect>` d'un SVG, dans l'ordre. */
function peindreRects(svg: string): Grille {
  const g = vide();
  for (const m of svg.matchAll(
    /<rect x="(\d+)" y="(\d+)" width="1" height="1" fill="(#[0-9a-f]{6})"\/>/g,
  )) {
    const ligne = g[Number(m[2])];
    if (!ligne) throw new Error(`case hors de la grille: ${m[0]}`);
    ligne[Number(m[1])] = m[3] ?? "";
  }
  return g;
}

/** Peint les chemins d'un SVG, dans l'ordre: chaque trait `M x y h w v1 h-w z`,
 * décalé par sa translation, avec sa couleur écrite ou lue dans les jetons. */
function peindreChemins(svg: string, jetons: Record<string, string> = {}): Grille {
  const g = vide();
  let chemins = 0;
  for (const m of svg.matchAll(/<path ([^>]*?)d="([^"]+)"\/>/g)) {
    chemins += 1;
    const attrs = m[1] ?? "";
    const decale = /translate\((\d+) (\d+)\)/.exec(attrs);
    const dx = Number(decale?.[1] ?? 0);
    const dy = Number(decale?.[2] ?? 0);
    const ecrite = /fill="(#[0-9a-f]{6})"/.exec(attrs)?.[1];
    const jeton = /fill:var\((--[\w-]+)\)/.exec(attrs)?.[1];
    const couleur = ecrite ?? (jeton ? jetons[jeton] : undefined);
    if (!couleur) throw new Error(`calque sans couleur: ${attrs}`);
    for (const t of (m[2] ?? "").matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
      expect(t[3]).toBe(t[4]);
      for (let k = 0; k < Number(t[3]); k += 1) {
        const ligne = g[Number(t[2]) + dy];
        if (!ligne) throw new Error("trait hors de la grille");
        ligne[Number(t[1]) + dx + k] = couleur;
      }
    }
  }
  // La précondition: cinq calques (trois marches, les lettres, le 3).
  expect(chemins).toBe(5);
  return g;
}

const jetonsDe = (c: CouleursLogo) => ({
  [JETONS_LOGO.lettre]: c.lettre,
  [JETONS_LOGO.trois]: c.trois,
  [JETONS_LOGO.relief[0]]: c.relief[0],
  [JETONS_LOGO.relief[1]]: c.relief[1],
  [JETONS_LOGO.relief[2]]: c.relief[2],
});

describe("le relief en escalier", () => {
  it("la nuit: chaque case a la couleur de la page des effets", () => {
    const attendu = peindreRects(reference("escalier", 2));
    expect(peindreChemins(logoSVG({ peinture: LOGO_NUIT }))).toEqual(attendu);
    // Et par les jetons, avec les valeurs de nuit.
    expect(peindreChemins(logoSVG(), jetonsDe(LOGO_NUIT))).toEqual(attendu);
  });

  it("le jour: lettres #11142a et relief du jour", () => {
    const attendu = peindreRects(reference("escalier", 2, { lettre: "#11142a", jour: true }));
    expect(peindreChemins(logoSVG({ peinture: LOGO_JOUR }))).toEqual(attendu);
    expect(peindreChemins(logoSVG(), jetonsDe(LOGO_JOUR))).toEqual(attendu);
  });

  it("la grille compte vraiment: une autre version du logo ne passe pas", () => {
    // Le jumeau négatif: « le 3 en mire » a les mêmes lettres sans relief.
    // Si la comparaison ne voyait rien, celle-ci passerait aussi.
    const mire = peindreRects(reference("mire", 2));
    expect(peindreChemins(logoSVG({ peinture: LOGO_NUIT }))).not.toEqual(mire);
    // Et la nuit n'est pas le jour.
    expect(peindreChemins(logoSVG({ peinture: LOGO_NUIT }))).not.toEqual(
      peindreChemins(logoSVG({ peinture: LOGO_JOUR })),
    );
  });

  it("une marche peinte dans le mauvais ordre change des cases", () => {
    // Le relief se peint de la marche la plus lointaine à la plus proche: à
    // l'envers, le bleu recouvre le cyan, et la grille le voit.
    const svg = logoSVG({ peinture: LOGO_NUIT });
    const calques = [...svg.matchAll(/<path [^>]*\/>/g)].map((m) => m[0]);
    const inverse = svg.replace(
      calques.slice(0, 3).join(""),
      [...calques.slice(0, 3)].reverse().join(""),
    );
    expect(peindreChemins(inverse)).not.toEqual(peindreChemins(svg));
  });

  it("se nomme pour un lecteur d'écran, ou se tait quand un texte le nomme déjà", () => {
    expect(logoSVG()).toContain('role="img" aria-label="nel3ab"');
    const muet = logoSVG({ titre: "" });
    expect(muet).toContain('aria-hidden="true"');
    expect(muet).not.toContain("role=");
  });

  it("prend sa taille de l'unité, sur 38 × 10 pixels de dessin", () => {
    expect(logoSVG({ unite: 2 })).toContain('width="76" height="20"');
    expect(logoSVG({ unite: 3 })).toContain('width="114" height="30"');
    expect(logoSVG()).toContain('viewBox="0 0 38 10"');
  });

  it("pèse moins d'un dixième des carrés de la page des effets", () => {
    const carres = reference("escalier", 2).length;
    expect(logoSVG().length).toBeLessThan(carres / 5);
  });
});

describe("l'icône d'onglet", () => {
  it("le 3 seul, chaque colonne à sa barre de mire, sur noir", () => {
    const svg = iconeOngletSVG();
    expect(svg).toContain('<rect width="16" height="16" fill="#000"/>');
    // 24 pixels allumés dans le glyphe du 3.
    const carres = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="2" height="2" fill="([^"]+)"/g)];
    expect(carres).toHaveLength(24);
    for (const c of carres) {
      const colonne = (Number(c[1]) - 1) / 2;
      expect(c[3]).toBe(MIRE[colonne]);
    }
  });

  it("s'écrit en adresse data: sans caractère que l'attribut couperait", () => {
    const url = iconeOngletDataUrl();
    expect(url.startsWith("data:image/svg+xml,")).toBe(true);
    expect(url).not.toMatch(/["<>#\s]/);
    expect(decodeURIComponent(url.slice("data:image/svg+xml,".length))).toBe(iconeOngletSVG());
  });
});
