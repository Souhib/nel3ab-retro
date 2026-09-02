// The pad diagrams, checked and photographed, so a human can look.
//
// Runs the two checks that need a real browser against the preview page:
// `padmap-qc.mjs` proves each piece sits on its shell (Chrome's SVG geometry,
// which jsdom does not provide), and `padmap-shot.mjs` writes a screenshot at
// /tmp/padmap-visuel.png. The preview is served by Vite; this script starts it,
// waits for it, runs the checks, and stops it.
import { execFileSync, spawn } from "node:child_process";

const HERE = import.meta.dirname;
const PORT = "5299";
const PREVIEW = `http://localhost:${PORT}/padmap-preview.html`;

const dev = spawn("npm", ["run", "dev", "--", "--port", PORT, "--strictPort"], {
  cwd: new URL("../../front", import.meta.url),
  // Détaché pour pouvoir tuer npm ET vite d'un coup, et stdio coupé pour que
  // le processus n'attende jamais qu'un tuyau se vide.
  detached: true,
  stdio: "ignore",
});

const stop = () => {
  try {
    process.kill(-dev.pid, "SIGTERM");
  } catch {
    // déjà terminé
  }
};

let up = false;
for (let i = 0; i < 60; i += 1) {
  try {
    if ((await fetch(PREVIEW)).ok) {
      up = true;
      break;
    }
  } catch {
    // pas encore lancée
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!up) {
  console.error("vite n'a pas démarré sur le port " + PORT);
  stop();
  process.exit(1);
}

const env = { ...process.env, PADMAP_URL: PREVIEW };
try {
  execFileSync("node", ["padmap-qc.mjs"], { cwd: HERE, env, stdio: "inherit" });
  execFileSync("node", ["padmap-shot.mjs", "/tmp/padmap-visuel.png"], {
    cwd: HERE,
    env,
    stdio: "inherit",
  });
} finally {
  stop();
}