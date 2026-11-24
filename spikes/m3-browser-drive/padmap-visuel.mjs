// The pad diagrams, checked and photographed, so a human can look.
//
// Runs the two checks that need a real browser against the preview page:
// `padmap-qc.mjs` proves each piece sits on its shell (Chrome's SVG geometry,
// which jsdom does not provide), and `padmap-shot.mjs` writes a screenshot at
// /tmp/padmap-visuel.png (or the path given as first argument). The preview
// is served by Vite; this script starts it, waits for it, runs the checks, and
// stops it. Vite listens on a free port, or on `--port N` (`port.mjs`).
//
// Depuis le 23 novembre 2026, `padmap-qc.mjs` vérifie aussi les comptes
// d'inscriptions, les contrastes d'appui et les réglages de la planche. Son
// jumeau tourne ici : avec `--mutant-contraste`, il doit sortir en 1, et
// chacun de ses défauts doit être un contraste de la manette Xbox. Un pilote
// qui sortirait en 1 pour une autre raison ne prouverait rien.
//
// Vite runs on `vite.planche.config.ts`, the configuration WITHOUT the relays
// to the room's ports (C10 of the manettes plan, 23 November 2026). It used
// `npm run dev`, whose configuration relays /api and the sockets to the live
// room: a preview has no reason to reach a running service.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { portDemande, portLibre } from "./port.mjs";

const HERE = import.meta.dirname;
const ARGS = process.argv.slice(2);
const PORT = String(portDemande(ARGS) || (await portLibre()));
/** The screenshot path: the first argument that is not an option. */
const SORTIE = ARGS.find((one, i) => !one.startsWith("--") && ARGS[i - 1] !== "--port") ?? "/tmp/padmap-visuel.png";
const PREVIEW = `http://localhost:${PORT}/padmap-preview.html`;

const dev = spawn("npx", ["vite", "--config", "vite.planche.config.ts", "--port", PORT, "--strictPort"], {
  cwd: new URL("../../front/", import.meta.url).pathname,
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
  const jumeau = spawnSync("node", ["padmap-qc.mjs", "--mutant-contraste"], {
    cwd: HERE,
    env,
    encoding: "utf-8",
  });
  const defauts = jumeau.stderr
    .split("\n")
    .filter((ligne) => /^\s+\S+: /.test(ligne))
    .map((ligne) => ligne.trim());
  const justes = defauts.length > 0 && defauts.every((d) => d.startsWith("contraste: xbox "));
  if (jumeau.status !== 1 || !justes) {
    console.error(`le jumeau du contraste devait échouer sur la Xbox seule (sortie ${jumeau.status}) :`);
    console.error(jumeau.stdout + jumeau.stderr);
    process.exitCode = 1;
  } else {
    console.log(`jumeau : ${defauts.length} contrastes refusés, comme voulu`);
  }
  execFileSync("node", ["padmap-shot.mjs", SORTIE], {
    cwd: HERE,
    env,
    stdio: "inherit",
  });
} finally {
  stop();
}