/** Une salle servie sous un préfixe se comporte-t-elle normalement ?
 *
 * Le salon occupera la racine de nel3ab.app, et chaque salle vivra sous
 * `/r/<numéro>/`. Le proxy retire ce préfixe avant de transmettre au worker,
 * exactement comme `handle_path` chez Caddy, si bien que le worker n'a rien à
 * apprendre. C'est la PAGE qui doit changer: une adresse écrite en dur, comme
 * `/roms`, irait frapper à la racine, donc au salon, qui ne sert aucun jeu.
 *
 * Ce pilote monte un vrai worker, un proxy qui imite Caddy, et charge la page
 * sous `/r/7/` dans un vrai navigateur. Il vérifie deux choses:
 *
 *   1. la page marche, c'est-à-dire que son catalogue s'affiche;
 *   2. AUCUNE requête n'arrive hors du préfixe, WebSockets comprises.
 *
 * La seconde est la vraie. Sans elle, une adresse oubliée dans un coin de la
 * page passerait inaperçue tant que le salon n'existe pas, et tomberait le jour
 * de la bascule, quand la racine cesserait d'être la salle.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { createServer, request } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer as createSocket } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";

import { seedName } from "./open.mjs";

const PREFIXE = "/r/7";
const repo = new URL("../../", import.meta.url).pathname;
const aFermer = [];

async function portLibre() {
  const server = createSocket();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const { port } = server.address();
  await new Promise(done => server.close(done));
  return port;
}

try {
  const root = await mkdtemp(join(tmpdir(), "nel3ab-prefixe-"));
  const media = await portLibre();
  const control = await portLibre();
  const devant = await portLibre();
  await mkdir(join(root, "session"));
  // Sans jeu: ce pilote regarde des adresses, pas une partie.
  await writeFile(join(root, "session/game-closed"), "");
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
      // LA place de la Switch, dans un dossier jetable. Sans cela le
      // pilote prendrait celle de la vraie salle, et empêcherait
      // quelqu'un de lancer un jeu Switch pendant qu'il mesure.
      NEL3AB_SWITCH_LOCK: join(root, "switch.lock"),
      NEL3AB_CONTAINER: "nel3ab-aucune-salle-ici",
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  aFermer.push(() => { if (worker.exitCode === null) worker.kill("SIGTERM"); });
  worker.stdout.pipe(log); worker.stderr.pipe(log);

  // Tout ce que la page a demandé, pour pouvoir accuser précisément.
  const demandes = [];
  const proxy = createServer((entrant, sortant) => {
    demandes.push(entrant.url);
    if (!entrant.url.startsWith(`${PREFIXE}/`)) {
      sortant.writeHead(404).end("hors du préfixe de la salle");
      return;
    }
    const vers = request({
      hostname: "127.0.0.1", port: media, path: entrant.url.slice(PREFIXE.length),
      method: entrant.method, headers: entrant.headers,
    }, reponse => {
      sortant.writeHead(reponse.statusCode, reponse.headers);
      reponse.pipe(sortant);
    });
    vers.on("error", () => {
      if (!sortant.headersSent) sortant.writeHead(502);
      sortant.end("le worker ne répond pas");
    });
    entrant.on("error", () => vers.destroy());
    sortant.on("error", () => vers.destroy());
    entrant.pipe(vers);
  });
  // Les WebSockets passent par une montée en grade, que `createServer` ne
  // transmet pas toute seule. Sans ceci, l'image et le son ne seraient pas
  // mesurés du tout, et le pilote passerait en ne regardant que du HTTP.
  proxy.on("upgrade", (entrant, prise, tete) => {
    demandes.push(entrant.url);
    if (!entrant.url.startsWith(`${PREFIXE}/`)) { prise.destroy(); return; }
    const vers = request({
      hostname: "127.0.0.1", port: media, path: entrant.url.slice(PREFIXE.length),
      method: "GET", headers: entrant.headers,
    });
    vers.on("upgrade", (reponse, amont, resteTete) => {
      prise.write(`HTTP/1.1 101 ${reponse.statusMessage}\r\n`
        + Object.entries(reponse.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")
        + "\r\n\r\n");
      if (resteTete?.length) amont.unshift(resteTete);
      if (tete?.length) vers.socket.write(tete);
      // Fermer le navigateur coupe ces deux tuyaux au milieu d'une écriture.
      // Sans ces deux gardes, le pilote RÉUSSIT puis meurt sur un ECONNRESET,
      // et `just` le compte rouge: la preuve était bonne, le rapport faux.
      amont.on("error", () => prise.destroy());
      prise.on("error", () => amont.destroy());
      amont.pipe(prise); prise.pipe(amont);
    });
    vers.on("error", () => prise.destroy());
    vers.end();
  });
  proxy.listen(devant, "127.0.0.1"); await once(proxy, "listening");
  aFermer.push(() => new Promise(done => proxy.close(done)));

  for (let n = 0; n < 100; n++) {
    const up = await fetch(`http://127.0.0.1:${media}/roms`).then(r => r.ok).catch(() => false);
    if (up) break;
    assert.equal(worker.exitCode, null, `Le worker est mort au démarrage, voir ${chemin}`);
    await new Promise(done => setTimeout(done, 200));
  }

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  aFermer.push(() => browser.close());
  const page = await browser.newPage();
  // La salle demande un nom avant de montrer quoi que ce soit. Sans lui, le
  // pilote mesurerait l'écran d'accueil et croirait la page cassée.
  await seedName(page);
  const plaintes = [];
  page.on("pageerror", erreur => plaintes.push(String(erreur)));
  await page.goto(`http://127.0.0.1:${devant}${PREFIXE}/`, { waitUntil: "domcontentloaded" });
  // La salle s'ouvre sur son salon: places libres, jeu en cours, et deux
  // boutons. Le catalogue n'arrive qu'ensuite, et surtout l'image et le son ne
  // s'ouvrent qu'une fois entré. Un pilote qui s'arrêterait à cet écran ne
  // prouverait que du HTTP.
  try {
    await page.waitForFunction(
      () => document.body.innerText.includes("entrer et jouer"),
      { timeout: 20_000 },
    );
  } catch (echec) {
    // Un pilote qui échoue sans dire ce qu'il a vu fait perdre le temps qu'il
    // devait faire gagner.
    const vu = await page.evaluate(() => document.body.innerText.slice(0, 300));
    assert.fail("La salle ne s'affiche pas sous le préfixe."
      + `\n  requêtes: ${demandes.join(", ") || "aucune"}`
      + `\n  erreurs de page: ${plaintes.join(" | ") || "aucune"}`
      + `\n  texte affiché: ${JSON.stringify(vu)}`
      + `\n  ${echec}`);
  }
  const entre = await page.evaluateHandle(() =>
    [...document.querySelectorAll("button, a, [role=button]")]
      .find(element => element.innerText.toLowerCase().includes("entrer et jouer")));
  const bouton = entre.asElement();
  assert.ok(bouton, "Le bouton pour entrer n'est pas cliquable");
  await bouton.click();

  // Attendre la socket de l'image PLUTÔT qu'un délai fixe: un délai trop court
  // ferait échouer le pilote sur une machine chargée, et un délai trop long le
  // ferait passer en dormant.
  for (let n = 0; n < 100 && !demandes.some(url => url.includes("/video")); n++) {
    await new Promise(done => setTimeout(done, 200));
  }

  // La page parle à DEUX serveurs, et c'est le point que ce pilote a appris le
  // 12 septembre 2026. Le worker sert la salle, donc sous le préfixe. Le salon
  // sert les noms, les places et sa socket, et il vit à la racine du domaine
  // pour tout le monde: préfixer ses adresses les enverrait à la salle, qui ne
  // les connaît pas. Seules celles-là ont le droit de sortir du préfixe.
  const duSalon = url => url.startsWith("/api/") || url.startsWith("/socket.io");
  const dehors = demandes.filter(url => !url.startsWith(`${PREFIXE}/`) && !duSalon(url));
  assert.deepEqual(dehors, [],
    `La page demande au worker des adresses à la racine: ${dehors.join(", ")}`);
  assert.ok(demandes.some(duSalon), "Aucune adresse du salon: le pilote ne prouve plus la distinction");
  for (const attendu of [`${PREFIXE}/roms`, `${PREFIXE}/video`]) {
    assert.ok(demandes.some(url => url.startsWith(attendu)),
      `La page n'a jamais demandé ${attendu}; demandé: ${demandes.join(", ")}`);
  }
  assert.deepEqual(plaintes, [], "La page a levé une erreur sous son préfixe");

  console.log(`la page tient sous ${PREFIXE}/ : ${demandes.length} requêtes, `
    + "toutes sous le préfixe");
} finally {
  for (const fermer of aFermer.reverse()) await fermer();
}
