/**
 * Le paquet d'Aïn pour le salon (`control/.../routes/retro/ain.js`) : il est
 * celui que ses sources produisent, il pèse ce qu'on a dit, et il marche
 * quand une page du salon le charge.
 *
 * La marque `ain.SOURCES` est écrite par la construction (`just ain-salon`,
 * `vite.ain-salon.config.ts`) : l'empreinte du paquet, puis celle de chaque
 * module lu. Un module changé sans reconstruire, ou le paquet remplacé à la
 * main, rend cet essai rouge, comme `stamp.mjs --check` pour la page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Fs = { readFileSync: (chemin: string) => Uint8Array };
type Crypto = {
  createHash: (a: string) => { update: (b: Uint8Array) => { digest: (e: "hex") => string } };
};
type Zlib = {
  brotliCompressSync: (b: Uint8Array, o: { params: Record<number, number> }) => Uint8Array;
  constants: { BROTLI_PARAM_QUALITY: number };
};
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
const { createHash } = (await import(/* @vite-ignore */ `node:${"crypto"}`)) as Crypto;
const zlib = (await import(/* @vite-ignore */ `node:${"zlib"}`)) as Zlib;

// Par une fonction : Vite réécrit un `new URL("…", import.meta.url)` littéral
// en adresse de fichier servi, sans la barre finale.
const ici = (relatif: string) => new URL(relatif, import.meta.url).pathname;
const RACINE = ici("../../../");
const RETRO = `${RACINE}control/nel3ab_control/api/routes/retro/`;
const lire = (relatif: string) => fs.readFileSync(`${RACINE}${relatif}`);
const empreinte = (octets: Uint8Array) => createHash("sha256").update(octets).digest("hex");

/** Ce que le paquet a le droit de peser en brotli 11 : 15 237 octets mesurés
 * le 23 novembre 2026 (dessin, moteur, lecteur, 27 scènes, rendu, et les
 * effets pour le niveau), 16 222 le 24 novembre après les retouches d'Aïn,
 * puis 17 168 quand le salon y a mis les gestes d'arcade du socle
 * (`salon/paquet.ts` : Start, démo, initiales, +946 octets), et 18 170 avec
 * les calques de la mire, l'écran bombé et la flèche en pixels (+1 002).
 * Plus 8 % pour les retouches. Le salon le charge à part de la page de la
 * salle : il ne compte pas dans ses 300 000. */
const PLAFOND = 19_600;
const poids = (octets: Uint8Array) =>
  zlib.brotliCompressSync(octets, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length;

/** Les entrées périmées d'une marque : le paquet, ou les modules dont
 * l'empreinte a changé ou qui ont disparu. */
function perimes(marque: string, lu: (relatif: string) => Uint8Array): string[] {
  const res: string[] = [];
  for (const ligne of marque.split("\n")) {
    const [sorte, h, chemin] = ligne.split(" ");
    if (sorte === "paquet" && empreinte(lu("control/nel3ab_control/api/routes/retro/ain.js")) !== h)
      res.push("paquet");
    if (sorte === "entree" && chemin) {
      let octets: Uint8Array | null = null;
      try {
        octets = lu(chemin);
      } catch {
        /* un module effacé */
      }
      if (!octets || empreinte(octets) !== h) res.push(chemin);
    }
  }
  return res;
}

const MARQUE = new TextDecoder().decode(fs.readFileSync(`${RETRO}ain.SOURCES`));
const PAQUET = fs.readFileSync(`${RETRO}ain.js`);

describe("la marque du paquet", () => {
  it("nomme le paquet et les modules d'Aïn, et aucun de node_modules", () => {
    const entrees = MARQUE.split("\n")
      .filter((l) => l.startsWith("entree "))
      .map((l) => l.split(" ")[2]);
    expect(MARQUE).toMatch(/^paquet [0-9a-f]{64}$/m);
    expect(entrees).toEqual(
      expect.arrayContaining([
        "front/src/salon/paquet.ts",
        "front/src/retro/arcade.ts",
        "front/src/mascotte/salon.ts",
        "front/src/mascotte/rendu.ts",
        "front/src/mascotte/scenes-ain.ts",
        "front/package-lock.json",
        "front/vite.ain-salon.config.ts",
      ]),
    );
    // React n'a rien à faire au salon : 22 245 octets de plus s'il revient.
    expect(entrees.filter((e) => e?.includes("node_modules"))).toEqual([]);
  });

  it("le paquet est celui que ses sources produisent", () => {
    expect(
      perimes(MARQUE, lire),
      "Lancer `just ain-salon` et committer le paquet et sa marque.",
    ).toEqual([]);
  });

  it("jumeau : un module retouché sans reconstruire, ou le paquet remplacé, est vu", () => {
    const retouche = (chemin: string) => (relatif: string) =>
      relatif === chemin ? new Uint8Array([...lire(relatif), 10]) : lire(relatif);
    expect(perimes(MARQUE, retouche("front/src/mascotte/lecteur.ts"))).toEqual([
      "front/src/mascotte/lecteur.ts",
    ]);
    expect(perimes(MARQUE, retouche("control/nel3ab_control/api/routes/retro/ain.js"))).toEqual([
      "paquet",
    ]);
    expect(
      perimes(MARQUE, (r) => {
        if (r.endsWith("moteur.ts")) throw new Error("effacé");
        return lire(r);
      }),
    ).toEqual(["front/src/mascotte/moteur.ts"]);
  });

  it(`pèse au plus ${PLAFOND} octets en brotli 11`, () => {
    expect(poids(PAQUET)).toBeLessThanOrEqual(PLAFOND);
    // Le jumeau : des octets sans redondance de la même taille dépassent.
    let x = 2463534242;
    const bruit = new Uint8Array(PLAFOND + 1000).map(() => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return x & 255;
    });
    expect(poids(bruit)).toBeGreaterThan(PLAFOND);
  });
});

