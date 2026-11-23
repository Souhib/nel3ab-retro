/**
 * Les marques du pas à pas n'avancent par marches qu'avec l'effet
 * « paliers » (niveau tout) : sans lui, elles glissent. Le plan des manettes
 * le range au niveau tout ; jusqu'au 23 novembre 2026, `steps()` y était
 * posé sans condition, pour tous les niveaux.
 */
import { describe, expect, it } from "vitest";

/* Les modules de Node sont importés à l'exécution, comme dans `classes.test.ts`. */
type Fs = { readFileSync: (chemin: string, codage: "utf-8") => string };
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
// Le dossier d'abord : Vite réécrit `new URL("./x.css", import.meta.url)`.
const ici = (relatif: string) => new URL(relatif, import.meta.url).pathname;
const css = fs.readFileSync(`${ici("./")}reglage.css`, "utf-8");

/** Les règles de la feuille, sans commentaires : [sélecteur, corps]. */
const regles = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
  (m) => [m[1]!.trim(), m[2]!] as const,
);

describe("les paliers des marques", () => {
  it("aucune marche hors de .fx-paliers", () => {
    const sans = regles.filter(([sel, corps]) => /steps\(/.test(corps) && !/\.fx-paliers/.test(sel));
    expect(sans.map(([sel]) => sel)).toEqual([]);
  });

  it("sous .fx-paliers, les coins, la flèche et la liaison avancent par quatre marches", () => {
    const avec = regles.filter(([sel, corps]) => /\.fx-paliers/.test(sel) && /steps\(4/.test(corps));
    const selecteurs = avec.map(([sel]) => sel).join(" ");
    for (const piece of [".n3-coins", ".n3-fleche", ".n3-liaison"]) expect(selecteurs).toContain(piece);
  });
});
