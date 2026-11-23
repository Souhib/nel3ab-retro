import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot } from "vite";

/**
 * La planche d'Aïn: ses dessins, et chaque scène dans un décor qui porte
 * toutes ses ancres, sans salle ni salon.
 *
 * Une configuration à part, SANS mandataire vers les ports de la salle: la
 * planche ne doit jamais toucher un service vivant. `just planche` la sert,
 * `just planche-garde` y joue chaque scène dans Chrome.
 */
export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    host: "127.0.0.1",
    strictPort: false,
    open: false,
    // Les polices de la régie sont celles du salon, lues hors de `front/`.
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), "../control/nel3ab_control/api/routes/polices"],
    },
  },
  build: { rollupOptions: { input: "planche.html" } },
});
