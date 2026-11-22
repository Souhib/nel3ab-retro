/**
 * Chaque classe `n3-` de la feuille de la page est portée par une source.
 *
 * La réécriture de la manette tactile Switch a laissé 85 lignes de
 * `.n3-switch-touch*` qu'aucun composant ne posait, et qui partaient pourtant
 * dans la page (vérification finale du 22 novembre 2026). Une règle morte ne
 * se voit pas à l'écran: elle se voit ici.
 */
import { describe, expect, it } from "vitest";

/* Les modules de Node sont importés à l'exécution, comme dans `regie.test.ts`:
   la page n'a pas les types de Node, et ne doit pas les avoir. */
type Fs = {
  readFileSync: (chemin: string, codage: "utf-8") => string;
  readdirSync: (chemin: string, options: { recursive: true }) => string[];
};
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
const ici = (relatif: string) => new URL(relatif, import.meta.url).pathname;
const SRC = ici("../");

/** Les classes `n3-` qu'une feuille déclare, sans doublon. */
const declarees = (css: string) => [...new Set(css.match(/\.n3-[a-z0-9-]+/g) ?? [])];

/** Celles qu'aucune source ne nomme. */
const mortes = (css: string, sources: string) =>
  declarees(css)
    .map((selecteur) => selecteur.slice(1))
    .filter((nom) => !new RegExp(`(?<![a-z0-9-])${nom}(?![a-z0-9-])`).test(sources));

const sources = fs
  .readdirSync(SRC, { recursive: true })
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("client/"))
  .map((f) => fs.readFileSync(`${SRC}${f}`, "utf-8"))
  .join("\n");

describe("les classes de la feuille", () => {
  it("trouve une classe que personne ne pose, et pas celle qu'on pose", () => {
    expect(mortes(".n3-a { } .n3-b-c { }", `<p className="n3-a" />`)).toEqual(["n3-b-c"]);
    // Un préfixe commun ne suffit pas: « n3-a » ne porte pas « n3-a-b ».
    expect(mortes(".n3-a-b { }", `<p className="n3-a" />`)).toEqual(["n3-a-b"]);
  });

  it("aucune classe d'index.css n'est morte", () => {
    const css = fs.readFileSync(`${SRC}index.css`, "utf-8");
    // La précondition: une lecture vide passerait sur rien.
    expect(declarees(css).length).toBeGreaterThan(50);
    expect(mortes(css, sources)).toEqual([]);
  });
});
