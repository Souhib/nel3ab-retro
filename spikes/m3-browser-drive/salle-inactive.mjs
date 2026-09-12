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
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const repo = new URL("../../", import.meta.url).pathname;

// Tout ce qui a été lancé, pour que RIEN ne survive à un échec: la première
// version de ce pilote a laissé un worker vivant derrière elle en échouant, et
// un essai qui pollue la machine qu'il mesure finit par mesurer sa propre
// pollution.
const lances = [];

async function salle({ jeu, secondes, avertir, vide }) {
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
      // LA place de la Switch, dans un dossier jetable. Sans cela le
      // pilote prendrait celle de la vraie salle, et empêcherait
      // quelqu'un de lancer un jeu Switch pendant qu'il mesure.
      NEL3AB_SWITCH_LOCK: join(root, "switch.lock"),
      NEL3AB_CONTAINER: "nel3ab-aucune-salle-ici",
      NEL3AB_CLOSE_AFTER_SECS: String(secondes),
      NEL3AB_WARN_BEFORE_SECS: String(avertir),
      // Les DEUX règles savent fermer une salle, et une salle vide les
      // déclenche toutes les deux. Chaque scénario allonge donc celle
      // qu'il ne mesure pas, sinon ce pilote ne prouverait plus laquelle
      // a fermé la salle.
      NEL3AB_EMPTY_AFTER_SECS: String(vide),
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  lances.push(worker);
  worker.stdout.pipe(log); worker.stderr.pipe(log);
  for (let n = 0; n < 100; n++) {
    const up = await fetch(`http://127.0.0.1:${media}/roms`).then(r => r.ok).catch(() => false);
    if (up) return { worker, path, root, started: Date.now() };
    assert.equal(worker.exitCode, null, `Le worker est mort au démarrage, voir ${path}`);
    await new Promise(done => setTimeout(done, 200));
  }
  assert.fail(`Pas de page après 20 secondes, voir ${path}`);
}

try {
  // La salle qui doit se fermer par INACTIVITÉ: un jeu en cours, six secondes
  // sans le moindre geste, avertie trois secondes avant. La règle de la salle
  // vide est mise hors de portée pour qu'elle ne puisse pas voler la fermeture.
  const jouee = await salle({ jeu: true, secondes: 6, avertir: 3, vide: 900 });
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
  // Et la salle doit revenir SANS jeu. Le worker installé est relancé par
  // systemd: sans ce marqueur il relancerait le jeu qu'il vient de fermer, et
  // la fermeture n'aurait servi qu'à perdre la partie en cours.
  assert.ok(await stat(join(jouee.root, "session/game-closed")).catch(() => null),
    "La salle fermée relancerait son jeu au prochain démarrage");

  // L'autre règle, seule cette fois: plus personne dans la salle. L'inactivité
  // est mise hors de portée, donc seul le départ peut expliquer la fermeture.
  const desertee = await salle({ jeu: true, secondes: 900, avertir: 60, vide: 5 });
  const partie = await Promise.race([
    once(desertee.worker, "exit"),
    new Promise(done => setTimeout(() => done(null), 30_000)),
  ]);
  assert.ok(partie, `Une salle que personne n'occupe tourne encore, voir ${desertee.path}`);
  const seule = (Date.now() - desertee.started) / 1000;
  assert.ok(seule < 25, `Fermeture bien trop tardive: ${seule.toFixed(1)} s`);

  // Le jumeau négatif: une salle ouverte sans jeu, mêmes délais courts, doit
  // être encore là quand les deux autres sont mortes depuis longtemps.
  const vide = await salle({ jeu: false, secondes: 6, avertir: 3, vide: 5 });
  await new Promise(done => setTimeout(done, 15_000));
  assert.equal(vide.worker.exitCode, null,
    `Une salle sans jeu s'est fermée pour rien, voir ${vide.path}`);
  const rien = await readFile(vide.path, "utf8");
  assert.doesNotMatch(rien, /la salle se ferme/, "Une salle sans jeu a annoncé sa fermeture");

  console.log(`inactivité: fermée après ${vecu.toFixed(1)} s ; `
    + `salle désertée: fermée après ${seule.toFixed(1)} s ; `
    + "salle sans jeu: toujours debout après 15 s");
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
