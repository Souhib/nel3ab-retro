import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * La planche de Bobine: chaque pose et chaque scène, sans salle ni salon.
 *
 * Une configuration à part, SANS mandataire vers les ports de la salle: la
 * planche ne doit jamais toucher un service vivant. `just planche` la sert.
 */
export default defineConfig({
  plugins: [react(), tailwind()],
  server: { host: "127.0.0.1", strictPort: false, open: false },
  build: { rollupOptions: { input: "planche.html" } },
});
