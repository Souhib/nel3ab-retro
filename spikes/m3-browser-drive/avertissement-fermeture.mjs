/** La salle prévient-elle VRAIMENT, à l'écran, avant de fermer ?
 *
 * Le journal disait déjà « la salle fermera bientôt », mais un journal ne
 * prévient personne. Ce pilote monte une vraie salle avec un jeu, ouvre la page
 * dans un navigateur, et attend que le bandeau apparaisse tout seul.
 *
 * Le clic doit le faire taire, parce que c'est ce que Souhib a demandé: un
 * message qu'on ne peut pas faire disparaître finit par être contourné en
 * fermant l'onglet.
 *
 * Les délais sont raccourcis par l'environnement: douze secondes avant la
 * fermeture, avertissement neuf secondes avant, donc le bandeau doit arriver
 * vers la troisième seconde. La règle de la salle désertée est mise hors de
 * portée: quelqu'un REGARDE, donc elle ne s'appliquerait pas, mais l'allonger
 * rend le pilote insensible à un défaut de comptage des présents.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";

import { seedName } from "./open.mjs";

const repo = new URL("../../", import.meta.url).pathname;
const aFermer = [];

async function portLibre() {
  const server = createServer();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const { port } = server.address();
  await new Promise(done => server.close(done));
  return port;
}

try {
  const root = await mkdtemp(join(tmpdir(), "nel3ab-avertit-"));
  const media = await portLibre();
  const control = await portLibre();
  await mkdir(join(root, "session"));
  // Pas de marqueur « sans jeu »: la règle ne ferme que les salles qui jouent.
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
      NEL3AB_SWITCH_LOCK: join(root, "switch.lock"),
      NEL3AB_CONTAINER: "nel3ab-aucune-salle-ici",
      NEL3AB_CLOSE_AFTER_SECS: "12",
      NEL3AB_WARN_BEFORE_SECS: "9",
      NEL3AB_EMPTY_AFTER_SECS: "600",
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  aFermer.push(() => { if (worker.exitCode === null) worker.kill("SIGTERM"); });
  worker.stdout.pipe(log); worker.stderr.pipe(log);
  for (let n = 0; n < 100; n++) {
    const up = await fetch(`http://127.0.0.1:${media}/roms`).then(r => r.ok).catch(() => false);
    if (up) break;
    assert.equal(worker.exitCode, null, `Le worker est mort au démarrage, voir ${chemin}`);
    await new Promise(done => setTimeout(done, 200));
  }

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  aFermer.push(() => browser.close());
  const page = await browser.newPage();
  await seedName(page);
  await page.goto(`http://127.0.0.1:${media}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("entrer et jouer"),
    { timeout: 20_000 });
  const entre = await page.evaluateHandle(() =>
    [...document.querySelectorAll("button, a, [role=button]")]
      .find(element => element.innerText.toLowerCase().includes("entrer et jouer")));
  await entre.asElement().click();

  // Le bandeau doit arriver tout seul, sans qu'on touche à rien.
  await page.waitForSelector("#closingNotice", { timeout: 20_000 });
  const dit = await page.$eval("#closingNotice", element => element.innerText);
  assert.match(dit, /ferme dans/, `Le bandeau ne dit pas ce qui arrive: ${dit}`);

  // Et le clic doit le faire taire.
  await page.click("#closingNotice");
  await page.waitForFunction(() => document.querySelector("#closingNotice") === null,
    { timeout: 5_000 });

  console.log(`la salle a prévenu à l'écran (« ${dit.trim().slice(0, 60)}… ») `
    + "et le clic l'a fait taire");
} finally {
  for (const fermer of aFermer.reverse()) await fermer();
}
