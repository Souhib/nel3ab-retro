/** La colonne de droite se tire-t-elle entre ses bornes, et l'image suit-elle ?
 *
 * Contre un worker JETABLE: dossier de session temporaire, ports libres, aucun
 * conteneur. Une salle vivante qui tournerait à côté ne risque donc rien, et
 * aucune ne doit être ouverte pour mesurer.
 *
 * Il joue un FAUX jeu Switch, et la page est en mode « manette seule ». Ce n'est
 * pas un détour. Une salle sans jeu pose « Aucun jeu en cours » sur toute la
 * page, colonne comprise, et une salle qui attend sa première image y pose
 * l'écran de chargement. La colonne ne sert donc que pendant une partie. Le
 * faux jeu n'envoie aucune image, et la manette seule est le seul mode qui
 * n'en attend pas. La première version de ce pilote mesurait une salle sans
 * jeu: elle a trouvé la prise recouverte par `#idle-room`.
 *
 * Ce que jsdom ne peut pas montrer, et qui est la raison de ce pilote: une
 * vraie largeur, une vraie souris qui tire, une image qui prend la place
 * laissée, et la largeur retrouvée après un rechargement.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";

const repo = new URL("../../", import.meta.url).pathname;
const MIN = 256;
const STEP = 16;
const NORMAL = 304;
const MAX = 480;

let worker = null;
let browser = null;

async function salleJetable() {
  const root = await mkdtemp(join(tmpdir(), "nel3ab-colonne-"));
  const held = await Promise.all([0, 1].map(async () => {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return server;
  }));
  const [media, control] = held.map((server) => server.address().port);
  await mkdir(join(root, "session"));
  await Promise.all(held.map((server) => new Promise((done) => server.close(done))));
  const path = join(root, "worker.log");
  const log = createWriteStream(path);
  worker = spawn(join(repo, "core/target/debug/nel3ab-worker"), [], {
    cwd: repo,
    env: {
      ...process.env,
      NEL3AB_ROM: join(homedir(), "roms/switch/Mario Tennis Aces.xci"),
      NEL3AB_ROM_DIR: ["gc", "wii", "switch"].map((c) => join(homedir(), "roms", c)).join(":"),
      NEL3AB_BIND: `127.0.0.1:${media}`,
      NEL3AB_CONTROL_BIND: `127.0.0.1:${control}`,
      NEL3AB_WORKER_CONTROL: `127.0.0.1:${control}`,
      NEL3AB_SESSION_DIR: join(root, "session"),
      NEL3AB_SWITCH_ADAPTER: join(repo, "spikes/m3-browser-drive/faux-adaptateur.py"),
      NEL3AB_SWITCH_LOCK: join(root, "switch.lock"),
      NEL3AB_CONTAINER: "nel3ab-aucune-salle-ici",
      // Hors de portée: la salle ne doit pas se fermer pendant la mesure.
      NEL3AB_CLOSE_AFTER_SECS: "3600",
      NEL3AB_EMPTY_AFTER_SECS: "3600",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout.pipe(log);
  worker.stderr.pipe(log);
  const url = `http://127.0.0.1:${media}/`;
  for (let n = 0; n < 100; n++) {
    const up = await fetch(`${url}roms`).then((r) => r.ok).catch(() => false);
    if (up) return { url, path };
    assert.equal(worker.exitCode, null, `Le worker est mort au démarrage, voir ${path}`);
    await new Promise((done) => setTimeout(done, 200));
  }
  assert.fail(`Pas de page après 20 secondes, voir ${path}`);
}

/** Ce que la page montre de la colonne, de l'image et de la poignée. */
const lire = (page) => page.evaluate(() => {
  const side = document.getElementById("side").getBoundingClientRect();
  const place = document.getElementById("screen").parentElement.getBoundingClientRect();
  const grip = document.querySelector("#columnHandle > span").getBoundingClientRect();
  const x = grip.left + grip.width / 2;
  const y = grip.top + grip.height / 2;
  const dessus = document.elementFromPoint(x, y);
  return {
    colonne: Math.round(side.width),
    image: Math.round(place.width),
    aria: Number(document.getElementById("columnHandle").getAttribute("aria-valuenow")),
    x, y,
    // La précondition d'un vrai glissement: la prise est bien ce qu'une souris
    // touche à cet endroit, et pas un menu posé par-dessus. `Boolean` et non
    // `!== null`: sans élément sous le point, `undefined !== null` passerait.
    touchee: Boolean(dessus?.closest("#columnHandle")),
    dessus: dessus
      ? `${dessus.tagName.toLowerCase()}${dessus.id ? `#${dessus.id}` : ""} « ${String(dessus.className).slice(0, 80)} »`
      : "rien",
    focus: Boolean(document.activeElement?.closest?.("#columnHandle")),
  };
});

