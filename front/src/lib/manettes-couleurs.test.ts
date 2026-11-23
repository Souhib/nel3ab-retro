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

import { EMULATED, MAPS, type Part, PHYSICAL, type PadMap } from "./padmap";

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
 * feuille : la base, puis chaque bloc qui le nomme. Avec une pièce, les blocs
 * qui la visent viennent après tous les autres, ceux qui nomment aussi la
 * place en dernier (plus précis) : posée sur la pièce, une propriété
 * l'emporte sur celle que le dessin lui transmet. */
function proprietes(
  css: string,
  plan: string,
  place: number | null,
  piece?: Pick<Part, "key" | "appui">,
): Map<string, string> {
  const vues = new Map<string, string>();
  const tous = blocs(css);
  for (const bloc of tous) {
    const vise = bloc.selecteurs.some(
      (sel) =>
        sel === "[data-padmap]" ||
        sel === `[data-padmap="${plan}"]` ||
        (place !== null && sel === `[data-padmap][data-place="${place}"]`),
    );
    if (vise) for (const [nom, val] of bloc.decl) vues.set(nom, val);
  }
  if (piece === undefined) return vues;
  const cibles = [
    `[data-part="${piece.key}"]`,
    ...(piece.appui ? [`[data-appui="${piece.appui}"]`] : []),
  ];
  const dessins = [`[data-padmap]`, `[data-padmap="${plan}"]`];
  const passes = [
    cibles.flatMap((c) => dessins.map((d) => `${d} ${c}`)),
    place === null
      ? []
      : cibles.flatMap((c) => dessins.map((d) => `${d}[data-place="${place}"] ${c}`)),
  ];
  for (const voulus of passes) {
    for (const bloc of tous) {
      if (bloc.selecteurs.some((sel) => voulus.includes(sel))) {
        for (const [nom, val] of bloc.decl) vues.set(nom, val);
      }
    }
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

/** Ce que la page déclare dans chaque thème : l'encre (l'anneau d'une gâchette
 * dessinée derrière la coque) et le fond (ce qui l'entoure). Le bloc de nuit
 * nomme `:root`, il est donc déjà dans `RACINE`. */
const JOUR = new Map(
  blocs(REGIE)
    .filter((b) => b.selecteurs.includes(':root[data-theme="jour"]'))
    .flatMap((b) => [...b.decl]),
);
const PAGE = {
  nuit: { encre: resoudre("var(--encre)", new Map()), fond: resoudre("var(--fond)", new Map()) },
  jour: { encre: resoudre("var(--encre)", JOUR), fond: resoudre("var(--fond)", JOUR) },
};

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

const GAMECUBE_A = MAPS["gamecube"]!.parts.find((one) => one.key === "A")!;

/** Tous les plans, la Wiimote seule comprise, que `MAPS` ne porte pas. */
const PLANS_VIVANTS: readonly PadMap[] = [
  ...new Set([...Object.values(MAPS), ...EMULATED, ...PHYSICAL]),
];

/** Les couleurs nommées par les pièces d'un plan, touche et inscription. */
const nommees = (plan: PadMap) =>
  plan.parts.flatMap((part) =>
    [part.tint, part.ink].filter((c): c is NonNullable<typeof c> => c !== undefined),
  );

/** Les appuis sous 3:1 de tous les plans avec cette feuille, et le nombre de
 * cas lus.
 *
 * Deux seuils de 3:1, par l'aplat ou par l'anneau, tels que `padmap.css`
 * les dessine. Contre la touche elle-même (sa teinte, sinon le capuchon) :
 * l'appui la change. Contre ce qui l'entoure, comme `banc-visuel.mjs` le
 * mesure : son logement ou la coque ; la base de la croix pour une pièce
 * affleurante ; la page pour une gâchette derrière la coque. Une pièce
 * affleurante n'a pas d'anneau, sauf `appui: "clair"` ; une gâchette
 * derrière la coque a l'encre du thème, sauf si elle déclare le sien.
 */
function appuisFaibles(css: string): { faibles: string[]; lues: number } {
  const faibles: string[] = [];
  let lues = 0;
  for (const plan of PLANS_VIVANTS) {
    for (const part of plan.parts) {
      for (const place of [null, 1, 2, 3, 4]) {
        for (const theme of ["nuit", "jour"] as const) {
          const p = proprietes(css, plan.id, place, part);
          const voir = (nom: string) => resoudre(`var(${nom})`, p);
          const aplat = voir("--pad-lit");
          const anneau =
            part.flush && part.appui !== "clair"
              ? null
              : part.under
                ? p.has("--pad-lit-ring-dessous")
                  ? voir("--pad-lit-ring-dessous")
                  : PAGE[theme].encre
                : voir("--pad-lit-ring");
          const tranche = (fond: string) =>
            Math.max(contraste(aplat, fond), anneau ? contraste(anneau, fond) : 0);
          const touche = tranche(resoudre(part.tint ?? "var(--pad-cap)", p));
          const autour = part.under
            ? tranche(PAGE[theme].fond)
            : part.flush
              ? tranche(voir("--pad-cap"))
              : Math.max(
                  part.hangs ? 0 : tranche(voir("--pad-well")),
                  tranche(voir("--pad-shell")),
                );
          lues += 1;
          const ou = `${plan.id} ${part.key} place ${place} ${theme}`;
          if (touche < 3) faibles.push(`${ou} touche ${touche.toFixed(2)}`);
          if (autour < 3) faibles.push(`${ou} autour ${autour.toFixed(2)}`);
        }
      }
    }
  }
  return { faibles, lues };
}

describe("les touches de couleur des plans", () => {
  it("nomment chacune une couleur que la feuille déclare", () => {
    // La précondition : des noms sont lus, sur plusieurs plans.
    const toutes = PLANS_VIVANTS.flatMap(nommees);
    expect(toutes.length).toBeGreaterThan(20);
    for (const couleur of toutes) {
      expect(resoudre(couleur, new Map()), couleur).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Le jumeau : un nom absent de la feuille est refusé, pas rendu noir.
    expect(() => resoudre("var(--manette-gamecube-inconnue)", new Map())).toThrow(/déclaré/);
  });

  it("laissent voir l'appui de chaque place sur chaque touche et autour d'elle", () => {
    const { faibles, lues } = appuisFaibles(PADMAP);
    // La précondition : chaque pièce de chaque plan a été lue, dans deux
    // thèmes qui diffèrent.
    expect(lues).toBeGreaterThan(1000);
    expect(PAGE.nuit.fond).not.toBe(PAGE.jour.fond);
    expect(faibles).toEqual([]);
  });

  it("lit l'appui posé sur la pièce, après celui du dessin", () => {
    // La place 1 donne au A de la GameCube sa teinte claire ; sans sa règle,
    // il perd la couleur de la place.
    const regle =
      '[data-padmap][data-place="1"] [data-appui="clair"] {\n  --pad-lit: var(--joueur-1-nuit);';
    expect(PADMAP).toContain(regle);
    const sansPlace = PADMAP.replace(
      regle,
      '[data-padmap][data-place="1"] [data-appui="clair"] {\n',
    );
    const aplat = (css: string) =>
      resoudre("var(--pad-lit)", proprietes(css, "gamecube", 1, GAMECUBE_A));
    expect(aplat(PADMAP)).toBe(RACINE.get("--joueur-1-nuit"));
    expect(aplat(sansPlace)).not.toBe(RACINE.get("--joueur-1-nuit"));
    // Le jumeau : sans aucune règle `appui: "clair"`, le A, le viseur et les
    // arcs retombent sous 3:1, et l'essai le dit.
    const sansAppui = PADMAP.replaceAll('[data-appui="clair"]', '[data-appui="aucun"]');
    expect(sansAppui).not.toBe(PADMAP);
    const tombent = new Set(
      appuisFaibles(sansAppui).faibles.map((un) => un.split(" ").slice(0, 2).join(" ")),
    );
    expect([...tombent].sort()).toEqual(
      ["gamecube A", "wiimote Z", "wiimote cx", "wiimote-only Z", "wiimote-only cx"].sort(),
    );
  });
});
