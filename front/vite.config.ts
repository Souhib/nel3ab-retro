import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * One file out, two servers in.
 *
 * The build produces a single `index.html` with the script and the styles
 * inlined, because the worker serves the page with `include_str!` and has no
 * static file server, no cache headers and no wish for either. It also removes
 * a round trip on a machine somebody is about to play a game on.
 *
 * In development the page is served by Vite, so the two services it talks to are
 * proxied to their real ports. That is not a convenience: the worker refuses a
 * WebSocket whose `Origin` is not its own `Host`, so a page loaded from :5173
 * talking straight to :8100 would be refused exactly as a stranger's page would
 * be. The proxy makes development same-origin, which is what production is too,
 * behind one hostname.
 */
export default defineConfig({
  plugins: [react(), tailwind(), viteSingleFile()],
  build: {
    // Straight into the worker's source tree, because the worker compiles the
    // page into its binary with `include_str!`. Writing it here rather than
    // copying it afterwards removes the step somebody forgets, and the file is
    // committed so `cargo build` never depends on node being installed.
    outDir: "../core/crates/worker/src/page",
    emptyOutDir: true,
    // The worker holds the whole page in its binary. A source map would double
    // that for something nobody can open from a phone on the sofa.
    sourcemap: false,
    // Below this, an asset is inlined as a data URI rather than emitted beside
    // the HTML the single-file plugin is trying to keep alone.
    assetsInlineLimit: 1024 * 1024,
  },
  server: {
    proxy: {
      // The control plane: the room, the seats and the lobby.
      "/api": { target: "http://127.0.0.1:8200", changeOrigin: false },
      "/socket.io": { target: "http://127.0.0.1:8200", ws: true, changeOrigin: false },
      // The worker: the picture, the sound, the pads and the library.
      "/video": { target: "http://127.0.0.1:8100", ws: true, changeOrigin: false },
      "/sound": { target: "http://127.0.0.1:8100", ws: true, changeOrigin: false },
      "/input": { target: "http://127.0.0.1:8100", ws: true, changeOrigin: false },
      "/roms": { target: "http://127.0.0.1:8100", changeOrigin: false },
    },
  },
});
