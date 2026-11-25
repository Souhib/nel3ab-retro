/**
 * Le moteur des effets rétro: le catalogue, les trois niveaux, le réglage de
 * l'appareil, et le script de l'en-tête qui le pose avant la première image.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  oublierPourEssai,
  abonner,
  appliquer,
  changerNiveau,
  changerSons,
  CLE,
  demarrer,
  EFFETS,
  effetActif,
  effetsDuNiveau,
  lireReglage,
  mouvementReduit,
  niveau,
  NIVEAU_DEFAUT,
  NIVEAUX,
  scriptEnTete,
  sonsMenu,
  type IdEffet,
  type Niveau,
} from "./effets";

type Vm = { runInNewContext: (code: string, contexte: Record<string, unknown>) => unknown };
const { runInNewContext } = (await import(/* @vite-ignore */ `node:${"vm"}`)) as Vm;

const racine = document.documentElement;
const classesFx = (el: Element) => [...el.classList].filter((c) => c.startsWith("fx-")).sort();

beforeEach(() => {
  localStorage.clear();
  oublierPourEssai();
  racine.className = "";
  delete racine.dataset.effets;
  delete racine.dataset.sons;
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("le catalogue", () => {
  it("compte les 46 effets de la page, sans doublon, par famille", () => {
    expect(EFFETS).toHaveLength(46);
    expect(new Set(EFFETS.map((e) => e.id)).size).toBe(46);
    const parFamille = Object.fromEntries(
      ["mire", "pixels", "menu", "transitions", "tube", "arcade"].map((f) => [
        f,
        EFFETS.filter((e) => e.fam === f).length,
      ]),
    );
    expect(parFamille).toEqual({
      mire: 5,
      pixels: 8,
      menu: 8,
      transitions: 8,
      tube: 10,
      arcade: 7,
    });
  });

  it("« sobre » est exactement les effets discrets", () => {
    // La liste écrite à la main: un niveau changé dans le catalogue doit se voir.
    expect([...effetsDuNiveau("sobre")].sort()).toEqual(
      [
        "mire-vide",
        "palette",
        "tramage",
        "titres",
        "coins",
        "ombres",
        "nettes",
        "icones",
        "chiffres",
        "curseur",
        "boutons",
        "arrive",
        "fondu",
        "halo",
        "fronton",
        "places",
        "scores",
        "credit",
      ].sort(),
    );
  });

  it("« conseillé » est exactement ce que la page conseillait", () => {
    expect([...effetsDuNiveau("conseille")].sort()).toEqual(
      [...effetsDuNiveau("sobre"), "start", "mosaique", "extinction", "balayage", "neige"].sort(),
    );
  });

  it("« tout » allume les 45 effets visibles, jamais les sons", () => {
    const tout = effetsDuNiveau("tout");
    expect(tout.size).toBe(45);
    expect(tout.has("sons")).toBe(false);
    // Le jumeau: les effets marqués et refusés par la page y sont bien.
    for (const id of [
      "texte-pixel",
      "secousse",
      "defile",
      "grille",
      "scintille",
      "courbure",
    ] as const)
      expect(tout.has(id), id).toBe(true);
  });

  it("les niveaux s'emboîtent: sobre dans conseillé, conseillé dans tout", () => {
    const [sobre, conseille, tout] = NIVEAUX.map((n) => effetsDuNiveau(n));
    for (const id of sobre ?? []) expect(conseille?.has(id), id).toBe(true);
    for (const id of conseille ?? []) expect(tout?.has(id), id).toBe(true);
    // Et ils ne sont pas égaux: trois niveaux qui allumeraient la même chose
    // passeraient les deux boucles ci-dessus.
    expect(sobre?.size).toBeLessThan(conseille?.size ?? 0);
    expect(conseille?.size).toBeLessThan(tout?.size ?? 0);
  });
});

describe("le réglage stocké", () => {
  it("rend le défaut sans rien, ou pour une valeur illisible", () => {
    for (const brut of [null, "", "conseille", "{", "42", "null", "[]", '"tout"', "true"]) {
      expect(lireReglage(brut), String(brut)).toEqual({ niveau: NIVEAU_DEFAUT, sons: false });
    }
  });

  it("lit un niveau et des sons valides", () => {
    expect(lireReglage('{"niveau":"tout","sons":true}')).toEqual({ niveau: "tout", sons: true });
    expect(lireReglage('{"niveau":"sobre"}')).toEqual({ niveau: "sobre", sons: false });
  });

  it("garde chaque champ valide quand l'autre ne l'est pas", () => {
    expect(lireReglage('{"niveau":"TOUT","sons":true}')).toEqual({
      niveau: "conseille",
      sons: true,
    });
    expect(lireReglage('{"niveau":"tout","sons":"oui"}')).toEqual({ niveau: "tout", sons: false });
    // Un nom que porte tout objet n'est pas un niveau.
    expect(lireReglage('{"niveau":"toString"}').niveau).toBe("conseille");
    expect(lireReglage('{"__proto__":{"niveau":"tout"}}').niveau).toBe("conseille");
  });

  it("marche quand le navigateur refuse le stockage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("refusé");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("refusé");
    });
    expect(niveau()).toBe("conseille");
    expect(() => changerNiveau("tout")).not.toThrow();
    // Le réglage vaut pour l'onglet.
    expect(niveau()).toBe("tout");
  });
});

