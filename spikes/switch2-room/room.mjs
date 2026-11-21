/** A real temporary room, one player and spectators. No installed service. */
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { access, cp, link, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { seedName, enterRoom, watchRoom, seatOf } from "../m3-browser-drive/open.mjs";

const require = createRequire(new URL("../m3-browser-drive/package.json", import.meta.url));
const puppeteer = require("puppeteer");
const execute = promisify(execFile);
const repo = resolve(new URL("../../", import.meta.url).pathname);
assert.ok(process.argv[2], "Give a registered Switch 2 NUP path");
assert.ok(process.env.NEL3AB_TEST_SWITCH2_CONFIG, "A private test configuration is required");
const rom = await realpath(process.argv[2]);
assert.match(rom, /\.nup$/i);
const root = await mkdtemp(join(homedir(), ".local/state/nel3ab/test-switch2-"));
const registration = await readFile(rom + ".nel3ab.json");
assert.ok(registration.length <= 4096, "Registration must remain bounded");
const registered = JSON.parse(registration.toString("utf8"));
assert.equal(registered.console, "switch2");
assert.match(registered.title, /^0400[0-9a-f]{9}000$/i);
assert.ok(typeof registered.name === "string" && registered.name.trim().length > 0);
assert.ok(Buffer.byteLength(registered.name.trim(), "utf8") <= 200);
const title = registered.title.toLowerCase();
await mkdir(join(root, "games"));
const game = join(root, "games", basename(rom));
await link(rom, game);
await writeFile(game + ".nel3ab.json", JSON.stringify({
  console: "switch2", name: registered.name, title,
  about: "Essai isolé, un joueur et des spectateurs.", maker: "Nintendo",
}));
const config = JSON.parse(await readFile(process.env.NEL3AB_TEST_SWITCH2_CONFIG, "utf8"));
config.state = join(root, "state");
await writeFile(join(root, "switch2.json"), JSON.stringify(config));
if (process.env.NEL3AB_TEST_SWITCH2_CHECKPOINT) {
  const nand = join(config.state, title, "neuve/home/.local/share/eden/nand");
  await mkdir(dirname(nand), { recursive: true });
  await cp(await realpath(process.env.NEL3AB_TEST_SWITCH2_CHECKPOINT), nand, { recursive: true });
}
if (process.env.NEL3AB_TEST_SWITCH2_CACHE) {
  const cache = join(config.state, title, "cache", config.revision);
  await mkdir(dirname(cache), { recursive: true });
  await cp(await realpath(process.env.NEL3AB_TEST_SWITCH2_CACHE), cache, { recursive: true });
}
const reservations = await Promise.all([0, 1, 2, 3].map(async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}));
const [door, media, control, lobby] = reservations.map(server => server.address().port);
const url = `http://localhost:${door}/`;
const env = {
  ...process.env,
  NEL3AB_ROM: game, NEL3AB_ROM_DIR: dirname(game),
  NEL3AB_SWITCH2_CONFIG: join(root, "switch2.json"),
  NEL3AB_SWITCH_LOCK: join(root, "switch.lock"),
  NEL3AB_SESSION_DIR: join(root, "session"),
  NEL3AB_PERSONAL_SAVE_ROOT: join(root, "personal-saves"),
  NEL3AB_ART_DIR: join(root, "art"),
  NEL3AB_CONTAINER: basename(root),
  NEL3AB_DOLPHIN: join(repo, "docker/dolphin-in-docker.sh"),
  NEL3AB_DOLPHIN_TOOL: join(repo, "docker/dolphin-tool-in-docker.sh"),
  NEL3AB_BIND: `127.0.0.1:${media}`, NEL3AB_CONTROL_BIND: `127.0.0.1:${control}`,
  NEL3AB_WORKER_URL: `http://127.0.0.1:${media}`,
  NEL3AB_WORKER_CONTROL: `127.0.0.1:${control}`, NEL3AB_WORKER_PUBLIC_URL: "",
  NEL3AB_STATE_FILE: join(root, "people.json"),
  NEL3AB_BINDINGS_FILE: join(root, "bindings.json"),
  NEL3AB_ROOM_BINDINGS_FILE: join(root, "room-bindings.json"),
  NEL3AB_JOURNAL_DIR: join(root, "journal"),
  NEL3AB_ADMIN: "", NEL3AB_ROOM_NAME: "Essai Switch 2 isolé",
  NEL3AB_ORIGINS: JSON.stringify([new URL(url).origin]), NEL3AB_PLAYERS: "4",
  XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"),
};
const children = [], logs = [], errors = [];
let browser, worker;
let stopping = false, restarting = false, generation = 0;
let interrupted = false;
const interrupt = () => { interrupted = true; void browser?.close(); };
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
const delay = ms => new Promise(done => setTimeout(done, ms));
const start = (command, args, name, cwd = repo) => {
  const log = createWriteStream(join(root, `${name}.log`), { flags: "a" });
  logs.push(log);
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.on("error", error => errors.push(String(error)));
  children.push(child);
  return child;
};
const until = async (predicate, message, timeout = 60000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (interrupted) throw new Error("Temporary room interrupted");
    if (worker && worker.exitCode !== null && !restarting) throw new Error(`Worker exited: ${root}/worker.log`);
    if (await predicate()) return;
    await delay(200);
  }
  throw new Error(message);
};
const boot = () => {
  restarting = false;
  generation++;
  worker = start(join(repo, "core/target/debug/nel3ab-worker"), [], "worker");
  worker.on("exit", code => {
    if (stopping || code !== 0 || generation >= 8) return;
    restarting = true;
    setTimeout(() => { if (!stopping) boot(); }, 500);
  });
};

