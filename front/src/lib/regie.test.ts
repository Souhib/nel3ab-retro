/**
 * Les jetons de la régie, calculés plutôt que crus.
 *
 * `src/regie.css` est le seul endroit où une couleur de la salle et du salon
 * est choisie. Cet essai le lit tel qu'il est sur le disque, résout chaque rôle
 * jusqu'à sa primitive, et calcule le contraste de chaque paire qui sera
 * réellement posée l'une sur l'autre, dans les DEUX thèmes. Une valeur changée
 * « pour que ce soit plus doux » tombe ici, pas sous les yeux d'un joueur.
 *
 * Ce qu'il ne voit pas: une opacité ajoutée dans un composant, ou un fond peint
 * en dur. C'est le rôle de `spikes/m3-browser-drive/contraste.mjs`, qui mesure
 * le rendu. Les deux se complètent, aucun ne remplace l'autre.
 *
 * Pour recopier la feuille dans le salon après l'avoir changée:
 *
 *     N3_REGIE_ECRIRE=1 npx vitest run src/lib/regie.test.ts
 */
import { describe, expect, it } from "vitest";

import { PLAYER_COLOURS } from "../media/players";
import { AA_TEXT, contrast, declarations, mix, resolve } from "./contrast";

/* Les modules de Node sont importés à l'exécution, comme dans
   `bobine/statique.test.tsx`: la page n'a pas les types de Node, et ne doit pas
   les avoir. */
type Fs = {
  readFileSync: (chemin: string, codage: "utf-8") => string;
  writeFileSync: (chemin: string, contenu: string) => void;
  readdirSync: (chemin: string, options?: { recursive: true }) => string[];
};
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
const ici = (relatif: string) => new URL(relatif, import.meta.url).pathname;
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;

const SOURCE = ici("../regie.css");
const SALON = ici("../../../control/nel3ab_control/api/routes/regie.css");
const css = fs.readFileSync(SOURCE, "utf-8");

/** Les primitives, posées sur `:root` seul, puis les jetons de composant, qui
 * le sont aussi sur `.regie-nuit`. Aucun des deux ne dépend d'un thème. */
const RACINE = new Map([...declarations(css, ":root"), ...declarations(css, ":root, .regie-nuit")]);
const NUIT = declarations(css, ':root, :root[data-theme="nuit"], .regie-nuit');
const JOUR_SYSTEME = declarations(css, ':root:not([data-theme="nuit"])');
const JOUR_CHOISI = declarations(css, ':root[data-theme="jour"]');

const THEMES = { nuit: NUIT, jour: JOUR_CHOISI } as const;
/** La couleur finale d'un rôle dans un thème, primitives comprises. */
const couleur = (theme: keyof typeof THEMES, nom: string) => resolve(nom, THEMES[theme], RACINE);

/** Les surfaces sur lesquelles du texte est posé. `--survol` en fait partie:
 * un bouton survolé garde son libellé. */
const SURFACES = ["--fond", "--plaque", "--creux", "--survol"] as const;

describe("la feuille se lit", () => {
  it("trouve les quatre blocs, et chacun déclare quelque chose", () => {
    // Sans cette précondition, un sélecteur renommé rendrait des blocs vides et
    // tous les essais ci-dessous passeraient sur zéro paire.
    for (const bloc of [RACINE, NUIT, JOUR_SYSTEME, JOUR_CHOISI]) {
      expect(bloc.size).toBeGreaterThan(5);
    }
  });

  it("refuse un nom qui n'existe pas au lieu de rendre une couleur au hasard", () => {
    expect(() => couleur("nuit", "--n-existe-pas")).toThrow();
  });
});

