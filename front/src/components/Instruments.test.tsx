/** Les mesures techniques en quatre groupes (plan personnes, mesures 2) :
 * L'image, Le son, La manette, La liaison. La source est lue plutôt que
 * rendue : un instantané complet (`Snapshot`) demande la vidéo, le son et
 * la manette vivants. `just readouts-check` garde, lui, chaque relevé. */
import { expect, it } from "vitest";

type Fs = { readFileSync: (chemin: string, codage: "utf-8") => string };
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
const ici = (relatif: string) => new URL(relatif, import.meta.url).pathname;
const source = fs.readFileSync(ici("./Instruments.tsx"), "utf-8");

it("range les relevés en quatre groupes, dans l'ordre de la page", () => {
  const groupes = [...source.matchAll(/<Panel title="([^"]+)">/g)].map((m) => m[1]);
  expect(groupes).toEqual(["L'image", "Le son", "La manette", "La liaison"]);
});

it("dit « au pire (1 fois sur 20) » au lieu de p95, dans les unités comme dans les aides", () => {
  const ecrit = [...source.matchAll(/(?:unit|hint|label)=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map(
    (m) => m[1] ?? m[2],
  );
  expect(ecrit.some((t) => t.includes("au pire (1 fois sur 20)"))).toBe(true);
  // Le jumeau : aucun texte montré ne dit p05, p50 ou p95.
  expect(ecrit.filter((t) => /\bp(05|50|95)\b/.test(t.replace(/\$\{[^}]*\}/g, "")))).toEqual([]);
});

it("jumeau : le numéro de la séance reste avec la liaison, pour le signalement", () => {
  const liaison = source.slice(source.indexOf('<Panel title="La liaison">'));
  expect(liaison).toContain('id="visit"');
});
