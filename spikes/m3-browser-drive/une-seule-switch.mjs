/** Deux salles peuvent-elles faire tourner un jeu Switch en même temps ?
 *
 * Elles ne doivent pas: Ryubing coûte bien plus cher que Dolphin, et trois
 * émulateurs Switch ne tiendraient pas sur une seule carte graphique. La règle
 * ne peut pas vivre dans le salon, parce qu'une page demande son jeu AU WORKER,
 * directement, par la socket de manette: le salon apprend le changement, il ne
 * l'autorise pas. Elle vit donc là où le jeu démarre, sous la forme d'un verrou
 * de fichier partagé par toutes les salles.
 *
 * Ce pilote monte DEUX vraies salles, chacune avec son dossier de session et
 * son jeu Switch, et le même verrou. La première doit jouer, la seconde doit
 * rester sur son menu, vivante, en disant pourquoi.
 *
 * Le jeu est un FAUX adaptateur qui attend qu'on lui ferme l'entrée: aucun
 * conteneur, aucune image, aucune carte graphique, donc aucun risque pour une
 * salle vivante qui tournerait à côté.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { readdir, mkdtemp, mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const repo = new URL("../../", import.meta.url).pathname;
const lances = [];

/** Combien de faux adaptateurs tournent vraiment.
 *
 * La preuve directe, et la seule qui vaille: le catalogue servi par une salle
 * annonce le jeu RETENU, pas celui qui tourne, et il est figé à l'ouverture.
 * S'y fier laissait passer une seconde salle qui n'avait rien lancé du tout.
 *
 * Lu dans /proc plutôt qu'avec pgrep, dont le motif se trouve lui-même. Et
 * restreint aux salles de CE pilote: compter tous les faux adaptateurs de la
 * machine comptait aussi ceux des autres pilotes lancés en même temps, et ce
 * pilote accusait le verrou d'une faute qui n'était pas la sienne.
 */
async function adaptateursVivants(sous) {
  let combien = 0;
  for (const entree of await readdir("/proc")) {
    if (!/^\d+$/.test(entree)) continue;
    const ligne = await readFile(`/proc/${entree}/cmdline`, "utf8").catch(() => "");
    if (ligne.includes("faux-adaptateur.py") && ligne.includes(sous)) combien++;
  }
  return combien;
}

async function portLibre() {
  const server = createServer();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const { port } = server.address();
  await new Promise(done => server.close(done));
  return port;
}

async function salle(verrou, nom) {
  const root = await mkdtemp(join(tmpdir(), `nel3ab-switch-${nom}-`));
  const media = await portLibre();
  const control = await portLibre();
  await mkdir(join(root, "session"));
  // PAS de marqueur « sans jeu »: cette salle doit essayer de lancer le disque.
  const chemin = join(root, "worker.log");
  const log = createWriteStream(chemin);
  const worker = spawn(join(repo, "core/target/debug/nel3ab-worker"), [], {
    cwd: repo,
    env: { ...process.env,
      NEL3AB_ROM: join(homedir(), "roms/switch/Mario Tennis Aces.xci"),
      NEL3AB_ROM_DIR: ["gc", "wii", "switch"].map(c => join(homedir(), "roms", c)).join(":"),
      NEL3AB_BIND: `127.0.0.1:${media}`, NEL3AB_CONTROL_BIND: `127.0.0.1:${control}`,
      NEL3AB_WORKER_CONTROL: `127.0.0.1:${control}`,
      NEL3AB_SESSION_DIR: join(root, "session"),
      NEL3AB_SWITCH_ADAPTER: join(repo, "spikes/m3-browser-drive/faux-adaptateur.py"),
      NEL3AB_SWITCH_LOCK: verrou,
      NEL3AB_CONTAINER: `nel3ab-aucune-salle-${nom}`,
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  lances.push(worker);
  worker.stdout.pipe(log); worker.stderr.pipe(log);
  for (let n = 0; n < 100; n++) {
    const catalogue = await fetch(`http://127.0.0.1:${media}/roms`)
      .then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (catalogue) return { worker, chemin, media, catalogue };
    assert.equal(worker.exitCode, null, `Le worker ${nom} est mort au démarrage, voir ${chemin}`);
    await new Promise(done => setTimeout(done, 200));
  }
  assert.fail(`Pas de catalogue pour ${nom} après 20 s, voir ${chemin}`);
}

try {
  const verrou = join(await mkdtemp(join(tmpdir(), "nel3ab-place-")), "switch.lock");
  // Le dossier de session de chaque salle commence par ceci, et il figure
  // dans la ligne de commande de l'adaptateur qu'elle lance.
  const ici = join(tmpdir(), "nel3ab-switch-");

  const premiere = await salle(verrou, "une");
  for (let n = 0; n < 50 && (await adaptateursVivants(ici)) < 1; n++) {
    await new Promise(done => setTimeout(done, 200));
  }
  assert.equal(await adaptateursVivants(ici), 1,
    `La première salle n'a pas lancé son jeu, voir ${premiere.chemin}`);

  const seconde = await salle(verrou, "deux");
  // Le temps qu'elle aurait mis à en lancer un second, si elle avait pu.
  await new Promise(done => setTimeout(done, 3_000));
  assert.equal(await adaptateursVivants(ici), 1,
    `DEUX salles font tourner un jeu Switch en même temps, voir ${seconde.chemin}`);
  const dit = await readFile(seconde.chemin, "utf8");
  assert.match(dit, /une autre salle joue déjà à la Switch/,
    "La seconde salle est restée au menu sans dire pourquoi");

  // Et elle doit être VIVANTE: refuser le jeu ne doit pas fermer la salle de
  // quelqu'un qui a simplement cliqué au mauvais moment.
  assert.equal(seconde.worker.exitCode, null, "La salle refusée s'est fermée");
  const encore = await fetch(`http://127.0.0.1:${seconde.media}/roms`).then(r => r.ok);
  assert.ok(encore, "La salle refusée ne sert plus sa page");

  console.log("une seule salle joue à la Switch, la seconde reste sur son menu");
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
