/** Une salle où plus personne ne joue ferme-t-elle VRAIMENT son jeu ?
 *
 * Le worker est lancé pour de bon, dans un dossier de session jetable et sur
 * des ports réservés, avec le délai raccourci par l'environnement. Vérifier la
 * règle en mémoire ne prouve rien du branchement: le worker a trois états et la
 * première version de cette règle ne vivait que dans un seul. Ce pilote regarde
 * donc la seule preuve qui compte, le processus qui s'arrête tout seul.
 *
 * Le jeu est un FAUX adaptateur Switch qui attend qu'on lui ferme l'entrée:
 * aucun conteneur, aucune image, aucune carte graphique. Une salle vivante qui
 * tournerait à côté ne risque donc rien.
 *
 * Le jumeau négatif est une salle ouverte SANS jeu, au même délai court: elle
 * ne doit pas se fermer. Le worker installé est relancé par systemd dès qu'il
 * s'arrête, si bien que fermer une salle vide ne libérerait rien et rouvrirait
 * la même salle deux secondes plus tard, toutes les demi-heures, pour rien.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const repo = new URL("../../", import.meta.url).pathname;

// Tout ce qui a été lancé, pour que RIEN ne survive à un échec: la première
// version de ce pilote a laissé un worker vivant derrière elle en échouant, et
// un essai qui pollue la machine qu'il mesure finit par mesurer sa propre
// pollution.
const lances = [];

async function salle({ jeu, secondes, avertir }) {
  const root = await mkdtemp(join(tmpdir(), "nel3ab-inactive-"));
  const held = await Promise.all([0, 1].map(async () => {
    const server = createServer();
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    return server;
  }));
  const [media, control] = held.map(server => server.address().port);
  await mkdir(join(root, "session"));
  // Le marqueur DIT que la salle est ouverte sans jeu. Son absence fait lancer
  // le disque retenu, ici notre faux adaptateur.
  if (!jeu) await writeFile(join(root, "session/game-closed"), "");
  await Promise.all(held.map(server => new Promise(done => server.close(done))));
  const path = join(root, "worker.log");
  const log = createWriteStream(path);
  const worker = spawn(join(repo, "core/target/debug/nel3ab-worker"), [], {
    cwd: repo,
    env: { ...process.env,
      NEL3AB_ROM: join(homedir(), "roms/switch/Mario Tennis Aces.xci"),
      NEL3AB_ROM_DIR: ["gc", "wii", "switch"].map(c => join(homedir(), "roms", c)).join(":"),
      NEL3AB_BIND: `127.0.0.1:${media}`, NEL3AB_CONTROL_BIND: `127.0.0.1:${control}`,
      NEL3AB_WORKER_CONTROL: `127.0.0.1:${control}`,
      NEL3AB_SESSION_DIR: join(root, "session"),
      NEL3AB_SWITCH_ADAPTER: join(repo, "spikes/m3-browser-drive/faux-adaptateur.py"),
      NEL3AB_CONTAINER: "nel3ab-aucune-salle-ici",
      NEL3AB_CLOSE_AFTER_SECS: String(secondes),
      NEL3AB_WARN_BEFORE_SECS: String(avertir),
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  lances.push(worker);
  worker.stdout.pipe(log); worker.stderr.pipe(log);
  for (let n = 0; n < 100; n++) {
    const up = await fetch(`http://127.0.0.1:${media}/roms`).then(r => r.ok).catch(() => false);
    if (up) return { worker, path, started: Date.now() };
    assert.equal(worker.exitCode, null, `Le worker est mort au démarrage, voir ${path}`);
    await new Promise(done => setTimeout(done, 200));
  }
  assert.fail(`Pas de page après 20 secondes, voir ${path}`);
}

try {
  // La salle qui doit se fermer: un jeu en cours, six secondes sans le moindre
  // geste, avertie trois secondes avant. Personne n'ouvre la page.
  const jouee = await salle({ jeu: true, secondes: 6, avertir: 3 });
  const fin = await Promise.race([
    once(jouee.worker, "exit"),
    new Promise(done => setTimeout(() => done(null), 30_000)),
  ]);
  assert.ok(fin, `La salle inactive tourne toujours après 30 s, voir ${jouee.path}`);
  const vecu = (Date.now() - jouee.started) / 1000;
  const journal = await readFile(jouee.path, "utf8");
  assert.match(journal, /la salle fermera bientôt/, "Aucun avertissement avant la fermeture");
  assert.match(journal, /la salle se ferme/, "La salle est morte sans dire pourquoi");
  assert.ok(vecu < 25, `Fermeture bien trop tardive: ${vecu.toFixed(1)} s`);

  // Le jumeau négatif: une salle ouverte sans jeu, même délai court, doit être
  // encore là quand l'autre est morte depuis longtemps.
  const vide = await salle({ jeu: false, secondes: 6, avertir: 3 });
  await new Promise(done => setTimeout(done, 15_000));
  assert.equal(vide.worker.exitCode, null,
    `Une salle sans jeu s'est fermée pour rien, voir ${vide.path}`);
  const rien = await readFile(vide.path, "utf8");
  assert.doesNotMatch(rien, /la salle se ferme/, "Une salle sans jeu a annoncé sa fermeture");

  console.log(`la salle jouée s'est fermée seule après ${vecu.toFixed(1)} s, `
    + "et la salle sans jeu a survécu 15 s");
} finally {
  for (const worker of lances) {
    if (worker.exitCode === null) {
      worker.kill("SIGTERM");
      await Promise.race([
        once(worker, "exit"),
        new Promise(done => setTimeout(done, 5_000)).then(() => worker.kill("SIGKILL")),
      ]);
    }
  }
}
