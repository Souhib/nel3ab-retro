/** Une vraie salle temporaire : page, salon, worker, Dolphin et GPU.
 * `just preparation-test '/chemin/Mario Kart Wii.rvz'` construit le binaire de
 * développement. Aucun service installé n'est arrêté. Le jeu, ses sauvegardes,
 * les identités et les ports de cet essai sont indépendants de la salle.
 * Les assertions portent sur le parcours de préparation et de reconnexion.
 * Reconnaître les manettes dans les menus du JEU reste une observation humaine.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile, realpath, cp, access } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { promisify } from "node:util";
import puppeteer from "puppeteer";
import { limitedLink } from "./limited-link.mjs";
import { seedName, enterRoom, watchRoom } from "./open.mjs";

const execute = promisify(execFile);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// L'artefact précédant les reçus est conservé dans Git, pas recopié dans une
// fixture qu'un prochain build pourrait actualiser sans le vouloir.
const network = process.env.NEL3AB_TEST_NETWORK === "1";
let link;
const churn = process.env.NEL3AB_TEST_CHURN === "1";
const resilience = process.env.NEL3AB_TEST_RESILIENCE === "1";
const closing = process.env.NEL3AB_TEST_IDLE_ROOM === "1";
const recovery = process.env.NEL3AB_TEST_RECOVERY === "1";
const plannedStops = new Set();
const migration = process.env.NEL3AB_TEST_LEGACY_PAGE === "1";
const oldPage = migration ? (await execute("git", ["show",
  "16eebcb144e487c6f5cb00fa2de4569962980d8b:core/crates/worker/src/page/index.html"],
  { cwd: repo, maxBuffer: 2_000_000 })).stdout : null;
if (migration) assert.ok(oldPage && !oldPage.includes("identity=1"));
assert.ok(process.argv[2], "Indiquer le disque Mario Kart Wii à tester.");
const rom = await realpath(process.argv[2]);
if (!network) assert.match(basename(rom), /^Mario Kart Wii.*\.(rvz|iso)$/i);
const gcRom = closing && process.env.NEL3AB_TEST_GC_ROM ? await realpath(process.env.NEL3AB_TEST_GC_ROM) : null;
const root = await mkdtemp(join(tmpdir(), "nel3ab-preparation-"));
const container = basename(root);
const reservations = [];
for (let i = 0; i < 5; i++) {
  const server = createServer();
  await new Promise((yes, no) => server.once("error", no).listen(0, "127.0.0.1", yes));
  reservations.push(server);
}
const [door, media, control, lobby, narrow] = reservations.map((s) => s.address().port);
const url = `http://localhost:${door}/`;
const env = {
  ...process.env,
  NEL3AB_CONTAINER: container,
  NEL3AB_ROM: rom,
  NEL3AB_ROM_DIR: gcRom ? `${dirname(rom)}:${dirname(gcRom)}` : dirname(rom),
  NEL3AB_DOLPHIN: join(repo, "docker/dolphin-in-docker.sh"),
  NEL3AB_SESSION_DIR: join(root, "session"),
  NEL3AB_ART_DIR: join(root, "art"),
  NEL3AB_BIND: `127.0.0.1:${media}`,
  NEL3AB_CONTROL_BIND: `127.0.0.1:${control}`,
  NEL3AB_WORKER_URL: `http://127.0.0.1:${media}`,
  NEL3AB_WORKER_CONTROL: `127.0.0.1:${control}`,
  NEL3AB_WORKER_PUBLIC_URL: "",
  NEL3AB_STATE_FILE: join(root, "people.json"),
  NEL3AB_BINDINGS_FILE: join(root, "bindings.json"),
  NEL3AB_ROOM_BINDINGS_FILE: join(root, "room-bindings.json"),
  NEL3AB_JOURNAL_DIR: join(root, "journal"),
  NEL3AB_ADMIN: "",
  NEL3AB_ROOM_NAME: "Essai isolé",
  NEL3AB_ORIGINS: JSON.stringify([new URL(url).origin, `http://localhost:${narrow}`]),
  NEL3AB_INTERNAL_RES: "2",
  NEL3AB_PLAYERS: "4",
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_DATA_HOME: join(root, "data"),
};
const children = [];
const logs = [];
let generation = 0;
let stopping = false;
let workerFailure = null;
let activeWorker;
const exits = [];
let browser;
const interrupted = () => {
  workerFailure = new Error("Essai interrompu, arrêt de la salle temporaire.");
  void browser?.close();
};
process.once("SIGINT", interrupted);
process.once("SIGTERM", interrupted);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const until = async (predicate, message, timeout = 30000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (workerFailure) throw workerFailure;
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(message);
};
const start = (command, args, name, cwd = repo) => {
  const log = createWriteStream(join(root, `${name}.log`), { flags: "a" });
  logs.push(log);
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on("error", (error) => { workerFailure = error; });
  children.push(child);
  return child;
};
const boot = () => {
  generation++;
  const worker = start(join(repo, "core/target/debug/nel3ab-worker"), [], "worker");
  activeWorker = worker;
  worker.on("exit", (code, signal) => {
    exits.push({ pid: worker.pid, code, signal, at: Date.now() });
    if (stopping) return;
    if ((code !== 0 && !plannedStops.delete(worker.pid)) || generation >= (resilience ? 8 : closing ? 6 : 3)) {
      workerFailure = new Error(`Worker arrêté (${code}), voir ${root}/worker.log`);
      return;
    }
    setTimeout(() => { if (!stopping) boot(); }, 1000);
  });
};
const room = async () => (await fetch(new URL("/api/room", url))).json();
const button = (page, text) => page.evaluate((label) => {
  const node = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
  if (!node || node.disabled) throw new Error(`Commande indisponible : ${label}`);
  node.click();
}, text);
const open = async (name, play, legacy = false, address = url, half = false) => {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => { workerFailure = error; console.error(name, error); });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setExtraHTTPHeaders({
    "Tailscale-User-Login": `${name.toLowerCase()}@example.test`,
    "Tailscale-User-Name": name,
  });
  await seedName(page, name);
  if (half) await page.evaluateOnNewDocument(() => localStorage.setItem("nel3ab:half", "1"));
  await page.evaluateOnNewDocument(() => {
    window.testPad = {
      id: "Xbox 360 Controller (STANDARD GAMEPAD)", index: 0, mapping: "standard",
      connected: true, timestamp: 1, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    navigator.getGamepads = () => { const pads = Array(window.testPad ? window.testPad.index + 1 : 0).fill(null); if (window.testPad) pads[window.testPad.index] = window.testPad; return pads; };
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(window.testOffline ? new URL("/__offline_test__", String(args[0])).href : args[0], ...args.slice(1));
        (window.testSockets ??= []).push(this);
        if (new URL(String(args[0])).pathname === "/input") {
          window.inputSocket = this;
          (window.inputUrls ??= []).push(String(args[0]));
          this.addEventListener("message", (event) => {
            if (typeof event.data === "string" && event.data.startsWith("pad "))
              window.actualDevice = Number(event.data.slice(4));
          });
        }
      }
    };
  });
  await page.goto(legacy ? new URL("legacy.html", url).href : address);
  await (play ? enterRoom(page) : watchRoom(page));
  try {
    if (closing && (await room()).game === null) {
      await page.waitForFunction(() => document.body.textContent.includes("aucun jeu · choisis un jeu"));
    } else await page.waitForFunction(() => nel3abTest.counters().painted > 10, { timeout: 60000 });
  } catch (error) {
    await page.screenshot({ path: join(root, `${name}-sans-image.png`) });
    console.error(await page.evaluate(() => ({
      text: document.body.innerText,
      inputs: window.inputUrls,
      counters: globalThis.nel3abTest?.counters(),
    })));
    throw workerFailure ?? error;
  }
  return page;
};

try {
  await mkdir(env.NEL3AB_SESSION_DIR);
  if (network && process.env.NEL3AB_TEST_SEED_SAVES) {
    await cp(await realpath(process.env.NEL3AB_TEST_SEED_SAVES), join(env.NEL3AB_SESSION_DIR, "saves"), { recursive: true });
  }
  if (oldPage !== null) await writeFile(join(root, "legacy.html"), oldPage);
  // Le cache est une copie. Le test ne remplit ni ne modifie celui du service.
  await cp(join(homedir(), ".cache/nel3ab/banners"), env.NEL3AB_ART_DIR, { recursive: true })
    .catch((error) => { if (error.code !== "ENOENT") throw error; });
  await writeFile(join(root, "Caddyfile"), `{
 admin off
 persist_config off
 auto_https off
 storage file_system { root ${root}/tls }
}
http://localhost:${door} {
 bind 127.0.0.1
 handle /api/* {
  reverse_proxy 127.0.0.1:${lobby}
 }
 handle /socket.io/* {
  reverse_proxy 127.0.0.1:${lobby}
 }
 handle /legacy.html {
  root * ${root}
  header Cache-Control no-cache
  file_server
 }
 handle {
  reverse_proxy 127.0.0.1:${media}
 }
}
`.replace(`storage file_system { root ${root}/tls }`, `storage file_system {\n root ${root}/tls\n }`));
  await Promise.all(reservations.map((s) => new Promise((done) => s.close(done))));
  console.log(`Salle temporaire : ${url}\nTraces et sauvegardes de test : ${root}`);
  start("caddy", ["run", "--config", join(root, "Caddyfile"), "--adapter", "caddyfile"], "proxy");
  const startLobby = () => start(join(repo, "control/.venv/bin/python"), ["-m", "uvicorn", "nel3ab_control.app:app",
    "--host", "127.0.0.1", "--port", String(lobby)], "lobby", join(repo, "control"));
  let salon = startLobby();
  boot();
  await until(async () => {
    try { const game = (await room()).game; return network ? Boolean(game) : game?.name === "Mario Kart Wii"; } catch { return false; }
  }, "La salle temporaire ne démarre pas", 60000);
  const digest = data => createHash("sha256").update(data).digest("hex");
  assert.equal(digest(Buffer.from(await (await fetch(url)).arrayBuffer())),
    digest(await readFile(join(repo, "core/crates/worker/src/page/index.html"))),
    "Le binaire sert une ancienne page : lancer la recette just pour le reconstruire.");
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
  const alice = await open("Alice", true, migration);
  const benoit = await open("Benoit", true);
  if (network) link = await limitedLink({port: narrow, toPort: door});
  const camille = await open("Camille", false, false, network ? `http://localhost:${narrow}/` : url, network);
  const names = async () => (await room()).seats.map((s) => s.player);
  if (network) {
    const pages = [alice, benoit, camille];
    const read = () => Promise.all(pages.map(page => page.evaluate(() => nel3abTest.pacing())));
    // Leave the initial health notice if the game accepts A. Do not claim that
    // these canned presses reproduce a race; the screenshot records the scene.
    await alice.evaluate(() => Object.assign(window.testPad.buttons[0], {pressed:true,value:1}));
    await delay(300);
    await alice.evaluate(() => Object.assign(window.testPad.buttons[0], {pressed:false,value:0}));
    await delay(1500);
    // Melee creates the test memory card on the first press, then waits for
    // another confirmation. Try to dismiss it; inspect the recorded screenshot
    // before interpreting bandwidth as a moving-game measurement.
    if (/Melee/i.test(basename(rom))) {
      await alice.evaluate(() => Object.assign(window.testPad.buttons[0], {pressed:true,value:1}));
      await delay(300);
      await alice.evaluate(() => Object.assign(window.testPad.buttons[0], {pressed:false,value:0}));
    }
    await delay(5000);
    // Observation interactive optionnelle : permettre de rejoindre une course
    // réelle avant les mesures, sans automatiser une suite de menus aveugles.
    let scene = "Scène automatisée, à identifier sur les captures ; aucune course jouée garantie.";
    if (process.env.NEL3AB_TEST_NETWORK_MANUAL === "1") {
      await writeFile(join(root, "browser.json"), JSON.stringify({endpoint: browser.wsEndpoint(), root, url}));
      console.log(`Préparer une course via ${root}/browser.json puis créer ${root}/measure-ready.`);
      await until(() => access(join(root, "measure-ready")).then(() => true, () => false),
        "La course n'a pas été préparée", 600000);
      scene = (await readFile(join(root, "measure-ready"), "utf8")).trim() || "Scène préparée manuellement, à identifier sur les captures.";
    }
    const measure = async (label, cap) => {
      link.squeeze(cap);
      await delay(4000);
      const capture = String(cap).replaceAll(".", "-");
      await camille.screenshot({path:join(root, `reseau-${capture}-avant.png`)});
      const bytes = link.stats().bytes, before = await read(), start = performance.now();
      await delay(15000);
      const after = await read(), seconds = (performance.now() - start) / 1000;
      const mbps = (link.stats().bytes - bytes) * 8 / seconds / 1e6;
      const result = {label, cap, seconds, receivedMbps: mbps, ...link.stats(), viewers: after.map((v,i) => ({width:v.pictureW,height:v.pictureH,painted:v.painted-before[i].painted,arrived:v.arrived-before[i].arrived,starved:v.starved-before[i].starved,undecoded:v.undecoded-before[i].undecoded,jitter:v.jitter,queue:v.queue,refresh:v.refresh,slackMs:v.slackMs}))};
      await camille.screenshot({path:join(root, `reseau-${capture}-apres.png`)});
      console.log(JSON.stringify(result));
      assert.ok(mbps <= cap * 1.1 + 0.05, "Le relais ne respecte pas son plafond");
      for (const v of result.viewers.slice(0,2)) { assert.ok(v.painted > 100); assert.ok(v.width > after[2].pictureW); }
      return result;
    };
    await camille.screenshot({path:join(root,"reseau-scene-avant.png")});
    const baseline = await measure("deux pleins, un réduit sans plafond utile", 1000);
    const narrowResult = await measure("demi-format à 5 Mbit/s", 5);
    const squeezed = await measure("plafond sous le débit observé", Math.max(0.001, baseline.receivedMbps / 2));
    link.squeeze(1000); await delay(5000);
    await camille.screenshot({path:join(root,"reseau-scene.png")});
    await writeFile(join(root,"network.json"), JSON.stringify({scene,baseline,narrow:narrowResult,squeezed}, null, 2));
    assert.equal(generation,1);
    console.log("PASS · trois spectateurs, format personnel, débit réellement plafonné et spectateurs pleins toujours alimentés. Voir network.json et les captures pour le contenu réellement mesuré.");
  } else if (resilience) {
    await assert.rejects(execute(env.NEL3AB_DOLPHIN, ["--cleanup", "--user", join(root, "another-session")], { env }), error => error.code === 65);
    assert.equal((await execute("docker", ["inspect", "--format", "{{.State.Running}}", container])).stdout.trim(), "true");
    console.log("PASS · un nom de conteneur réutilisé ne permet pas d'arrêter une autre session.");
    const waitImages = async () => {
      await until(async () => { try { const game = (await room()).game; return network ? Boolean(game) : game?.name === "Mario Kart Wii"; } catch { return false; } }, "Jeu absent après reprise", 60000);
      const count = await alice.evaluate(() => nel3abTest.counters().painted);
      await alice.waitForFunction(n => nel3abTest.counters().painted > n + 10, { timeout: 60000 }, count);
    };
    for (const asleep of [false, true]) {
      if (asleep) await execute("docker", ["pause", container]);
      const old = activeWorker; const began = Date.now();
      old.kill("SIGTERM");
      await until(() => exits.some(x => x.pid === old.pid), "SIGTERM ne finit pas", 12000);
      assert.equal(exits.find(x => x.pid === old.pid).code, 0, "SIGTERM doit suivre l'arrêt propre");
      console.log(`PASS · SIGTERM ${asleep ? "Dolphin en pause" : "Dolphin éveillé"} : ${Date.now() - began} ms`);
      await until(() => activeWorker !== old, "Pas de relève");
      await waitImages();
    }
    // Pause imposée hors du fil de sieste : un producteur vivant qui ne
    // fournit plus rien, alors que des joueurs tiennent toujours leurs places.
    const quiet = activeWorker; const began = Date.now();
    await execute("docker", ["pause", container]);
    await until(() => activeWorker !== quiet, "Le silence éveillé reste sans reprise", 45000);
    const log = await readFile(join(root, "worker.log"), "utf8");
    assert.match(log, /emulator awake but no frames/);
    assert.match(log, /without frames for 30 seconds/);
    assert.equal(exits.find(x => x.pid === quiet.pid).code, 0);
    await waitImages();
    console.log(`PASS · producteur muet repris : ${Date.now() - began} ms`);
    // Un arrêt brutal laisse cette fois un vrai orphelin en pause.
    const orphan = activeWorker;
    await execute("docker", ["pause", container]);
    plannedStops.add(orphan.pid); orphan.kill("SIGKILL");
    await until(() => activeWorker !== orphan, "Pas de relève après arrêt brutal");
    await waitImages();
    assert.equal(generation, 5, "Une seule relève doit suffire à récupérer l'orphelin");
    console.log("PASS · orphelin récupéré avant l'ouverture du son, images revenues sans boucle de redémarrage.");
  } else if (churn) {
    await camille.$eval("#takePad", e => e.click());
    let dina = await open("Dina", true);
    const expected = ["Alice", "Benoit", "Camille", "Dina"];
    const pages = () => [alice, benoit, camille, dina];
    const verify = async (wanted) => {
      await until(async () => JSON.stringify(await names()) === JSON.stringify(wanted), `Places attendues : ${wanted}`);
      for (const page of pages()) {
        if (page.isClosed()) continue;
        await page.waitForFunction(wanted => wanted.every((name, i) => {
          const text = document.querySelector(`#port${i + 1}`)?.textContent ?? "";
          const slot = document.querySelector(`#port${i + 1}`);
          return name ? text.includes(name) && !/occupé/.test(text) : slot?.dataset.state === "free" && slot.querySelector(":scope > span").textContent.trim() === "";
        }), {}, wanted);
      }
      const described = await room();
      for (const person of described.people) {
        if (wanted.includes(person.name)) assert.equal(person.seat, wanted.indexOf(person.name) + 1);
      }
      assert.equal(described.owner.name, "Alice");
    };
    await verify(expected);
    for (let turn = 0; turn < 3; turn++) {
      console.log(`Cycle ${turn + 1} : spectateur, départ, retour et réseau`);
      await benoit.$eval("#watchOnly", e => e.click());
      await verify(["Alice", null, "Camille", "Dina"]);
      await alice.waitForFunction(() => document.querySelector('[aria-label="spectateurs"]').textContent.includes("Benoit"));
      await benoit.$eval("#takePad", e => e.click());
      await verify(expected);
      await dina.close();
      await verify(["Alice", "Benoit", "Camille", null]);
      dina = await open("Dina", true);
      await verify(expected);
      await camille.evaluate(() => window.inputSocket.close());
      await verify(expected);
      // Coupure réseau complète : les deux canaux doivent se réconcilier.
      await benoit.setOfflineMode(true);
      await benoit.evaluate(() => { window.testOffline = true; window.testSockets.forEach(s => s.close()); });
      await benoit.waitForFunction(() => nel3abTest.seat() === null);
      await delay(1500);
      await benoit.evaluate(() => { window.testOffline = false; });
      await benoit.setOfflineMode(false);
      await verify(expected);
    }
    // Débrancher ne cède pas une place et ne bloque pas le retour du profil.
    await benoit.evaluate(() => { window.savedTestPad = window.testPad; window.testPad = null; });
    await benoit.waitForFunction(() => document.querySelector("#controller-status")?.textContent.includes("déconnectée"));
    await verify(expected);
    await benoit.evaluate(() => { window.testPad = { ...window.savedTestPad, index: 3 }; });
    await benoit.waitForFunction(() => document.querySelector("#controller-status")?.textContent.includes("reconnectée"));
    await verify(expected);
    const game = (await room()).game.index;
    await alice.$eval("#openMenu", e => e.click());
    await alice.waitForSelector(`#item-game${game}`);
    await alice.$eval(`#item-game${game}`, e => e.click());
    await alice.waitForSelector("#pickerConfirm"); await alice.$eval("#pickerConfirm", e => e.click());
    for (const [index, page] of pages().entries()) {
      await page.waitForSelector("#bindingsPanel[open]");
      const columns = await page.$eval(".n3-mapping-list", e => getComputedStyle(e).gridTemplateColumns.split(" ").length);
      assert.equal(columns, 1);
      await page.select('[aria-label="Ma configuration pour ce jeu"]', String(index % 2));
      await button(page, "Je suis prêt");
    }
    await alice.waitForFunction(() => !document.querySelector("#launchPrepared").disabled);
    await button(alice, "Lancer le jeu");
    await until(() => generation === 2, "Préparation à quatre non lancée");
    await verify(expected);
    for (const [index, page] of pages().entries()) {
      await page.waitForFunction(kind => window.actualDevice === kind, {}, index % 2);
      const count = await page.evaluate(() => nel3abTest.counters().painted);
      await page.waitForFunction(n => nel3abTest.counters().painted > n + 30, { timeout: 60000 }, count);
      await page.waitForSelector("#booting", { hidden: true, timeout: 60000 });
    }
    await alice.screenshot({ path: join(root, "quatre-joueurs.png") });
    console.log("PASS · quatre joueurs, trois cycles spectateur/départ/retour/coupure, branchement, noms, couronne et lancement Wii collectif.");
  } else if (recovery) {
    await until(async () => JSON.stringify(await names()) === '["Alice","Benoit",null,null]', "Noms initiaux incorrects");
    await alice.$eval("#watchOnly", e => e.click());
    await until(async () => (await room()).owner.seat === null, "Le chef n'est pas spectateur");
    // Un joueur qui répond garde sa manette.
    await camille.$eval("#port2", e => e.click());
    await benoit.waitForSelector("#keepRecovery");
    await benoit.$eval("#keepRecovery", e => e.click());
    await camille.waitForFunction(() => document.querySelector("#recovery").textContent.includes("est là"));
    assert.equal((await names())[1], "Benoit");
    await button(camille, "fermer");
    // Un spectateur qui ne répond plus peut céder la couronne sans déconnexion.
    await benoit.$eval("#recoverOwner", e => e.click());
    await alice.waitForSelector("#keepRecovery");
    await benoit.waitForSelector("#confirmRecovery");
    assert.equal(await benoit.$eval("#confirmRecovery", e => e.disabled), true);
    assert.equal((await room()).owner.name, "Alice");
    await alice.screenshot({ path: join(root, "chef-prevenu.png") });
    await benoit.waitForFunction(() => !document.querySelector("#confirmRecovery").disabled, {timeout:30000});
    assert.equal((await room()).owner.name, "Alice", "Le délai seul ne doit rien transférer");
    await benoit.$eval("#confirmRecovery", e => e.click());
    await until(async () => (await room()).owner.name === "Benoit", "La couronne reste au chef absent");
    for (const p of [alice, benoit, camille]) {
      await p.waitForFunction(() => document.querySelector('#port2 [aria-label="chef de la salle"]'));
    }
    await button(alice, "fermer");
    await button(benoit, "fermer");
    await benoit.$eval("#openMenu", e => e.click());
    await benoit.$eval("#ray-salle", e => e.click());
    assert.equal(await benoit.$eval("#item-close-game", e => e.disabled), false);
    await benoit.$eval("#closeMenu", e => e.click());
    // Revenir jouer ne redonne pas le rôle perdu.
    await alice.$eval("#takePad", e => e.click());
    await until(async () => (await names())[0] === "Alice", "Alice ne reprend pas sa place libre");
    assert.equal((await room()).owner.name, "Benoit");
    const previous = (await room()).seats[0].claim;
    await camille.$eval("#port1", e => e.click());
    await camille.waitForSelector("#confirmRecovery");
    await camille.waitForFunction(() => !document.querySelector("#confirmRecovery").disabled, {timeout:30000});
    assert.equal((await names())[0], "Alice");
    await camille.$eval("#confirmRecovery", e => e.click());
    await until(async () => JSON.stringify(await names()) === '["Camille","Benoit",null,null]', "La reprise ne rattache pas le bon nom");
    await alice.waitForSelector("#displaced");
    await delay(3500);
    assert.deepEqual(await names(), ["Camille", "Benoit", null, null]);
    // La même autorisation retardée ne peut plus déloger Camille.
    const rejected = await alice.evaluate(async (expected) => {
      // Sous le préfixe de la salle: `location.origin` seul repart de la racine,
      // donc vers le salon, qui ne porte aucune entrée de jeu. Cette page-ci est
      // servie à la racine de sa salle jetable, si bien que le défaut y est
      // LATENT plutôt qu'actif; `new URL(...)` est juste dans les deux cas.
      // Corrigé le 13 septembre 2026 avec `flood.mjs`, NON exercé: ce pilote
      // monte sa propre salle et n'a pas été relancé.
      const socket = new WebSocket(new URL(`input?identity=1&take=1&expected=${expected}`, location.href).href.replace(/^http/, 'ws'));
      socket.binaryType = "arraybuffer";
      return await new Promise((done, fail) => {
        const timer = setTimeout(() => { socket.close(); fail(new Error("Pas de refus worker")); }, 5000);
        socket.onmessage = e => {
          if (typeof e.data === "string") return;
          clearTimeout(timer); socket.close(); done(new Uint8Array(e.data)[1] === 0);
        };
      });
    }, previous);
    assert.equal(rejected, true);
    assert.deepEqual(await names(), ["Camille", "Benoit", null, null]);
    assert.equal(generation, 1, "Une reprise ne doit pas redémarrer le jeu");
    const painted = await camille.evaluate(() => nel3abTest.counters().painted);
    await camille.waitForFunction(n => nel3abTest.counters().painted > n + 10, {}, painted);
    await camille.screenshot({ path: join(root, "reprise-confirmee.png") });
    await button(alice, "fermer");
    await alice.$eval("#recoverOwner", e => e.click());
    await benoit.waitForSelector("#keepRecovery");
    await alice.$eval("#leaveRoom", e => e.click());
    await benoit.waitForFunction(() => document.querySelector("#recovery").textContent.includes("annulée"));
    assert.equal((await room()).owner.name, "Benoit");
    await button(camille, "fermer");
    await camille.setViewport({width:390,height:844});
    await camille.$eval("#recoverOwner", e => e.click());
    await camille.waitForSelector("#confirmRecovery");
    const bounds = await camille.$eval("#recovery", e => {
      const r = e.getBoundingClientRect(); return {left:r.left,right:r.right,bottom:r.bottom};
    });
    assert.ok(bounds.left >= 0 && bounds.right <= 390 && bounds.bottom <= 844);
    await camille.screenshot({path:join(root,"reprise-telephone.png")});
    await button(camille, "annuler");
    console.log("PASS · refus respecté, chef spectateur prévenu, confirmation après 20 s, couronne transférée, manette reprise, ancien joueur averti et attribution périmée refusée. Même worker et images vivantes.");
  } else if (migration) {
    await until(async () => JSON.stringify(await names()) === '[null,"Benoit",null,null]', "L'ancienne page doit rester sans association inventée");
    const first = (await room()).seats[0].claim;
    assert.ok(first, "l'ancienne page doit réellement tenir une manette");
    await alice.evaluate(() => window.inputSocket.close());
    await until(async () => {
      const held = (await room()).seats[0];
      return held.claim && held.claim !== first;
    }, "L'ancienne page ne reconnecte pas sa manette");
    const previousUrls = await alice.evaluate(() => window.inputUrls);
    assert.ok(previousUrls.length >= 2, "l'ancienne page doit avoir ouvert puis rouvert sa socket");
    assert.equal(previousUrls.some((url) => url.includes("identity=1")), false);
    await until(() => camille.$eval('[aria-label="attributions en attente"]', (e) => e.textContent.includes("Alice")), "L'ancienne page n'est pas signalée en attente");
    assert.equal(await camille.$eval('[aria-label="spectateurs"]', (e) => e.textContent.includes("Alice")), false);
    await camille.screenshot({ path: join(root, "ancienne-page.png") });
    // Servir réellement les deux versions sur la même URL. Une réponse HTML
    // fabriquée par l'interception de Chromium perd son adresse locale et ses
    // WebSockets sont bloquées par Local Network Access (6 septembre 2026).
    await writeFile(join(root, "legacy.html"), await readFile(join(repo, "core/crates/worker/src/page/index.html")));
    await alice.reload({ waitUntil: "domcontentloaded" });
    await enterRoom(alice);
    await alice.waitForFunction(() => nel3abTest.counters().painted > 10, { timeout: 60000 });
    await until(async () => JSON.stringify(await names()) === '["Alice","Benoit",null,null]', "Actualiser l'ancienne page ne rétablit pas son nom");
    const currentUrls = await alice.evaluate(() => window.inputUrls);
    assert.ok(currentUrls.length > 0, "la nouvelle page doit ouvrir sa socket");
    assert.equal(currentUrls.every((url) => url.includes("identity=1")), true);
    await camille.waitForSelector('[aria-label="attributions en attente"]', { hidden: true });
    await camille.screenshot({ path: join(root, "page-actualisee.png") });
    // Le retour du salon doit suffire maintenant, sans actualiser les pages ni
    // changer les attributions du worker pour forcer une nouvelle annonce.
    const receipts = (await room()).seats.map((s) => s.claim);
    salon.kill("SIGTERM");
    await until(() => salon.exitCode !== null || salon.signalCode !== null, "Le salon temporaire ne s'arrête pas");
    salon = startLobby();
    await until(async () => {
      try { return JSON.stringify(await names()) === '["Alice","Benoit",null,null]'; }
      catch { return false; }
    }, "Les noms ne reviennent pas après la reconnexion du salon");
    assert.deepEqual((await room()).seats.map((s) => s.claim), receipts);
    assert.equal(generation, 1, "La reconnexion du salon ne relance pas Dolphin");
    console.log("PASS · ancienne page reconnectée, actualisation, noms restaurés et redémarrage du salon sans toucher aux manettes.");
  } else if (closing) {
    await until(async () => JSON.stringify(await names()) === '["Alice","Benoit",null,null]', "Noms initiaux incorrects");
    const game = (await room()).game.index;
    await benoit.$eval("#openMenu", e => e.click());
    await benoit.$eval("#ray-salle", e => e.click());
    assert.equal(await benoit.$eval("#item-close-game", e => e.disabled), true);
    await benoit.$eval("#closeMenu", e => e.click());
    await alice.$eval("#watchOnly", e => e.click());
    await until(async () => JSON.stringify(await names()) === '[null,"Benoit",null,null]', "Le chef n'est pas devenu spectateur");
    const closeGame = async () => {
      await alice.$eval("#openMenu", e => e.click());
      await alice.$eval("#ray-salle", e => e.click());
      await alice.$eval("#item-close-game", e => e.click());
      await alice.waitForSelector("#pickerConfirm");
      await alice.$eval("#pickerConfirm", e => e.click());
    };
    const before = Date.now();
    await closeGame();
    await until(async () => (await room()).game === null, "Le jeu n'a pas été fermé", 60000);
    assert.equal(generation, 2);
    await until(async () => (await execute("docker", ["ps", "-aq", "--filter", `name=^${container}$`])).stdout.trim() === "", "Dolphin est encore vivant");
    for (const p of [alice, benoit, camille]) {
      await p.waitForFunction(() => document.querySelector("#menu") && document.body.textContent.includes("aucun jeu · choisis un jeu"));
      assert.equal(await p.$("#booting"), null);
    }
    console.log(`Fermeture demandée par le chef spectateur vers salle sans Dolphin : ${Date.now() - before} ms.`);
    await alice.screenshot({path: join(root, "salle-sans-jeu.png")});
    // Un redémarrage du worker au repos doit garder le choix de ne rien lancer.
    const idleWorker = children.findLast(child => child.spawnfile.endsWith("nel3ab-worker"));
    plannedStops.add(idleWorker.pid);
    idleWorker.kill("SIGTERM");
    await until(() => generation === 3, "Le worker au repos ne revient pas");
    await until(async () => { try { return (await (await fetch(`http://127.0.0.1:${media}/roms`)).json()).current === null; } catch { return false; } }, "Le repos n'a pas survécu au redémarrage");
    const newcomer = await open("Dana", false);
    assert.equal(await newcomer.$("#booting"), null);
    await newcomer.close();
    assert.equal((await execute("docker", ["ps", "-aq", "--filter", `name=^${container}$`])).stdout.trim(), "");
    await alice.$eval("#closeMenu", e => e.click());
    await alice.$eval("#takePad", e => e.click());
    await until(async () => JSON.stringify(await names()) === '["Alice","Benoit",null,null]', "Les places ne sont pas conservées au repos");
    await alice.$eval("#openMenu", e => e.click());
    if (gcRom) await alice.$eval("#item-shelf-wii", e => e.click());
    await alice.$eval(`#item-game${game}`, e => e.click());
    await alice.$eval("#pickerConfirm", e => e.click());
    for (const p of [alice, benoit]) await p.waitForSelector("#bindingsPanel[open]");
    await alice.select('[aria-label="Ma configuration pour ce jeu"]', "1");
    await benoit.select('[aria-label="Ma configuration pour ce jeu"]', "0");
    await button(alice, "Je suis prêt");
    await button(benoit, "Je suis prêt");
    await alice.waitForFunction(() => !document.querySelector("#launchPrepared").disabled);
    await button(alice, "Lancer le jeu");
    await until(() => generation === 4, "Le jeu ne démarre pas depuis le repos");
    for (const p of [alice, benoit, camille]) {
      const frames = await p.evaluate(() => nel3abTest.counters().painted);
      await p.waitForFunction(n => nel3abTest.counters().painted > n + 10, {timeout: 60000}, frames);
      await p.waitForSelector("#booting", {hidden: true});
      assert.equal(await p.$("#menu"), null);
    }
    assert.equal((await readFile(join(env.NEL3AB_SESSION_DIR, "chosen-setup"), "utf8")).split("\n")[0], "1 0 1 1");

    if (gcRom) {
      await closeGame();
      await until(async () => (await room()).game === null, "La deuxième fermeture ne termine pas");
      await alice.waitForSelector("#item-shelf-gc");
      const nextGame = (await room()).library.find(g => g.console === "gc" && /Melee/i.test(g.name));
      assert.ok(nextGame, "Le disque GameCube Melee doit être dans la bibliothèque");
      await alice.$eval("#item-shelf-gc", e => e.click());
      await alice.$eval(`#item-game${nextGame.index}`, e => e.click());
      await alice.$eval("#pickerConfirm", e => e.click());
      await until(() => generation === 6, "Le lancement GameCube depuis le repos n'arrive pas");
      await until(async () => (await room()).game?.index === nextGame.index, "Le mauvais jeu a démarré");
      for (const p of [alice, benoit]) {
        const frames = await p.evaluate(() => nel3abTest.counters().painted);
        await p.waitForFunction(n => nel3abTest.counters().painted > n + 10 && window.actualDevice === 0, {timeout:60000}, frames);
        assert.equal(await p.$("#bindingsPanel"), null, "Pas de préparation Wii pour GameCube");
      }
      console.log("PASS · second arrêt et lancement GameCube depuis une salle sans jeu, deux manettes GameCube réaffirmées.");
    }
    console.log("PASS · chef spectateur, refus aux autres, fermeture sans Dolphin, repos persistant, nouvel arrivant et préparation Wii depuis le repos.");
  } else {
    // La préparation a une arrivée volontairement ordonnée : Alice lance. Le
    // scénario de migration redémarre le salon, dont le nouveau chef dépend de
    // l'ordre des reconnexions. Il ne doit pas parier que ce sera encore Alice.
    await until(async () => JSON.stringify(await names()) === '["Alice","Benoit",null,null]', "Noms initiaux incorrects");
    await until(() => camille.$eval('[aria-label="spectateurs"]', (e) => e.textContent.includes("Camille")), "Spectateur absent");
    assert.equal(await alice.$$eval('#port1 [aria-label="chef de la salle"]', (xs) => xs.length), 1);
    await benoit.click("#watchOnly");
    await until(async () => JSON.stringify(await names()) === '["Alice",null,null,null]', "La place quittée garde son nom");
    await camille.waitForFunction(() => !document.querySelector("#port2").textContent.match(/Benoit|occup/i));
    // Le salon reçoit la place libérée avant le prochain relevé React de Benoit.
    await benoit.waitForSelector("#takePad", {visible:true});
    await benoit.click("#takePad");
    await until(async () => JSON.stringify(await names()) === '["Alice","Benoit",null,null]', "La place reprise perd son nom");
    const game = (await room()).game.index;
    const prepare = async () => {
      await alice.$eval("#openMenu", (e) => e.click());
      await alice.waitForSelector(`#item-game${game}`);
      await alice.$eval(`#item-game${game}`, (e) => e.click());
      await alice.waitForSelector("#pickerConfirm");
      await alice.$eval("#pickerConfirm", (e) => e.click());
      for (const p of [alice, benoit]) await p.waitForSelector("#bindingsPanel[open]");
    };
    await prepare();
    const choice = '[aria-label="Ma configuration pour ce jeu"]';
    await alice.select(choice, "1");
    await alice.$eval(".n3-preparation-saved summary", (e) => e.click());
    await alice.type('[aria-label="Nom du nouveau profil de manette"]', "Kart personnel");
    await button(alice, "Enregistrer un nouveau profil");
    await button(alice, "Proposer ce profil pour ce jeu");
    await until(() => alice.evaluate(async () => (await (await fetch("/api/me/bindings")).json()).setups?.["Kart personnel"]?.kind === 1), "Le profil ne rejoint pas le service");
    assert.deepEqual(await benoit.evaluate(() => JSON.parse(localStorage.getItem("nel3ab.setups") ?? "{}")), {});
    // Un nouveau navigateur sous la même identité relit le dossier du service.
    const other = await open("Alice", false);
    assert.equal(await other.evaluate(() => JSON.parse(localStorage.getItem("nel3ab.setups"))["Kart personnel"].kind), 1);
    await other.close();
    await alice.select(choice, "0");
    await button(alice, "Charger");
    assert.equal(await alice.$eval(choice, (e) => e.value), "1");
    await benoit.select(choice, "0");
    await button(alice, "Je suis prêt");
    assert.equal(await alice.$eval("#launchPrepared", (e) => e.disabled), true);
    assert.equal(generation, 1, "Le premier prêt ne doit pas lancer le jeu");
    await button(benoit, "Je suis prêt");
    await alice.waitForFunction(() => !document.querySelector("#launchPrepared").disabled);
    const before = Date.now();
    await button(alice, "Lancer le jeu");
    await until(() => generation === 2, "Le lancement confirmé n'atteint pas le worker");
    await until(async () => JSON.stringify(await names()) === '["Alice","Benoit",null,null]', "Les noms changent de places au redémarrage");
    for (const [p, port, kind] of [[alice, 1, 1], [benoit, 2, 0]]) {
      await p.waitForFunction((port, kind) => nel3abTest.seat() === port && window.actualDevice === kind,
        { timeout: 30000 }, port, kind);
      await p.waitForSelector("#bindingsPanel", { hidden: true });
      const count = await p.evaluate(() => nel3abTest.counters().painted);
      await p.waitForFunction((previous) => nel3abTest.counters().painted > previous + 10, {}, count);
    }
    const setup = await readFile(join(env.NEL3AB_SESSION_DIR, "chosen-setup"), "utf8");
    assert.equal(setup.split("\n")[0], "1 0 1 1");
    const ini = await readFile(join(env.NEL3AB_SESSION_DIR, "Config/Dolphin.ini"), "utf8");
    assert.match(ini, /SIDevice0 = 0/);
    assert.match(ini, /SIDevice1 = 6/);
    console.log(`Lancement vers images revenues chez les deux joueurs : ${Date.now() - before} ms (navigateur automatisé local).`);
    // Le nouveau formulaire doit partir des appareils réels, pas du stockage
    // GameCube du premier chargement. Changer de choix ici ne relance rien.
    await prepare();
    assert.equal(await alice.$eval(choice, (e) => e.value), "1");
    assert.equal(await benoit.$eval(choice, (e) => e.value), "0");
    assert.equal(await alice.$eval('[aria-label="Profil personnel de manette"]', e => e.value), "Kart personnel");
    assert.equal(await alice.$eval(".n3-preparation-saved", e => e.open), true);
    assert.equal(await benoit.$eval('[aria-label="Profil personnel de manette"]', e => e.value), "");
    assert.equal((await room()).preparation.players.some(p => p.ready), false, "Une préférence ne déclare personne prêt");
    assert.equal(await alice.$eval(".n3-game-card details", e => e.open), false);
    await alice.screenshot({ path: join(root, "preparation.png") });
    await button(alice, "Annuler le lancement");
    await alice.waitForSelector("#bindingsPanel", {hidden:true});
    await alice.$eval("#openMenu", e => e.click());
    await alice.waitForSelector("#ray-reglages");
    await alice.$eval("#ray-reglages", e => e.click());
    await alice.$eval("#item-bindings", e => e.click());
    await alice.waitForSelector("#view-profiles");
    assert.equal(await alice.$(".n3-preparation-saved"), null, "Les profils n'éloignent pas les deux dessins");
    await alice.$eval("#view-profiles", e => e.click());
    assert.equal(await alice.$eval('[aria-label="Profil personnel de manette"]', e => e.value), "Kart personnel");
    await button(alice, "Charger");
    assert.match(await alice.$eval(".n3-preparation-saved", e => e.textContent), /chargé/);
    await alice.screenshot({path:join(root, "profils-en-partie.png")});
    assert.equal(generation, 2);
    console.log("PASS · noms, spectateurs, couronne, profils personnels entre navigateurs, préparation collective, Dolphin mixte et reconnexion.");
  }
} finally {
  stopping = true;
  link?.close();
  if (browser) await browser.close();
  // Réveiller puis arrêter ce seul conteneur libère le recvmsg du worker.
  // Le nettoyage doit aussi fonctionner après un essai raté ou un ancien binaire.
  for (const args of [["unpause", container], ["stop", "--time", "8", container]]) {
    await execute("docker", args, { timeout: 12000 }).catch(() => {});
  }
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.all(children.map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await Promise.race([new Promise((done) => child.once("exit", done)), delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }));
  for (const log of logs) log.end();
  for (const server of reservations) if (server.listening) server.close();
}
