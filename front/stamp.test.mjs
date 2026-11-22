// La marque de la page ne dépend que de ce qu'un commit emporte.
//
// Le 22 novembre 2026, la marque committée hachait un cache de vitest de
// 83 octets, `src/node_modules/.vite/vitest/.../results.json`, ignoré par git et
// présent dans un seul worktree. `just check` y sortait 0, et sur une copie
// propre du même commit `stamp.mjs --check` disait « les sources de la page ont
// changé ». La porte était verte sur une seule machine.
//
// Chaque essai bâtit un petit dépôt jetable: rien ne lit ni n'écrit le vrai.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { empreinteDesSources, entreesDeLaPage } from "./stamp.mjs";

const INPUTS = ["src", "index.html"];
const made = [];

function ecrire(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** Un dépôt avec ses sources suivies, comme après un `git add`. */
function depot() {
  const root = mkdtempSync(join(tmpdir(), "marque-"));
  made.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  ecrire(root, ".gitignore", "node_modules/\n.DS_Store\n");
  ecrire(root, "index.html", "<!doctype html>");
  ecrire(root, "src/App.tsx", "export const a = 1;\n");
  ecrire(root, "src/lib/b.ts", "export const b = 2;\n");
  ecrire(root, "src/lib/b.test.ts", "// un essai\n");
  ecrire(root, "src/test/setup.ts", "// la mise en place des essais\n");
  execFileSync("git", ["add", "-A"], { cwd: root });
  return root;
}

afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("la marque de la page", () => {
  it("ne voit pas un cache ignoré par git sous src", () => {
    const root = depot();
    const avant = empreinteDesSources(root, INPUTS);
    ecrire(root, "src/node_modules/.vite/vitest/da39a3/results.json", '{"version":"4.1.10"}');
    ecrire(root, "src/lib/.DS_Store", "\u0000");
    expect(empreinteDesSources(root, INPUTS)).toBe(avant);
    expect(entreesDeLaPage(root, INPUTS)).not.toContain("src/node_modules/.vite/vitest/da39a3/results.json");
  });

  it("voit un octet changé dans un fichier suivi (le jumeau)", () => {
    const root = depot();
    const avant = empreinteDesSources(root, INPUTS);
    ecrire(root, "src/lib/b.ts", "export const b = 3;\n");
    expect(empreinteDesSources(root, INPUTS)).not.toBe(avant);
  });

  it("compte un fichier neuf avant même son `git add`", () => {
    // Construire puis ajouter le fichier: la CI le verra suivi, et la marque
    // posée avant l'ajout doit déjà le compter, sinon elle rougit là-bas.
    const root = depot();
    const avant = empreinteDesSources(root, INPUTS);
    ecrire(root, "src/lib/c.ts", "export const c = 4;\n");
    const neuf = empreinteDesSources(root, INPUTS);
    expect(neuf).not.toBe(avant);
    execFileSync("git", ["add", "src/lib/c.ts"], { cwd: root });
    expect(empreinteDesSources(root, INPUTS)).toBe(neuf);
  });

  it("laisse de côté les essais et leur mise en place, pas les sources", () => {
    const root = depot();
    const avant = empreinteDesSources(root, INPUTS);
    ecrire(root, "src/lib/b.test.ts", "// un autre essai\n");
    ecrire(root, "src/test/setup.ts", "// une autre mise en place\n");
    expect(empreinteDesSources(root, INPUTS)).toBe(avant);
    expect(entreesDeLaPage(root, INPUTS)).toEqual(["index.html", "src/App.tsx", "src/lib/b.ts"]);
  });

  it("ne lit pas un fichier suivi puis effacé, et change d'empreinte", () => {
    const root = depot();
    const avant = empreinteDesSources(root, INPUTS);
    rmSync(join(root, "src/lib/b.ts"));
    expect(entreesDeLaPage(root, INPUTS)).toEqual(["index.html", "src/App.tsx"]);
    expect(empreinteDesSources(root, INPUTS)).not.toBe(avant);
  });

  it("refuse hors d'un dépôt git au lieu de tout hacher", () => {
    const root = mkdtempSync(join(tmpdir(), "marque-sans-git-"));
    made.push(root);
    ecrire(root, "index.html", "<!doctype html>");
    ecrire(root, "src/App.tsx", "export const a = 1;\n");
    expect(() => empreinteDesSources(root, INPUTS)).toThrow(/git/);
  });
});
