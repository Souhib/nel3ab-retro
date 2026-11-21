/** Real idle worker and browser, four consoles, private save receipts. No game boots. */
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import puppeteer from "puppeteer";
import { seedName } from "./open.mjs";

const execute = promisify(execFile);
// Node 22's fetch parser aborted on the room's closing response in the first
// attempt. Keep that failure log; read and verify the complete identity body.
const read = url => new Promise((accept, reject) => {
  get(url, { headers: { "accept-encoding": "identity", connection: "close" } }, response => {
    const chunks = [];
    response.on("data", chunk => chunks.push(chunk));
    response.on("error", reject);
    response.on("end", () => {
      try {
        assert.equal(response.statusCode, 200);
        const body = Buffer.concat(chunks);
        assert.equal(body.length, Number(response.headers["content-length"]));
        accept(body);
      } catch (error) { reject(error); }
    });
  }).on("error", reject);
});
const json = async url => JSON.parse((await read(url)).toString("utf8"));
const repo = resolve(new URL("../../", import.meta.url).pathname);
const root = await mkdtemp(join(tmpdir(), "nel3ab-save-options-"));
const session = join(root, "session");
const games = join(root, "games");
await mkdir(session); await mkdir(games);
await mkdir(join(root, "art"));
// A persisted unlocked request must be refused if its payload disappeared.
await writeFile(join(session, "chosen-save"), "1");
const fixtures = [
  { code: "gc", file: "Fixture GameCube.iso", name: "Fixture GameCube" },
  { code: "wii", file: "Fixture Wii.iso", name: "Fixture Wii" },
  { code: "switch", file: "Fixture Switch.xci", name: "Fixture Switch", title: "0100152000022000" },
  { code: "switch2", file: "Fixture Switch2.nup", name: "Fixture Switch2", title: "0400486024dec000" },
];
const tool = join(root, "dolphin-tool");
await writeFile(tool, '#!/usr/bin/env python3\nimport sys\nif sys.argv[1] != "header":sys.exit(1)\nprint("Title ID: 00010000524d4350" if "Wii" in sys.argv[-1] else "Game ID: GXXP01")\n');
await chmod(tool, 0o755);
for (const fixture of fixtures) {
  await writeFile(join(games, fixture.file), "private catalogue fixture, never executed");
  if (fixture.title) await writeFile(join(games, fixture.file) + ".nel3ab.json", JSON.stringify({ console: fixture.code, name: fixture.name, title: fixture.title }));
  const key = fixture.file.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  fixture.slot = fixture.title ? join(root, fixture.code, fixture.title, "debloquee") : join(session, "saves", key, "debloquee");
  await mkdir(fixture.slot, { recursive: true });
  await writeFile(join(fixture.slot, "progress.fixture"), "declared complete fixture");
  await execute("python3", [join(repo, "tools/save-unlocked.py"), fixture.slot, "progress.fixture", "--source", "private UI fixture, not a playable game save"]);
}
for (const code of ["switch", "switch2"]) await writeFile(join(root, `${code}.json`), JSON.stringify({ state: join(root, code) }));
await rm(join(fixtures[0].slot, "progress.fixture"));
const reservations = await Promise.all([0, 1].map(async () => {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening"); return server;
}));
const [port, control] = reservations.map(server => server.address().port);
await Promise.all(reservations.map(server => new Promise(done => server.close(done))));
const log = createWriteStream(join(root, "worker.log"));
const worker = spawn(join(repo, "core/target/debug/nel3ab-worker"), [], {
  cwd: repo,
  env: { ...process.env, NEL3AB_ROM: join(games, fixtures[0].file), NEL3AB_ROM_DIR: games,
    NEL3AB_SESSION_DIR: session, NEL3AB_PERSONAL_SAVE_ROOT: join(root, "personal"),
    NEL3AB_ART_DIR: join(root, "art"), NEL3AB_DOLPHIN_TOOL: tool,
    NEL3AB_DOLPHIN: "/bin/false", NEL3AB_CONTAINER: `nel3ab-save-options-${process.pid}`,
    NEL3AB_SWITCH_CONFIG: join(root, "switch.json"), NEL3AB_SWITCH2_CONFIG: join(root, "switch2.json"),
    NEL3AB_SWITCH_LOCK: join(root, "switch.lock"),
    NEL3AB_BIND: `127.0.0.1:${port}`, NEL3AB_CONTROL_BIND: `127.0.0.1:${control}` },
  stdio: ["ignore", "pipe", "pipe"],
});
worker.stdout.pipe(log); worker.stderr.pipe(log);
const url = `http://127.0.0.1:${port}/`;
let browser;
try {
  let catalogue;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    catalogue = await json(new URL("roms", url)).catch(() => null);
    if (catalogue) break;
    assert.equal(worker.exitCode, null);
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(catalogue); assert.equal(catalogue.current, null);
  assert.equal((await readFile(join(session, "game-closed"))).length, 0);
  assert.deepEqual(await json(new URL("saves", url)), [false, true, true, true]);
  await writeFile(join(fixtures[0].slot, "progress.fixture"), "declared complete fixture");
  for (const fixture of fixtures) {
    fixture.index = catalogue.roms.findIndex(game => game.console === fixture.code && game.name === fixture.name);
    assert.ok(fixture.index >= 0, `Missing ${fixture.code} fixture`);
  }
  assert.deepEqual(await read(url), await readFile(join(repo, "core/crates/worker/src/page/index.html")), "Worker serves an old page");
  assert.deepEqual(await json(new URL("saves", url)), [true, true, true, true]);
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.setViewport({ width: 1440, height: 1000 });
  await seedName(page, "save-options");
  await page.setRequestInterception(true);
  let holdSaves = false, heldSaves = null;
  let identityAvailable = false, holdIdentity = false, heldIdentity = null;
  let identityRequests = 0;
  const identityBody = () => JSON.stringify(identityAvailable
    ? { name: "same nickname", login: "fixture@example.com", publishes: false }
    : { name: "", login: null, publishes: false });
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/saves" && holdSaves) { heldSaves = request; return; }
    if (new URL(request.url()).pathname === "/api/me") {
      identityRequests++;
      if (holdIdentity) { assert.equal(heldIdentity, null); heldIdentity = request; return; }
      return void request.respond({ status: 200, contentType: "application/json", body: identityBody() });
    }
    void request.continue();
  });
  const checks = [];
  await page.goto(url); await page.waitForSelector("#enter"); await page.click("#enter");
  const gc = fixtures.find(fixture => fixture.code === "gc");
  await page.waitForSelector("#item-shelf-gc");
  await page.$eval("#item-shelf-gc", node => node.click());
  await page.waitForFunction(index => {
    const node = document.getElementById(`item-game${index}`); return node && !node.disabled;
  }, {}, gc.index);
  await page.$eval(`#item-game${gc.index}`, node => node.click());
  await page.waitForSelector("#picker");
  assert.ok(await page.$("#pick-0"));
  assert.equal(await page.$("#pick-2"), null, "A nickname alone offered a personal save");
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.click("#closeMenu"); await page.waitForSelector("#closeMenu", { hidden: true });
  const previousIdentityRequests = identityRequests;
  identityAvailable = true; holdIdentity = true;
  await page.keyboard.press("Escape"); await page.waitForSelector("#item-shelf-gc");
  const identityDeadline = Date.now() + 5000;
  while (!heldIdentity && Date.now() < identityDeadline) await new Promise(done => setTimeout(done, 20));
  assert.ok(heldIdentity, "Menu did not refresh the missing identity");
  assert.ok(identityRequests > previousIdentityRequests);
  await page.$eval("#item-shelf-gc", node => node.click());
  assert.equal(await page.$eval(`#item-game${gc.index}`, node => node.disabled), true,
    "Save choices are interactive while the account is being checked");
  await page.$eval(`#item-game${gc.index}`, node => node.click());
  assert.equal(await page.$("#picker"), null, "Pending identity opened a changing save selection");
  holdIdentity = false;
  await heldIdentity.respond({ status: 200, contentType: "application/json", body: identityBody() });
  heldIdentity = null;
  await page.waitForSelector("#item-shelf-gc");
  // Receiving the real identity can also load its controller settings and remount the room.
  await page.$eval("#item-shelf-gc", node => node.click());
  await page.waitForFunction(index => {
    const node = document.getElementById(`item-game${index}`); return node && !node.disabled;
  }, {}, gc.index);
  await page.$eval(`#item-game${gc.index}`, node => node.click());
  await page.waitForSelector("#pick-2");
  assert.match(await page.$eval("#pick-2", node => node.textContent), /reprendre/);
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  for (const present of [true, false]) {
    if (!present) {
      for (const fixture of fixtures) await rm(join(fixture.slot, "progress.fixture"));
      await page.click("#closeMenu");
      await page.waitForSelector("#closeMenu", { hidden: true });
      holdSaves = true;
      await page.keyboard.press("Escape");
      await page.waitForSelector("#item-shelf-gc");
      const deadline = Date.now() + 5000;
      while (!heldSaves && Date.now() < deadline) await new Promise(done => setTimeout(done, 20));
      assert.ok(heldSaves, "No catalogue request when reopening the menu");
      await page.$eval("#item-shelf-gc", node => node.click());
      const gc = fixtures.find(fixture => fixture.code === "gc");
      assert.equal(await page.$eval(`#item-game${gc.index}`, node => node.disabled), true, "Old choices are interactive while the refreshed catalogue is pending");
      await page.$eval(`#item-game${gc.index}`, node => node.click());
      assert.equal(await page.$("#picker"), null, "A pending catalogue opened a changing selection");
      await page.keyboard.press("Escape");
      holdSaves = false; await heldSaves.continue(); heldSaves = null;
    }
    assert.deepEqual(await json(new URL("saves", url)), fixtures.map(() => present));
    for (const fixture of fixtures) {
      await page.waitForSelector(`#item-shelf-${fixture.code}`);
      await page.$eval(`#item-shelf-${fixture.code}`, node => node.click());
      await page.waitForFunction(index => {
        const node = document.getElementById(`item-game${index}`); return node && !node.disabled;
      }, {}, fixture.index);
      await page.$eval(`#item-game${fixture.index}`, node => node.click());
      await page.waitForSelector("#picker");
      assert.equal(await page.$("#pick-1") !== null, present, fixture.code);
      assert.ok(await page.$("#pick-0")); assert.ok(await page.$("#pick-2"));
      assert.match(await page.$eval("#pick-2", node => node.textContent), /reprendre/);
      checks.push({ console: fixture.code, importedPayloadPresent: present, unlockedOffered: present });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    }
  }
  assert.deepEqual(errors, []);
  assert.equal((await json(new URL("roms", url))).current, null, "The driver booted a game");
  await writeFile(join(root, "report.json"), JSON.stringify({ checks, missingIdentityRefreshedOnMenu: true,
    saveChoicesWaitForIdentity: true, nicknameAloneNeverOffersResume: true,
    refreshedMenuWaitsForCatalogue: true, noGameStarted: true,
    scope: "Real idle worker, Python receipts, browser choices; synthetic payloads do not prove game unlocks or the original user session's cause." }, null, 2));
  console.log("PASS: receipt/payload detection and personal resume in all four console menus", root);
} finally {
  await browser?.close();
  if (worker.exitCode === null) { worker.kill("SIGTERM"); await once(worker, "exit"); }
  log.end();
}
