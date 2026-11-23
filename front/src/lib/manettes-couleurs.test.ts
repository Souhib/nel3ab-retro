/**
 * L'appui d'une manette dessinée se voit, pour chaque manette et chaque place.
 *
 * Chantier manettes, 23 novembre 2026 : l'appui prend la couleur de la place
 * de la page (`components/padmap.css`). L'aplat est la teinte de joueur de
 * l'autre clarté que les touches, l'anneau un blanc ou un noir d'objet de
 * l'autre clarté que la coque. L'un des deux doit tenir 3:1 contre la touche,
 * son logement et la coque : c'est ce qui dit qu'une touche est appuyée sans
 * reposer sur la couleur seule. Lu dans les feuilles telles qu'elles partent,
 * pas dans une copie des valeurs.
 */
import { describe, expect, it } from "vitest";

type Fs = { readFileSync: (chemin: string, codage: "utf-8") => string };
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
const lire = (relatif: string) =>
  fs.readFileSync(new URL(relatif, import.meta.url).pathname, "utf-8");

const REGIE = lire("../regie.css");
const PADMAP = lire("../components/padmap.css");
const PLANS = lire("./padmap.ts");

/** Les blocs `sélecteurs { déclarations }` d'une feuille, commentaires ôtés. */
function blocs(css: string): { selecteurs: string[]; decl: Map<string, string> }[] {
  const net = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...net.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, corps]) => ({
    selecteurs: sel!.split(",").map((un) => un.trim()),
    decl: new Map(
      [...corps!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(([, nom, val]) => [
        nom!,
        val!.trim(),
      ]),
    ),
  }));
}

const RACINE = new Map(
  blocs(REGIE)
    .filter((b) => b.selecteurs.includes(":root"))
    .flatMap((b) => [...b.decl]),
);

/** Les propriétés d'un dessin de ce plan à cette place, dans l'ordre de la
 * feuille : la base, puis chaque bloc qui le nomme. */
function proprietes(css: string, plan: string, place: number | null): Map<string, string> {
  const vues = new Map<string, string>();
  for (const bloc of blocs(css)) {
    const vise = bloc.selecteurs.some(
      (sel) =>
        sel === "[data-padmap]" ||
        sel === `[data-padmap="${plan}"]` ||
        (place !== null && sel === `[data-padmap][data-place="${place}"]`),
    );
    if (vise) for (const [nom, val] of bloc.decl) vues.set(nom, val);
  }
  return vues;
}

function resoudre(valeur: string, locales: Map<string, string>, profondeur = 0): string {
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(valeur);
  if (!ref) return valeur;
  if (profondeur > 8) throw new Error(`boucle sur ${valeur}`);
  const nom = ref[1]!;
  const suite = locales.get(nom) ?? RACINE.get(nom);
  if (suite === undefined) throw new Error(`${nom} n'est déclaré nulle part`);
  return resoudre(suite, locales, profondeur + 1);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contraste = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** Le pire, sur la touche, le logement et la coque, du meilleur de l'aplat et
 * de l'anneau. */
function pire(css: string, plan: string, place: number, avecAnneau = true): number {
  const p = proprietes(css, plan, place);
  const voir = (nom: string) => resoudre(`var(${nom})`, p);
  const lit = voir("--pad-lit");
  const anneau = voir("--pad-lit-ring");
  return Math.min(
    ...["--pad-cap", "--pad-well", "--pad-shell"].map((fond) =>
      Math.max(contraste(lit, voir(fond)), avecAnneau ? contraste(anneau, voir(fond)) : 0),
    ),
  );
}

const IDS = [
  ...[...PLANS.matchAll(/\bid: "([a-z0-9-]+)"/g)].map(([, id]) => id!),
  ...[...PLANS.matchAll(/switchPro\(\s*"([a-z0-9-]+)"/g)].map(([, id]) => id!),
];

describe("l'appui des manettes dessinées", () => {
  it("lit les dix plans, et chacun a ses matières", () => {
    // La précondition : une lecture vide passerait sur rien.
    expect(IDS.sort()).toEqual(
      [
        "dualshock",
        "gamecube",
        "guitar",
        "standard",
        "switch-pro",
        "switch-pro-pad",
        "wiimote",
        "wiimote-only",
        "xbox",
        "xbox360",
      ].sort(),
    );
    for (const plan of IDS) {
      const p = proprietes(PADMAP, plan, null);
      // Le jumeau : le plan de base seul laisserait une coque commune.
      expect(p.get("--pad-shell"), plan).not.toBe("var(--manette-commune-coque)");
    }
  });

  it.each([
    "dualshock",
    "gamecube",
    "guitar",
    "standard",
    "switch-pro",
    "switch-pro-pad",
    "wiimote",
    "wiimote-only",
    "xbox",
    "xbox360",
  ])("%s : l'appui de chaque place tient 3:1 contre la touche, le logement et la coque", (plan) => {
    for (const place of [1, 2, 3, 4]) {
      expect(pire(PADMAP, plan, place), `${plan}, place ${place}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("prend la couleur de la place, pas une autre", () => {
    const p = proprietes(PADMAP, "xbox", 2);
    expect(resoudre("var(--pad-lit)", p)).toBe(RACINE.get("--joueur-2-nuit"));
    const g = proprietes(PADMAP, "gamecube", 3);
    expect(resoudre("var(--pad-lit)", g)).toBe(RACINE.get("--joueur-3-jour"));
    // Sans place, un aplat d'objet, jamais une couleur de joueur.
    const sans = resoudre("var(--pad-lit)", proprietes(PADMAP, "xbox", null));
    const joueurs = [...RACINE].filter(([nom]) => nom.startsWith("--joueur-")).map(([, v]) => v);
    expect(joueurs).not.toContain(sans);
  });

  it("sur la GameCube violette, c'est l'anneau qui tient : sans lui, l'appui tombe", () => {
    expect(pire(PADMAP, "gamecube", 2, false)).toBeLessThan(3);
    // Le jumeau du mutant : un anneau de la même clarté que la coque échoue.
    const mutant = PADMAP.replace(
      "--pad-anneau: var(--manette-anneau-clair);",
      "--pad-anneau: var(--manette-anneau-sombre);",
    );
    expect(mutant).not.toBe(PADMAP);
    expect(pire(mutant, "gamecube", 2)).toBeLessThan(3);
  });

  it("un appui de la couleur de la touche est refusé", () => {
    const mutant = PADMAP.replace(
      "--pad-lit: var(--pad-appui-1);\n  --pad-lit-ring: var(--pad-anneau);",
      "--pad-lit: var(--pad-cap);\n  --pad-lit-ring: var(--pad-cap);",
    );
    expect(mutant).not.toBe(PADMAP);
    expect(pire(mutant, "xbox", 1)).toBeLessThan(3);
  });
});
