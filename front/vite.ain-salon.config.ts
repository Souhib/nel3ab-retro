import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Le paquet d'Aïn pour les pages du salon (`src/mascotte/salon.ts`, ADR
 * D46) : un seul fichier, une fonction appelée tout de suite (IIFE), sans
 * React, écrit à côté des autres copies du salon
 * (`control/nel3ab_control/api/routes/retro/ain.js`). `just ain-salon`.
 *
 * Sa marque, `ain.SOURCES`, est écrite par `tampon()` après la construction :
 * l'empreinte du paquet, puis celle de chaque module que la construction a
 * VRAIMENT lu, plus le verrou des paquets et cette configuration. Comme pour
 * la page (`stamp.mjs`), on compare les entrées et non deux constructions :
 * le minifieur renomme ses variables autrement d'une fois à l'autre. Un
 * module ajouté au graphe passe forcément par un module déjà listé, dont
 * l'empreinte change. `src/mascotte/salon.test.ts` relit la marque.
 */
const ICI = import.meta.dirname;
const SORTIE = resolve(ICI, "../control/nel3ab_control/api/routes/retro");
const RACINE = resolve(ICI, "..");
const empreinte = (chemin: string) =>
  createHash("sha256").update(readFileSync(chemin)).digest("hex");

function tampon(): Plugin {
  let modules: string[] = [];
  return {
    name: "n3-tampon-ain",
    generateBundle(_options, paquet) {
      const morceau = Object.values(paquet).find((m) => m.type === "chunk");
      if (!morceau || morceau.type !== "chunk") throw new Error("aucun paquet construit");
      modules = morceau.moduleIds.filter((id) => !id.startsWith("\0") && id.startsWith(RACINE));
    },
    writeBundle() {
      const entrees = [
        ...new Set([
          ...modules.map((m) => relative(RACINE, m.split("?")[0] ?? m)),
          "front/package-lock.json",
          "front/vite.ain-salon.config.ts",
        ]),
      ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const lignes = [
        "# Le paquet d'Aïn pour le salon, et ce qu'il a été construit depuis.",
        "# Écrit par `just ain-salon`; relu par front/src/mascotte/salon.test.ts.",
        `paquet ${empreinte(resolve(SORTIE, "ain.js"))}`,
        ...entrees.map((e) => `entree ${empreinte(resolve(RACINE, e))} ${e}`),
      ];
      writeFileSync(resolve(SORTIE, "ain.SOURCES"), `${lignes.join("\n")}\n`);
    },
  };
}

export default defineConfig({
  plugins: [tampon()],
  publicDir: false,
  // `lib/focus-jeu.ts` importe React pour ses crochets ; le paquet n'en lit
  // que la constante de la zone de jeu (`retro/image.ts`). React se déclare
  // sans effet de bord, et la construction le laisse dehors : 22 245 octets
  // brotli avec lui, mesurés le 23 novembre 2026. `salon.test.ts` vérifie
  // qu'aucun module de node_modules n'entre dans le paquet.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    rolldownOptions: {
      treeshake: {
        moduleSideEffects: (id: string) => !/[\\/]node_modules[\\/]react[\\/]/.test(id),
      },
    },
    outDir: SORTIE,
    emptyOutDir: false,
    minify: true,
    target: "es2022",
    lib: {
      entry: resolve(ICI, "src/mascotte/salon.ts"),
      formats: ["iife"],
      name: "nel3abAinSalon",
      fileName: () => "ain.js",
    },
  },
});
