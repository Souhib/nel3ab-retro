/**
 * Le thème rétro arrive au salon tel que la salle le porte.
 *
 * Le salon sert ses pages sans la page React de la salle (accueil, dépôt,
 * carnet). Il reçoit au démarrage des copies écrites depuis les modules de la
 * salle, dans `control/nel3ab_control/api/routes/retro/`, et les pose par des
 * marques (`retro.py`):
 *
 * - `effets.css`, la feuille des effets, octet pour octet;
 * - `en-tete.html`, l'icône d'onglet et le script qui pose le réglage de
 *   l'appareil avant la première image (`scriptEnTete`);
 * - `logo.svg`, le logo, qui lit ses couleurs dans les jetons de la page;
 * - `reglage.html`, le réglage des effets au pied de l'accueil.
 *
 * Le même essai tient la page de la salle: son en-tête porte le même script
 * et la même icône (`front/index.html`), et la page construite aussi.
 *
 * Pour tout réécrire après un changement:
 *
 *     N3_SALON_ECRIRE=1 npx vitest run src/lib/salon-retro.test.ts
 */
import { describe, expect, it } from "vitest";

import { CLE, scriptEnTete } from "./effets";
import { reglageSalonHTML } from "./effets-salon";
import { iconeOngletDataUrl, logoSVG } from "./logo";

type Fs = {
  readFileSync: (chemin: string, codage: "utf-8") => string;
  writeFileSync: (chemin: string, contenu: string) => void;
  mkdirSync: (chemin: string, options: { recursive: true }) => void;
};
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
const ici = (relatif: string) => new URL(relatif, import.meta.url).pathname;
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const ECRIRE = env?.N3_SALON_ECRIRE === "1";

const SALON = ici("../../../control/nel3ab_control/api/routes/retro/");
const PAGE = ici("../../index.html");
const CONSTRUITE = ici("../../../core/crates/worker/src/page/index.html");

/** Ce que le salon pose dans l'en-tête de chaque page. */
const enTeteSalon = (): string =>
  `<link rel="icon" href="${iconeOngletDataUrl()}">\n<script>\n${scriptEnTete()}\n</script>\n`;

const COPIES: Record<string, () => string> = {
  "effets.css": () => fs.readFileSync(ici("../effets.css"), "utf-8"),
  "en-tete.html": enTeteSalon,
  "logo.svg": () => `${logoSVG({ unite: 2 })}\n`,
  "reglage.html": reglageSalonHTML,
};

/** Le bloc du script des effets dans l'en-tête de `index.html`. */
const BLOC = /(\/\* effets: début[\s\S]*?\*\/\n)([\s\S]*?)( *\/\* effets: fin \*\/)/;
const ICONE = /<link rel="icon" href="([^"]*)" \/>/;

if (ECRIRE) {
  fs.mkdirSync(SALON, { recursive: true });
  for (const [nom, contenu] of Object.entries(COPIES))
    fs.writeFileSync(`${SALON}${nom}`, contenu());
  const page = fs
    .readFileSync(PAGE, "utf-8")
    .replace(
      BLOC,
      (_tout, debut: string, _milieu: string, fin: string) => `${debut}${scriptEnTete()}\n${fin}`,
    )
    .replace(ICONE, `<link rel="icon" href="${iconeOngletDataUrl()}" />`);
  fs.writeFileSync(PAGE, page);
}

describe("les copies du salon", () => {
  for (const [nom, contenu] of Object.entries(COPIES)) {
    it(`retro/${nom} est celle que la salle produit`, () => {
      expect(fs.readFileSync(`${SALON}${nom}`, "utf-8"), `${nom} est périmé`).toBe(contenu());
    });
  }

  it("la copie de la feuille n'est pas vide, et le logo se nomme", () => {
    // Les préconditions: deux fichiers vides seraient « égaux » à rien.
    expect(COPIES["effets.css"]?.()).toContain(".fx-coins .rt-boite::before");
    expect(COPIES["logo.svg"]?.()).toContain('aria-label="nel3ab"');
    expect(COPIES["en-tete.html"]?.()).toContain('localStorage.getItem("nel3ab:effets")');
  });
});

