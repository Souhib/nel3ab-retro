/**
 * Le script de l'en-tête et `storedTheme()` disent la même chose.
 *
 * Le thème est lu deux fois: par un script classique dans l'en-tête de
 * `index.html`, qui tourne avant la première image, puis par `storedTheme()`
 * quand React se monte. S'ils divergeaient, la page changerait de couleur sous
 * les yeux au chargement, ce que le script est justement venu empêcher.
 *
 * Le script tourne ici dans un contexte `vm` qui ne porte QUE ce qu'un
 * navigateur lui donne: `localStorage` et `document`. Un script qui lirait
 * autre chose lèverait une erreur, au lieu de trouver un nom que vitest aurait
 * posé (la leçon du 11 novembre 2026, CLAUDE.md règle 4).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { storedTheme } from "./theme";

/* Les modules de Node sont importés à l'exécution, comme dans `regie.test.ts`:
   la page n'a pas les types de Node, et ne doit pas les avoir. */
type Fs = { readFileSync: (chemin: string, codage: "utf-8") => string };
type Vm = { runInNewContext: (code: string, contexte: Record<string, unknown>) => unknown };
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
const { runInNewContext } = (await import(/* @vite-ignore */ `node:${"vm"}`)) as Vm;
const ici = (relatif: string) => new URL(relatif, import.meta.url).pathname;

const SOURCE = fs.readFileSync(ici("../../index.html"), "utf-8");
const BUILT = fs.readFileSync(ici("../../../core/crates/worker/src/page/index.html"), "utf-8");

/** Le corps du script classique de l'en-tête: sans `type` ni `src`. */
function enTete(html: string): string {
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1];
  if (!head) throw new Error("pas d'en-tête");
  const scripts = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (found) => found[1] ?? "",
  );
  if (scripts.length !== 1)
    throw new Error(`${scripts.length} scripts classiques dans l'en-tête, 1 attendu`);
  return scripts[0] ?? "";
}

/** Ce que le script pose, pour ce que le stockage contient. */
function pose(script: string): string | undefined {
  const document = { documentElement: { dataset: {} as Record<string, string> } };
  runInNewContext(script, { localStorage: window.localStorage, document });
  return document.documentElement.dataset.theme;
}

const VALEURS: (string | null)[] = [
  null,
  "auto",
  "nuit",
  "jour",
  "instrument-sombre",
  "phosphore",
  "ambre",
  "instrument-clair",
  "indigo",
  "famicom",
  "gameboy",
  "",
  "NUIT",
  "inconnu",
  // Des noms que porte tout objet: une table lue sans `hasOwn` les prendrait
  // pour des thèmes.
  "__proto__",
  "toString",
  "constructor",
  "hasOwnProperty",
];

function stocker(value: string | null) {
  localStorage.clear();
  if (value !== null) localStorage.setItem("nel3ab:theme", value);
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("le thème de l'en-tête", () => {
  const script = enTete(SOURCE);

  it.each(VALEURS.map((value) => [value]))("pose ce que storedTheme() lit pour %j", (value) => {
    stocker(value);
    expect(pose(script)).toBe(storedTheme());
  });

  it("retombe sur l'appareil quand le stockage est refusé, comme storedTheme()", () => {
    stocker("nuit");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("refusé", "SecurityError");
    });
    expect(storedTheme()).toBe("auto");
    expect(pose(script)).toBe("auto");
  });

  it("voit un script qui oublierait les anciens thèmes", () => {
    // Le jumeau: une comparaison qui ne verrait rien passerait pour un accord.
    const oublieux = script.replace(/var anciens = \{[\s\S]*?\};/, "var anciens = {};");
    expect(oublieux).not.toBe(script);
    const desaccords = VALEURS.filter((value) => {
      stocker(value);
      return pose(oublieux) !== storedTheme();
    });
    expect(desaccords).toEqual([
      "instrument-sombre",
      "phosphore",
      "ambre",
      "instrument-clair",
      "indigo",
      "famicom",
      "gameboy",
    ]);
  });

  it("voit un script qui lirait la table sans `hasOwn`", () => {
    const naif = script.replace(
      "Object.prototype.hasOwnProperty.call(anciens, lu)",
      "anciens[lu] !== undefined",
    );
    expect(naif).not.toBe(script);
    stocker("toString");
    expect(pose(naif)).not.toBe(storedTheme());
  });

  it("est un script classique de l'en-tête, avant le corps", () => {
    // Un `type="module"` le différerait après la lecture du document: c'est
    // exactement le retard qu'il corrige.
    const head = /<head>([\s\S]*?)<\/head>/.exec(SOURCE)?.[1] ?? "";
    expect(head).toContain(`<script>${script}</script>`);
    expect(SOURCE.indexOf(script)).toBeLessThan(SOURCE.indexOf("<body"));
  });

  it("part tel quel dans la page construite, avant le corps", () => {
    // La politique du worker nomme ce script par son empreinte: un caractère
    // changé par la construction et il ne tournerait plus. Cherché tel quel
    // plutôt que relu par une expression: le module construit contient lui
    // aussi des « <script> » dans ses chaînes.
    const at = BUILT.indexOf(`<script>${script}</script>`);
    expect(at, "le script de l'en-tête n'est pas dans la page construite").toBeGreaterThan(-1);
    expect(at).toBeLessThan(BUILT.indexOf("<body"));
  });
});