try {
  await mkdir(env.NEL3AB_SESSION_DIR);
  await mkdir(env.NEL3AB_ART_DIR);
  await writeFile(join(root, "Caddyfile"), `{
 admin off
 persist_config off
 auto_https off
 storage file_system {
  root ${root}/tls
 }
}
http://localhost:${door} {
 bind 127.0.0.1
 handle /api/* {
  reverse_proxy 127.0.0.1:${lobby}
 }
 handle /socket.io/* {
  reverse_proxy 127.0.0.1:${lobby}
 }
 handle {
  reverse_proxy 127.0.0.1:${media}
 }
}
`);
  await Promise.all(reservations.map(server => new Promise(done => server.close(done))));
  start("caddy", ["run", "--config", join(root, "Caddyfile"), "--adapter", "caddyfile"], "proxy");
  start(join(repo, "control/.venv/bin/python"), ["-m", "uvicorn", "lobby:app",
    "--app-dir", join(repo, "spikes/switch2-room"),
    "--host", "127.0.0.1", "--port", String(lobby)], "lobby", join(repo, "control"));
  boot();
  let catalogue;
  await until(async () => {
    catalogue = await fetch(new URL("roms", url)).then(response => response.json()).catch(() => null);
    return catalogue !== null;
  }, "No catalogue from the temporary worker");
  assert.equal(catalogue.players, 1);
  assert.equal(catalogue.roms.length, 1);
  assert.equal(catalogue.roms[0].console, "switch2");
  const room = async () => fetch(new URL("api/room", url))
    .then(response => response.ok ? response.json() : null).catch(() => null);
  await until(async () => (await room())?.game?.console === "switch2", "Lobby does not describe the private Switch 2 worker");
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  assert.equal(digest(Buffer.from(await (await fetch(url)).arrayBuffer())),
    digest(await readFile(join(repo, "core/crates/worker/src/page/index.html"))));
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
  const open = async (name, play) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(String(error)));
    await page.setViewport({ width: 1440, height: 1000 });
    await seedName(page, name);
    await page.setExtraHTTPHeaders({ "Tailscale-User-Login": `${name}@example.test` });
    await page.goto(url);
    await (play ? enterRoom(page) : watchRoom(page));
    await page.waitForFunction(() => globalThis.nel3abTest.counters().painted > 10, { timeout: 120000 });
    return page;
  };
  const player = await open("joueur", true);
  await until(async () => (await seatOf(player)) === 1, "Player did not receive seat one");
  const spectator = await open("spectateur", false);
  assert.equal(await seatOf(spectator), null);
  const refused = await open("deuxieme", false);
  const refusedSocket = await refused.evaluate(() => new Promise((resolve, reject) => {
    const target = new URL("input?identity=1&prefer=2", location.href);
    target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(target);
    socket.binaryType = "arraybuffer";
    let reply = null;
    const timer = setTimeout(() => { socket.close(); reject(new Error("No refusal close handshake")); }, 5000);
    socket.onmessage = event => { if (event.data instanceof ArrayBuffer) reply = Array.from(new Uint8Array(event.data)); };
    socket.onclose = () => { clearTimeout(timer); resolve({ reply, closed: socket.readyState === WebSocket.CLOSED }); };
    socket.onerror = () => { clearTimeout(timer); reject(new Error("Refusal probe socket error")); };
  }));
  assert.deepEqual(refusedSocket.reply?.slice(0, 2), [1, 0]);
  assert.equal(refusedSocket.closed, true);
  assert.equal(await seatOf(refused), null, "A second player entered the one-player prototype");
  await until(async () => {
    const state = await room();
    return state.seats.length === 1 && state.seats[0].player === "joueur" && state.people.some(person => person.name === "spectateur" && person.seat === null && person.seat_pending === false);
  }, "The lobby did not observe the actual player and spectator");
  await player.screenshot({ path: join(root, "player.png") });
  await spectator.screenshot({ path: join(root, "spectator.png") });
  assert.deepEqual(errors, []);
  await writeFile(join(root, "browser.json"), JSON.stringify({
    root, url, endpoint: browser.wsEndpoint(), state: config.state, title,
  }));
  console.log(JSON.stringify({ basic_room_passed: true, root, url, errors }));
  // Opt-in manual observations of the GAME, after the automated assertions.
  // The thirty-minute ceiling only cleans up an abandoned local driver.
  if (process.env.NEL3AB_TEST_HOLD === "1") {
    const end = Date.now() + 30 * 60 * 1000;
    while (Date.now() < end && !interrupted) {
      if (await access(join(root, "finish")).then(() => true, () => false)) break;
      if (!restarting) assert.equal(worker.exitCode, null);
      await delay(500);
    }
  }
} finally {
  stopping = true;
  await browser?.close();
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null || !child.pid) continue;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
  for (const log of logs) log.end();
  const containers = (await execute("docker", ["ps", "-aq", "--filter",
    `label=nel3ab.room-root=${env.NEL3AB_SESSION_DIR}`])).stdout.trim().split(/\s+/).filter(Boolean);
  assert.deepEqual(containers, [], "The temporary room left a producer or virtual controller alive");
}