describe("le réglage sur la page", () => {
  it("pose les classes du niveau, data-effets et data-sons", () => {
    appliquer();
    expect(classesFx(racine)).toEqual(
      [...effetsDuNiveau("conseille")].map((id) => `fx-${id}`).sort(),
    );
    expect(racine.dataset.effets).toBe("conseille");
    expect(racine.dataset.sons).toBe("non");
  });

  it("change de niveau: écrit la clé, retire les classes de l'ancien, prévient", () => {
    const vus: Niveau[] = [];
    const arret = abonner((r) => vus.push(r.niveau));
    changerNiveau("tout");
    expect(JSON.parse(localStorage.getItem(CLE) ?? "{}")).toEqual({ niveau: "tout", sons: false });
    expect(racine.classList.contains("fx-scintille")).toBe(true);
    changerNiveau("sobre");
    // Le jumeau: une classe de « tout » ne survit pas au retour à « sobre ».
    expect(racine.classList.contains("fx-scintille")).toBe(false);
    expect(racine.classList.contains("fx-coins")).toBe(true);
    expect(effetActif("balayage")).toBe(false);
    arret();
    changerNiveau("conseille");
    expect(vus).toEqual(["tout", "sobre"]);
  });

  it("refuse un niveau inconnu au lieu de l'écrire", () => {
    expect(() => changerNiveau("fort" as Niveau)).toThrow();
    expect(localStorage.getItem(CLE)).toBeNull();
  });

  it("les sons sont un réglage à part, coupé par défaut", () => {
    changerNiveau("tout");
    expect(effetActif("sons")).toBe(false);
    expect(racine.classList.contains("fx-sons")).toBe(false);
    changerSons(true);
    expect(sonsMenu()).toBe(true);
    expect(effetActif("sons")).toBe(true);
    expect(racine.dataset.sons).toBe("oui");
    // Le niveau n'a pas bougé.
    expect(niveau()).toBe("tout");
    changerNiveau("sobre");
    expect(effetActif("sons")).toBe(true);
  });

  it("suit un autre onglet qui change la clé", () => {
    demarrer();
    expect(niveau()).toBe("conseille");
    localStorage.setItem(CLE, '{"niveau":"tout","sons":false}');
    window.dispatchEvent(new StorageEvent("storage", { key: CLE }));
    expect(niveau()).toBe("tout");
    expect(racine.dataset.effets).toBe("tout");
    // Le jumeau: une autre clé ne relit rien.
    localStorage.setItem(CLE, '{"niveau":"sobre","sons":false}');
    window.dispatchEvent(new StorageEvent("storage", { key: "nel3ab:theme" }));
    expect(niveau()).toBe("tout");
  });

  it("suit un autre onglet qui vide le stockage (clé nulle)", () => {
    // Un autre onglet fait `localStorage.clear()` : l'événement n'a pas de
    // clé, et le réglage revient au défaut (relecture finale du 25 novembre
    // 2026 : la garde `key === null` n'avait pas d'essai de comportement).
    demarrer();
    localStorage.setItem(CLE, '{"niveau":"tout","sons":false}');
    window.dispatchEvent(new StorageEvent("storage", { key: CLE }));
    expect(niveau()).toBe("tout");
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(niveau()).toBe(NIVEAU_DEFAUT);
    expect(racine.dataset.effets).toBe(NIVEAU_DEFAUT);
  });

  it("lit le mouvement réduit à chaque appel", () => {
    const media = vi.fn((requete: string) => ({ matches: requete.includes("reduce") }));
    vi.stubGlobal("matchMedia", media);
    expect(mouvementReduit()).toBe(true);
    media.mockImplementation(() => ({ matches: false }));
    expect(mouvementReduit()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("le script de l'en-tête", () => {
  /** Ce que le script pose sur une racine neuve, pour ce que le stockage contient.
   * Le contexte ne porte que ce qu'un navigateur lui donne. */
  function pose(brut: string | null) {
    localStorage.clear();
    if (brut !== null) localStorage.setItem(CLE, brut);
    const html = document.createElement("html");
    const ecouteurs: string[] = [];
    const fenetre = { addEventListener: (nom: string) => ecouteurs.push(nom) } as Record<
      string,
      unknown
    >;
    runInNewContext(scriptEnTete(), {
      localStorage: window.localStorage,
      document: { documentElement: html },
      window: fenetre,
    });
    return { html, ecouteurs, fenetre };
  }

  /** Ce que `appliquer` pose pour le même stockage. */
  function attendu(brut: string | null) {
    localStorage.clear();
    if (brut !== null) localStorage.setItem(CLE, brut);
    oublierPourEssai();
    const html = document.createElement("html");
    appliquer(html);
    return html;
  }

  const VALEURS: (string | null)[] = [
    null,
    "",
    "n'importe quoi",
    '{"niveau":"sobre"}',
    '{"niveau":"conseille"}',
    '{"niveau":"tout"}',
    '{"niveau":"tout","sons":true}',
    '{"niveau":"sobre","sons":true}',
    '{"niveau":"tout","sons":"true"}',
    '{"niveau":"toString"}',
    '{"__proto__":{"niveau":"tout"}}',
    "[]",
    "null",
  ];

  for (const brut of VALEURS) {
    it(`pose les mêmes classes que la page pour ${JSON.stringify(brut)}`, () => {
      const vu = pose(brut).html;
      const voulu = attendu(brut);
      expect(classesFx(vu)).toEqual(classesFx(voulu));
      expect(vu.dataset.effets).toBe(voulu.dataset.effets);
      expect(vu.dataset.sons).toBe(voulu.dataset.sons);
      // La précondition: chaque cas pose au moins les effets sobres.
      expect(classesFx(vu).length).toBeGreaterThanOrEqual(18);
    });
  }

  it("laisse de quoi reposer les classes, et écoute les autres onglets", () => {
    const { html, ecouteurs, fenetre } = pose('{"niveau":"sobre"}');
    expect(ecouteurs).toEqual(["storage"]);
    localStorage.setItem(CLE, '{"niveau":"tout"}');
    (fenetre.nel3abEffets as { appliquer: () => void }).appliquer();
    expect(html.dataset.effets).toBe("tout");
  });

  it("ne lève jamais, même sans stockage ni fenêtre", () => {
    const html = document.createElement("html");
    expect(() =>
      runInNewContext(scriptEnTete(), {
        localStorage: {
          getItem: () => {
            throw new Error("refusé");
          },
        },
        document: { documentElement: html },
      }),
    ).not.toThrow();
    expect(html.dataset.effets).toBe("conseille");
  });

  it("a le catalogue entier, et le jumeau sans un effet se voit", () => {
    const script = scriptEnTete();
    for (const effet of EFFETS) expect(script).toContain(`${effet.id}/${effet.niv}/`);
    const amputé = script.replace(" halo/d/o", "");
    const html = document.createElement("html");
    runInNewContext(amputé, {
      localStorage: window.localStorage,
      document: { documentElement: html },
    });
    expect(html.classList.contains("fx-halo")).toBe(false);
    expect(attendu(null).classList.contains("fx-halo")).toBe(true);
  });
});

it("chaque effet a son identifiant de classe sans caractère à échapper", () => {
  for (const effet of EFFETS) expect(effet.id as IdEffet).toMatch(/^[a-z][a-z-]*[a-z]$/);
});
