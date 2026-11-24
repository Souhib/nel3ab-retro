/**
 * Le code QR de l'invitation contre une référence figée, écrite par un autre
 * encodeur (Kazuhiko Arase, dans qrcode-terminal 0.12.0 ; `front/qr-reference.mjs`).
 *
 * Chaque matrice est comparée par l'empreinte SHA-256 de ses lignes, pour les
 * huit masques de 28 liens de 1 à 178 octets : 224 cas, versions 1 à 9.
 * Deux jumeaux disent que la comparaison peut échouer : un octet de
 * correction retourné, et deux masques qui ne donnent jamais la même matrice
 * (un masque mal écrit ne peut donc pas tomber par hasard sur la référence).
 */
import { describe, expect, it } from "vitest";
import { capacite, chemin, code, type Matrice } from "./qr";
import reference from "./qr-reference.json";

const lignes = (m: Matrice): string[] => m.map((l) => l.map((d) => (d ? "1" : "0")).join(""));

async function empreinte(m: Matrice): Promise<string> {
  const octets = new TextEncoder().encode(lignes(m).join("\n"));
  const brut = new Uint8Array(await crypto.subtle.digest("SHA-256", octets));
  return Array.from(brut, (o) => o.toString(16).padStart(2, "0")).join("");
}

describe("la référence elle-même", () => {
  it("couvre 224 cas, des versions 1 à 9", () => {
    expect(reference.liens.length * 8).toBe(224);
    expect(new Set(reference.liens.map((l) => l.version))).toEqual(
      new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    );
    for (const lien of reference.liens) expect(lien.empreintes).toHaveLength(8);
  });

  it("jumeau : les huit masques d'un lien donnent huit matrices différentes", () => {
    for (const lien of reference.liens) expect(new Set(lien.empreintes).size).toBe(8);
  });
});

describe("le code de la page", () => {
  it("choisit la même version que l'oracle pour chaque lien", () => {
    for (const lien of reference.liens)
      expect(code(lien.texte).version, lien.texte).toBe(lien.version);
  });

  it("donne, module par module, les 224 matrices de l'oracle", async () => {
    const comparaisons = reference.liens.flatMap((lien) =>
      lien.empreintes.map(async (attendue, masque) => {
        const m = code(lien.texte, { version: lien.version, masque }).m;
        return (await empreinte(m)) === attendue
          ? null
          : `${lien.texte.length} octets, version ${lien.version}, masque ${masque}`;
      }),
    );
    expect(comparaisons).toHaveLength(224);
    expect((await Promise.all(comparaisons)).filter(Boolean)).toEqual([]);
  });

  it("écrit les deux liens de salle réels comme l'oracle, ligne par ligne", () => {
    const reels = reference.liens.filter((l) => "masque2" in l);
    expect(reels).toHaveLength(2);
    for (const lien of reels) {
      const m = code(lien.texte, { version: lien.version, masque: 2 }).m;
      expect(lignes(m)).toEqual((lien as { masque2: string[] }).masque2);
    }
  });

  it("jumeau : un octet de correction retourné ne passe plus", async () => {
    const lien = reference.liens.find((l) => "masque2" in l);
    if (!lien) throw new Error("la référence n'a plus de lien réel");
    const faux = code(lien.texte, {
      version: lien.version,
      masque: 2,
      mots: (mots) => mots.map((o, i) => (i === mots.length - 1 ? o ^ 0xff : o)),
    }).m;
    expect(await empreinte(faux)).not.toBe(lien.empreintes[2]);
  });
});

describe("les bornes", () => {
  it("la version 9 tient 180 octets, et pas un de plus", () => {
    expect(capacite(9) - 2).toBe(180);
    expect(code("x".repeat(180)).version).toBe(9);
    expect(() => code("x".repeat(181))).toThrow(RangeError);
  });

  it("un lien de salle tient dans une petite version", () => {
    expect(code("https://nel3ab.exemple/r/12/?entrer=regarder").version).toBeLessThanOrEqual(4);
  });

  it("le chemin garde quatre modules de marge et un carré par module sombre", () => {
    const c = code("https://nel3ab.exemple/r/1/?entrer=jouer");
    const { d, cote } = chemin(c);
    expect(cote).toBe(c.n + 8);
    const sombres = c.m.flat().filter(Boolean).length;
    expect(d.match(/M/g)).toHaveLength(sombres);
    // Le module (0, 0) est le coin du motif de repérage, toujours sombre.
    expect(d.startsWith("M4 4h1v1h-1z")).toBe(true);
  });
});