describe("l'en-tête de la salle", () => {
  const page = fs.readFileSync(PAGE, "utf-8");

  it("porte le script des effets, tel que `scriptEnTete` l'écrit", () => {
    const bloc = BLOC.exec(page);
    expect(bloc, "les marques « effets: début » et « effets: fin » ont disparu").not.toBeNull();
    expect(bloc?.[2]).toBe(`${scriptEnTete()}\n`);
  });

  it("le script vit dans le seul script classique de l'en-tête, après le thème", () => {
    const tete = /<head>([\s\S]*?)<\/head>/.exec(page)?.[1] ?? "";
    const scripts = [...tete.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
    expect(scripts).toHaveLength(1);
    const script = scripts[0] ?? "";
    expect(script.indexOf("nel3ab:theme")).toBeGreaterThan(-1);
    expect(script.indexOf("nel3ab:effets")).toBeGreaterThan(script.indexOf("nel3ab:theme"));
  });

  it("porte l'icône d'onglet du logo", () => {
    expect(ICONE.exec(page)?.[1]).toBe(iconeOngletDataUrl());
  });

  it("la page construite porte le même script et la même icône", () => {
    // La page compilée dans le worker: un changement ici sans `just
    // front-build` la laisserait à l'ancienne.
    const construite = fs.readFileSync(CONSTRUITE, "utf-8");
    // `includes` plutôt que `toContain`: un échec imprimerait 800 ko de page.
    expect(construite.includes(scriptEnTete()), "script absent de la page construite").toBe(true);
    expect(construite.includes(iconeOngletDataUrl()), "icône absente de la page construite").toBe(
      true,
    );
  });
});

describe("le réglage au pied de l'accueil", () => {
  type Vm = { runInNewContext: (code: string, contexte: Record<string, unknown>) => unknown };
  const scripts = (html: string) =>
    [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");

  /** L'en-tête et le réglage, exécutés comme le salon les sert. */
  async function salon(stocke: string | null) {
    const { runInNewContext } = (await import(/* @vite-ignore */ `node:${"vm"}`)) as Vm;
    localStorage.clear();
    if (stocke !== null) localStorage.setItem(CLE, stocke);
    document.documentElement.className = "";
    const html = reglageSalonHTML();
    document.body.innerHTML = html.replace(/<script>[\s\S]*?<\/script>/g, "");
    const ecouteurs: ((e: { key: string | null }) => void)[] = [];
    const fenetre: Record<string, unknown> = {
      addEventListener: (_nom: string, f: (e: { key: string | null }) => void) => ecouteurs.push(f),
    };
    const contexte = { localStorage: window.localStorage, document, window: fenetre, JSON, Object };
    for (const script of [scriptEnTete(), ...scripts(html)]) runInNewContext(script, contexte);
    const coche = () =>
      (document.querySelector('input[name="rt-niveau"]:checked') as HTMLInputElement | null)?.value;
    return { coche, ecouteurs };
  }

  it("montre le niveau de l'appareil, et le défaut sans rien", async () => {
    expect((await salon(null)).coche()).toBe("conseille");
    expect((await salon('{"niveau":"tout","sons":true}')).coche()).toBe("tout");
    expect((document.querySelector('input[name="rt-sons"]') as HTMLInputElement).checked).toBe(
      true,
    );
    expect((await salon('{"niveau":"toString"}')).coche()).toBe("conseille");
  });

  it("choisir un niveau écrit la clé de la salle et repose les classes", async () => {
    await salon(null);
    expect(document.documentElement.classList.contains("fx-scintille")).toBe(false);
    const tout = document.querySelector('input[value="tout"]') as HTMLInputElement;
    tout.click();
    expect(JSON.parse(localStorage.getItem(CLE) ?? "{}")).toEqual({ niveau: "tout", sons: false });
    expect(document.documentElement.classList.contains("fx-scintille")).toBe(true);
    expect(document.documentElement.dataset.effets).toBe("tout");
    // Les sons, à part.
    (document.querySelector('input[name="rt-sons"]') as HTMLInputElement).click();
    expect(JSON.parse(localStorage.getItem(CLE) ?? "{}")).toEqual({ niveau: "tout", sons: true });
    expect(document.documentElement.dataset.sons).toBe("oui");
  });

  it("suit un changement fait dans une salle ouverte dans un autre onglet", async () => {
    const { coche, ecouteurs } = await salon('{"niveau":"sobre"}');
    expect(coche()).toBe("sobre");
    localStorage.setItem(CLE, '{"niveau":"tout"}');
    for (const f of ecouteurs) f({ key: CLE });
    expect(coche()).toBe("tout");
    expect(document.documentElement.dataset.effets).toBe("tout");
  });

  it("prend ses mots dans le lexique de la salle", () => {
    const html = reglageSalonHTML();
    for (const mot of ["effets rétro", "sobre", "conseillé", "tout", "sons de menu"])
      expect(html).toContain(mot);
  });
});