describe("le texte, dans les deux régies", () => {
  for (const theme of ["nuit", "jour"] as const) {
    for (const encre of ["--encre", "--legende", "--discret", "--signal", "--alerte", "--ok"]) {
      for (const surface of SURFACES) {
        it(`${theme}: ${encre} sur ${surface} tient 4,5:1`, () => {
          expect(contrast(couleur(theme, encre), couleur(theme, surface))).toBeGreaterThanOrEqual(
            AA_TEXT,
          );
        });
      }
    }
  }

  it("le signal se lit sur sa propre teinte de sélection", () => {
    // La ligne choisie d'un menu est teintée du signal à 18 % (Picker.tsx), et
    // « en cours » y est écrit en signal. Mesuré par contraste.mjs le
    // 22 novembre 2026: 4,36:1 avec le premier violet de nuit.
    for (const theme of ["nuit", "jour"] as const) {
      const signal = couleur(theme, "--signal");
      const teinte = mix(signal, couleur(theme, "--plaque"), 0.18);
      expect(contrast(signal, teinte), theme).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("le bouton plein se lit: son encre sur son fond", () => {
    for (const theme of ["nuit", "jour"] as const) {
      const fond = couleur(theme, "--bouton-plein-fond");
      expect(contrast(couleur(theme, "--bouton-plein-encre"), fond)).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
      expect(
        contrast(couleur(theme, "--bouton-plein-encre"), couleur(theme, "--bouton-plein-survol")),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe("ce qui n'est pas du texte", () => {
  for (const theme of ["nuit", "jour"] as const) {
    it(`${theme}: le trait et l'anneau de focus tiennent 3:1 sur chaque surface`, () => {
      // Le trait dessine les cadres des champs et les cases vides des jauges:
      // invisible, il fait disparaître l'échelle (mesuré au salon, 1,54:1).
      for (const surface of SURFACES) {
        expect(contrast(couleur(theme, "--trait"), couleur(theme, surface))).toBeGreaterThanOrEqual(
          3,
        );
        expect(contrast(couleur(theme, "--focus"), couleur(theme, surface))).toBeGreaterThanOrEqual(
          3,
        );
      }
    });
  }

  it("le filet, lui, est un décor: il ne doit pas passer pour un trait", () => {
    // Le jumeau du précédent. Deux jetons qui finiraient égaux ne diraient plus
    // la différence entre une ligne qui informe et une ligne qui sépare.
    for (const theme of ["nuit", "jour"] as const) {
      expect(contrast(couleur(theme, "--filet"), couleur(theme, "--plaque"))).toBeLessThan(3);
    }
  });
});

describe("la zone d'image", () => {
  it("reste noire dans les deux régies", () => {
    // Des bandes claires autour d'une image 4:3 tirent l'oeil vers les bords.
    expect(couleur("nuit", "--ecran")).toBe("#000000");
    expect(couleur("jour", "--ecran")).toBe("#000000");
  });
});

describe("une teinte, un sens: les quatre joueurs", () => {
  it("les aplats sont ceux de la page, et ne changent pas avec le thème", () => {
    // Le joueur 1 reste rouge quoi qu'il arrive; une couleur de joueur qui
    // suivrait l'ambiance repeindrait le joueur.
    PLAYER_COLOURS.forEach((attendue, rang) => {
      expect(resolve(`--p${rang + 1}`, RACINE)).toBe(attendue);
      expect(couleur("nuit", `--p${rang + 1}`)).toBe(attendue);
      expect(couleur("jour", `--p${rang + 1}`)).toBe(attendue);
    });
  });

  for (const theme of ["nuit", "jour"] as const) {
    it(`${theme}: « P1 » à « P4 » se lisent, sur chaque surface et sur la case teintée du joueur`, () => {
      // Le cas de l'audit du 22 novembre 2026: « P3 » en #d9b64a sur le thème
      // clair tombait à 1,81:1. La case d'une place prise est teintée de la
      // couleur du joueur à 12 % (Lobby.tsx), donc elle compte aussi.
      for (let port = 1; port <= 4; port += 1) {
        const encre = couleur(theme, `--p${port}-encre`);
        const teinte = mix(couleur(theme, `--p${port}`), couleur(theme, "--plaque"), 0.12);
        for (const surface of [...SURFACES.map((s) => couleur(theme, s)), teinte]) {
          expect(contrast(encre, surface), `P${port} sur ${surface}`).toBeGreaterThanOrEqual(
            AA_TEXT,
          );
        }
      }
    });
  }

  it("l'aplat du joueur 3 ne suffit pas comme encre en régie de jour", () => {
    // Le jumeau négatif: si cet aplat passait, la seconde encre ne servirait à
    // rien et l'essai au-dessus ne prouverait rien de plus que celui-ci.
    expect(contrast(couleur("jour", "--p3"), couleur("jour", "--plaque"))).toBeLessThan(AA_TEXT);
  });

  it("aucun rôle de la page n'emprunte une couleur de joueur", () => {
    // Le jaune était la salle 1 à l'accueil ET le joueur 3 dans la salle. Un
    // rôle qui pointerait sur une primitive de joueur referait ce mélange.
    for (const bloc of [NUIT, JOUR_CHOISI, RACINE]) {
      for (const [nom, valeur] of bloc) {
        if (/^--p[1-4](-encre)?$/.test(nom)) continue;
        expect(valeur, nom).not.toMatch(/--joueur-/);
      }
    }
  });
});

describe("les deux portes de la régie de jour", () => {
  it("le système et le choix posent exactement les mêmes valeurs", () => {
    // Le bloc est écrit deux fois, parce qu'une règle sous `@media` ne peut pas
    // partager son sélecteur avec une règle qui n'y est pas. Deux copies qui
    // divergent donneraient deux régies de jour selon le chemin.
    expect([...JOUR_SYSTEME]).toEqual([...JOUR_CHOISI]);
  });

  it("la nuit et le jour déclarent les mêmes rôles", () => {
    // Un rôle oublié dans un thème retomberait sur la valeur de l'autre: du
    // texte clair sur fond clair, sans erreur nulle part.
    expect([...NUIT.keys()].sort()).toEqual([...JOUR_CHOISI.keys()].sort());
  });
});

describe("personne d'autre ne choisit une couleur de la régie", () => {
  /** Chaque nom que la feuille déclare: primitives, rôles et composants. */
  const JETONS = new Set([...css.matchAll(/(?<![\w-])(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  /** Les jetons de la régie qu'un texte déclare à nouveau: en CSS
   * (`--encre: …`) comme dans un style en ligne (`"--encre": …`). */
  const redeclares = (texte: string) =>
    [...texte.matchAll(/(?<![\w-])(--[a-z0-9-]+)["']?\s*:/g)]
      .map((m) => m[1])
      .filter((nom) => JETONS.has(nom));

  it("lit la liste dans la feuille, et sait la lire", () => {
    // La précondition et ses jumeaux: une liste vide rendrait l'essai muet, et
    // un motif trop large prendrait `--color-fond` (le nom Tailwind) pour
    // `--fond`.
    for (const nom of ["--fond", "--encre", "--signal", "--p3-encre", "--ecran", "--joueur-1"]) {
      expect(JETONS.has(nom), nom).toBe(true);
    }
    expect(redeclares("@theme { --color-fond: var(--fond); }")).toEqual([]);
    expect(redeclares(".x { color: var(--encre); }")).toEqual([]);
    expect(redeclares(".tampon { --encre: var(--alerte); }")).toEqual(["--encre"]);
    expect(redeclares('style={{ "--signal": "#f0f" }}')).toEqual(["--signal"]);
  });

  it("aucune feuille, aucun composant ni aperçu de la page ne redéclare un jeton", () => {
    // Un rôle reposé ailleurs contourne cet essai: les contrastes calculés
    // plus haut sont ceux de la feuille, pas ceux qu'un composant aurait mis
    // par-dessus. Relecture du 22 novembre 2026: le garde du salon ne
    // cherchait que cinq rôles, et `--encre` redéclaré passait.
    const racine = ici("../../");
    const fichiers = [
      ...fs
        .readdirSync(ici("../"), { recursive: true })
        .filter((f) => /\.(css|tsx?)$/.test(f) && !/\.test\.tsx?$/.test(f))
        .map((f) => `src/${f}`)
        .filter((f) => f !== "src/regie.css"),
      ...fs.readdirSync(racine).filter((f) => f.endsWith(".html")),
    ];
    // La précondition: sans fichiers lus, l'essai ne prouverait rien.
    expect(fichiers).toContain("src/index.css");
    expect(fichiers).toContain("bench-preview.html");
    const fautes = fichiers.flatMap((f) =>
      redeclares(fs.readFileSync(`${racine}${f}`, "utf-8")).map((nom) => `${f}: ${nom}`),
    );
    expect(fautes).toEqual([]);
  });
});

describe("ce qui flotte sur l'image garde la régie de nuit", () => {
  /** Les rôles qui changent d'un thème à l'autre. */
  const ROLES = new Set(NUIT.keys());
  /** Les blocs posés sur `:root` qui calculent un jeton à partir d'un rôle.
   *
   * Une propriété personnalisée qui vaut `var(--encre)` est calculée là où elle
   * est déclarée, puis héritée TOUTE FAITE. Déclarée sur `:root` seul, elle
   * garde sous `.regie-nuit` la valeur du jour: une plaque blanche posée sur
   * l'image noire (relecture du 22 novembre 2026, `bg-panel` sous `#unbare`).
   * Un tel bloc doit donc être reposé sur `.regie-nuit`. */
  const blocsSansNuit = (texte: string) => {
    const nu = texte.replace(/\/\*[\s\S]*?\*\//g, "");
    const fautes: string[] = [];
    let calcules = 0;
    for (const [, tete = "", corps = ""] of nu.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selecteurs = (tete.split(";").pop() ?? "").split(",").map((part) => part.trim());
      if (!selecteurs.includes(":root")) continue;
      const derives = [...corps.matchAll(/(--[\w-]+)\s*:([^;]+);/g)].filter(([, , valeur = ""]) =>
        [...valeur.matchAll(/var\(\s*(--[\w-]+)/g)].some(([, nom = ""]) => ROLES.has(nom)),
      );
      if (derives.length === 0) continue;
      calcules += 1;
      if (!selecteurs.includes(".regie-nuit")) {
        fautes.push(`${selecteurs.join(", ")} { ${derives.map(([, nom]) => nom).join(" ")} }`);
      }
    }
    return { calcules, fautes };
  };

  it("sait reconnaître un bloc fautif, et laisse passer un bloc sans rôle", () => {
    // Les jumeaux du garde: sans eux, un motif qui ne lit rien passerait vert.
    expect(blocsSansNuit(":root { --bouton: var(--encre); }").fautes).toHaveLength(1);
    expect(blocsSansNuit(":root, .regie-nuit { --bouton: var(--encre); }").fautes).toEqual([]);
    expect(blocsSansNuit(":root { --touche: clamp(34px, 9vmin, 52px); }")).toEqual({
      calcules: 0,
      fautes: [],
    });
  });

  for (const [nom, chemin] of [
    ["regie.css", "../regie.css"],
    ["index.css", "../index.css"],
  ] as const) {
    it(`${nom}: chaque jeton calculé depuis un rôle est aussi calculé sous .regie-nuit`, () => {
      const { calcules, fautes } = blocsSansNuit(fs.readFileSync(ici(chemin), "utf-8"));
      // La précondition: le bloc des composants (regie.css) et celui des
      // anciens noms (index.css) existent et ont bien été lus.
      expect(calcules).toBeGreaterThan(0);
      expect(fautes).toEqual([]);
    });
  }
});

it("la copie du salon est celle de la page", () => {
  // Le salon sert ses pages sans la page React: il reçoit la même feuille,
  // recopiée, et cet essai échoue si la copie dérive.
  if (env?.N3_REGIE_ECRIRE === "1") fs.writeFileSync(SALON, css);
  expect(fs.readFileSync(SALON, "utf-8"), "control/.../routes/regie.css est périmé").toBe(css);
});