async function tirer(page, dx) {
  const avant = await lire(page);
  assert.ok(avant.touchee, `La prise est recouverte par ${avant.dessus}: la souris ne peut pas l'attraper`);
  await page.mouse.move(avant.x, avant.y);
  await page.mouse.down();
  await page.mouse.move(avant.x + dx, avant.y, { steps: 12 });
  await page.mouse.up();
  await new Promise((done) => setTimeout(done, 150));
  return lire(page);
}

async function ouvrir(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await enterRoom(page);
  await page.waitForSelector("#columnHandle");
  // Une salle sans jeu ouvre son menu par-dessus tout. Fermé, puis VÉRIFIÉ:
  // un menu resté ouvert rendrait chaque glissement sans effet.
  if (await page.$("#menu")) await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("menu"), { timeout: 5000 });
  await new Promise((done) => setTimeout(done, 300));
  // Les deux écrans qui recouvrent toute la page, colonne comprise.
  assert.equal(await page.$("#idle-room"), null, "La salle se croit sans jeu: l'écran d'attente recouvre la colonne");
  assert.equal(await page.$("#booting"), null, "L'écran de chargement recouvre la colonne");
  assert.ok(await page.$("#padOnlyNotice"), "La page n'est pas en manette seule");
}

try {
  const { url } = await salleJetable();
  const digest = (data) => createHash("sha256").update(data).digest("hex");
  assert.equal(
    digest(Buffer.from(await (await fetch(url)).arrayBuffer())),
    digest(await readFile(join(repo, "core/crates/worker/src/page/index.html"))),
    "Le binaire sert une ancienne page : lancer `just browser-colonne`, qui le reconstruit.",
  );

  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await seedName(page);
  // La manette seule, avant le premier rendu: voir l'en-tête.
  await page.evaluateOnNewDocument(() => localStorage.setItem("nel3ab:padonly", "oui"));
  await page.setViewport({ width: 1440, height: 900 });
  await ouvrir(page, url);

  const depart = await lire(page);
  assert.equal(depart.colonne, NORMAL, "La colonne ne part pas de sa largeur d'origine");
  assert.equal(depart.aria, NORMAL);
  console.log(`  départ : colonne ${depart.colonne} px, image ${depart.image} px`);

  const large = await tirer(page, -96);
  assert.equal(large.colonne, NORMAL + 96, "Tirer vers la gauche n'a pas élargi de 96 px");
  assert.equal(depart.image - large.image, 96, "L'image n'a pas rendu la place prise");
  assert.equal(large.aria, large.colonne, "La poignée annonce une autre largeur que celle vue");
  assert.equal(large.focus, false, "La poignée a gardé le focus: elle volerait les flèches du jeu");
  console.log(`  tirée de 96 px à gauche : colonne ${large.colonne} px, image ${large.image} px`);

  const haut = await tirer(page, -900);
  assert.equal(haut.colonne, MAX, "La borne haute ne tient pas");
  const bas = await tirer(page, 900);
  assert.equal(bas.colonne, MIN, "La borne basse ne tient pas");
  console.log(`  bornes : ${haut.colonne} px au plus, ${bas.colonne} px au moins`);

  // La borne basse est MESURÉE, et c'est ici qu'elle se remesure: à MIN, rien
  // ne sort de la colonne, dans ses deux modes. Le jumeau: 16 px de moins, et
  // quelque chose sort en mode « salle ». Sans lui, un critère qui ne voit
  // aucun débordement rendrait ce vert pour rien, et une borne trop haute
  // passerait inaperçue. La largeur est posée et relue dans la même tâche:
  // aucun rendu de la page ne peut s'intercaler et la remettre.
  const sorties = (largeur) => page.evaluate((w) => {
    const side = document.getElementById("side");
    const avant = side.style.width;
    side.style.width = `${w}px`;
    const bord = side.getBoundingClientRect().right;
    const dehors = [...side.querySelectorAll("*")]
      .filter((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().right > bord + 0.5)
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} « ${(el.textContent || "").trim().slice(0, 30)} »`);
    const defile = side.scrollWidth > side.clientWidth;
    side.style.width = avant;
    return { dehors, defile };
  }, largeur);
  for (const mode of ["details", "normal"]) {
    await page.click(`#mode-${mode}`);
    await new Promise((done) => setTimeout(done, 300));
    const juste = await sorties(MIN);
    assert.deepEqual(juste.dehors, [], `À ${MIN} px en mode ${mode}, sort de la colonne : ${juste.dehors.join(", ")}`);
    assert.equal(juste.defile, false, `À ${MIN} px en mode ${mode}, la colonne défile de côté`);
  }
  const sous = await sorties(MIN - STEP);
  assert.ok(sous.dehors.length > 0 && sous.defile,
    `À ${MIN - STEP} px rien ne sort de la colonne : la borne basse est trop haute, ou ce critère ne voit rien`);
  console.log(`  à ${MIN} px rien ne sort, dans les deux modes ; à ${MIN - STEP} px : ${sous.dehors.join(", ")}`);

  await tirer(page, -80);
  await ouvrir(page, url);
  const relue = await lire(page);
  assert.equal(relue.colonne, MIN + 80, "La largeur n'a pas survécu au rechargement");
  console.log(`  après rechargement : ${relue.colonne} px`);

  await page.mouse.move(relue.x, relue.y);
  await page.mouse.down({ clickCount: 1 });
  await page.mouse.up({ clickCount: 1 });
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  await new Promise((done) => setTimeout(done, 150));
  assert.equal((await lire(page)).colonne, NORMAL, "Le double-clic ne rend pas la largeur d'origine");
  await ouvrir(page, url);
  assert.equal((await lire(page)).colonne, NORMAL, "Le double-clic n'a pas été retenu");
  console.log(`  double-clic : ${NORMAL} px, retenu`);

  // Une largeur retenue sur un grand écran, relue dans une petite fenêtre.
  await tirer(page, -900);
  await page.setViewport({ width: 800, height: 800 });
  await ouvrir(page, url);
  const etroite = await lire(page);
  assert.equal(etroite.colonne, 400, "Dans 800 px la colonne dépasse la moitié de la fenêtre");
  console.log(`  fenêtre de 800 px avec ${MAX} retenus : colonne ${etroite.colonne} px`);

  // L'invariant de `layout.mjs`, à la largeur la plus défavorable.
  await page.setViewport({ width: 1100, height: 800 });
  await ouvrir(page, url);
  const cote = await page.evaluate(() => {
    const screen = document.getElementById("screen").getBoundingClientRect();
    const side = document.getElementById("side").getBoundingClientRect();
    return { beside: side.left >= screen.right - 1, width: Math.round(side.width) };
  });
  assert.equal(cote.width, MAX);
  assert.ok(cote.beside, `À 1100 px et ${MAX} px de colonne, l'image passe dessous`);
  console.log(`  1100 px et colonne de ${cote.width} px : les chiffres restent à droite de l'image`);

  console.log("PASS — la colonne se tire entre ses bornes, l'image suit, la largeur est retenue");
} finally {
  await browser?.close();
  if (worker && worker.exitCode === null) {
    worker.kill("SIGTERM");
    await Promise.race([
      once(worker, "exit"),
      new Promise((done) => setTimeout(done, 5_000)).then(() => worker.kill("SIGKILL")),
    ]);
  }
}
