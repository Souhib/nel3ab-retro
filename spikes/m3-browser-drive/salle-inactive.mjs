/** Une salle que personne ne touche se ferme-t-elle VRAIMENT ?
 *
 * Le worker est lancé pour de bon, dans un dossier de session jetable et sur
 * des ports réservés, avec un délai raccourci par l'environnement. Vérifier la
 * règle en mémoire ne prouve rien du branchement: c'est la boucle d'images qui
 * doit voir l'arrêt demandé et sortir. Ce pilote regarde donc la seule preuve
 * qui compte, le processus qui s'arrête tout seul.
 *
 * Le jumeau négatif tourne dans la foulée avec un délai long: un worker qui
 * s'arrêterait de toute façon ferait passer le premier essai pour rien.
 *
 * Aucun conteneur n'est visé: NEL3AB_CONTAINER porte un nom qui n'existe pas,
 * pour qu'une sieste ne puisse en aucun cas geler la salle de quelqu'un.
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

async function room(seconds, warn) {
  const root = await mkdtemp(join(tmpdir(), "nel3ab-inactive-"));
  const held = await Promise.all([0, 1].map(async () => {
    const server = createServer();
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    return server;
  }));
  const [media, control] = held.map(server => server.address().port);
  await mkdir(join(root, "session"));
  await writeFile(join(root, "session/game-closed"), "");
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
      NEL3AB_CONTAINER: "nel3ab-aucune-salle-ici",
      NEL3AB_CLOSE_AFTER_SECS: String(seconds),
      NEL3AB_WARN_BEFORE_SECS: String(warn),
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout.pipe(log); worker.stderr.pipe(log);
  for (let n = 0; n < 100; n++) {
    const up = await fetch(`http://127.0.0.1:${media}/roms`).then(r => r.ok).catch(() => false);
    if (up) return { worker, path, started: Date.now() };
    assert.equal(worker.exitCode, null, `Le worker est mort au démarrage, voir ${path}`);
    await new Promise(done => setTimeout(done, 200));
  }
  worker.kill("SIGKILL");
  assert.fail(`Pas de page après 20 secondes, voir ${path}`);
}

// Tout ce qui a été lancé, pour que RIEN ne survive à un échec: la première
// version de ce pilote a laissé un worker vivant derrière elle en échouant, et
// un essai qui pollue la machine qu'il mesure finit par mesurer sa propre
// pollution.
const lances = [];
async function salle(secondes, avertir) {
  const montee = await room(secondes, avertir);
  lances.push(montee.worker);
  return montee;
}

try {
  // La salle qui doit se fermer: six secondes sans le moindre geste, avertie
  // trois secondes avant. Personne n'ouvre la page, donc rien n'est touché.
  const court = await salle(6, 3);
  const fin = await Promise.race([
    once(court.worker, "exit"),
    new Promise(done => setTimeout(() => done(null), 30_000)),
  ]);
  assert.ok(fin, `La salle inactive tourne toujours après 30 s, voir ${court.path}`);
  const vecu = (Date.now() - court.started) / 1000;
  const journal = await readFile(court.path, "utf8");
  assert.match(journal, /la salle fermera bientôt/, "Aucun avertissement avant la fermeture");
  assert.match(journal, /la salle se ferme/, "La salle est morte sans dire pourquoi");
  assert.ok(vecu < 25, `Fermeture bien trop tardive: ${vecu.toFixed(1)} s`);

  // Le jumeau négatif: le même worker, un délai de dix minutes, doit être encore
  // là quand l'autre est mort depuis longtemps.
  const longue = await salle(600, 60);
  await new Promise(done => setTimeout(done, 15_000));
  assert.equal(longue.worker.exitCode, null,
    `Une salle au délai long s'est fermée quand même, voir ${longue.path}`);

  console.log(`la salle inactive s'est fermée seule après ${vecu.toFixed(1)} s, `
    + "et celle au délai long a survécu 15 s");
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