describe("le paquet dans une page du salon", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      writable: true,
      value: () => ({}),
    });
    delete (globalThis as { nel3abAin?: unknown }).nel3abAin;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (Element.prototype as { animate?: unknown }).animate;
    document.body.innerHTML = "";
  });

  /** Charge le paquet comme le salon le servira : un script classique,
   * après le corps de la page. */
  const charger = () => new Function(new TextDecoder().decode(PAQUET))();
  type Crochet = { scene: (s: string, o?: { ou?: string }) => string; monter: () => number };
  const crochet = () => (globalThis as unknown as { nel3abAin: Crochet }).nel3abAin;

  it("peint Aïn dans le logo au chargement, et joue une scène du salon", () => {
    document.body.innerHTML =
      '<header><div data-hote="logo"></div></header><main><p>Salon</p></main>';
    charger();
    expect(document.querySelector('[data-hote="logo"] > canvas.rt-mascotte')).not.toBeNull();
    // Sans ancre du dépôt dans cette page, la scène se replie : jamais une erreur.
    expect(crochet().scene("depot")).toMatch(/^(complete|courte|pose|cle)$/);
    expect(crochet().scene("depot", { ou: "ailleurs" })).toBe("sans-hote");
  });

  it("donne au salon les gestes d'arcade du socle, sous nel3abSalon", () => {
    delete (globalThis as { nel3abSalon?: unknown }).nel3abSalon;
    document.body.innerHTML = "<main><p>Salon</p></main>";
    charger();
    const salon = (globalThis as unknown as { nel3abSalon: Record<string, unknown> }).nel3abSalon;
    expect(Object.keys(salon).sort()).toEqual([
      "initiales",
      "poserCalquesAttente",
      "poserFiltreBombe",
      "surAttention",
      "surInactivite",
      "surStart",
    ]);
    // La flèche en pixels de l'effet « pointeur », posée une fois sur la racine.
    expect(document.documentElement.style.getPropertyValue("--rt-pointeur")).toMatch(
      /^url\("data:image\/svg\+xml,/,
    );
    expect((salon.initiales as (n: string) => string)("Élodie")).toBe("ELO");
    // surStart rend la fonction qui arrête d'écouter : appelée, elle ne lève rien.
    const arreter = (salon.surStart as (r: () => void) => () => void)(() => {});
    expect(typeof arreter).toBe("function");
    arreter();
  });

  it("jumeau : une page sans hôte ne reçoit rien", () => {
    document.body.innerHTML = "<main><p>Salon</p></main>";
    charger();
    expect(document.querySelector("canvas.rt-mascotte")).toBeNull();
    expect(crochet().monter()).toBe(0);
  });
});
