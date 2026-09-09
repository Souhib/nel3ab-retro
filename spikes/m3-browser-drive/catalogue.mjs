/** Catalogue réel sans lancer de jeu : worker isolé, trois menus, images locales.
 * `just catalogue-test` reconstruit d'abord la page servie par ce worker.
 * Exige Mario Tennis et Looney Tunes inscrits avec leurs jaquettes officielles.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";
import { seedName } from "./open.mjs";

const root = await mkdtemp(join(tmpdir(), "nel3ab-catalogue-"));
const repo = new URL("../../", import.meta.url).pathname;
const reservations = await Promise.all([0, 1].map(async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return server;
}));
const [port, control] = reservations.map(server => server.address().port);
await mkdir(join(root, "session"));
await writeFile(join(root, "session/game-closed"), "");
await cp(join(homedir(), ".cache/nel3ab/banners"), join(root, "art"), { recursive: true });
await Promise.all(reservations.map(server => new Promise(done => server.close(done))));
const log = createWriteStream(join(root, "worker.log"));
const worker = spawn(join(repo, "core/target/debug/nel3ab-worker"), [], {
  cwd: repo,
  env: { ...process.env,
    NEL3AB_ROM: join(homedir(), "roms/switch/Mario Tennis Aces.xci"),
    NEL3AB_ROM_DIR: ["gc", "wii", "switch"].map(c => join(homedir(), "roms", c)).join(":"),
    NEL3AB_BIND: `127.0.0.1:${port}`, NEL3AB_CONTROL_BIND: `127.0.0.1:${control}`,
    NEL3AB_WORKER_CONTROL: `127.0.0.1:${control}`,
    NEL3AB_SESSION_DIR: join(root, "session"), NEL3AB_ART_DIR: join(root, "art"),
    NEL3AB_DOLPHIN_TOOL: join(repo, "docker/dolphin-tool-in-docker.sh"),
  }, stdio: ["ignore", "pipe", "pipe"],
});
worker.stdout.pipe(log); worker.stderr.pipe(log);
const url = `http://127.0.0.1:${port}/`;
let browser;
try {
  let catalogue;
  for (let n = 0; n < 100; n++) {
    catalogue = await fetch(new URL("roms", url)).then(r => r.json()).catch(() => null);
    if (catalogue) break;
    assert.equal(worker.exitCode, null, "Worker exited during catalogue loading");
    await new Promise(done => setTimeout(done, 200));
  }
  assert.ok(catalogue, "No catalogue after 20 seconds");
  assert.equal(catalogue.current, null);
  // Looney Tunes sorts before Mario Tennis (2026-09-09). Match each fixture by
  // title: a new registration must not inherit the first game's expectations.
  const games = [
    { name: "Mario Tennis Aces", maker: "Nintendo", width: 640, height: 360 },
    { name: "Looney Tunes: Wacky World of Sports", maker: "GameMill Entertainment", width: 512, height: 288 },
  ].map(game => {
    const index = catalogue.roms.findIndex(g => g.console === "switch" && g.name === game.name);
    assert.ok(index >= 0, `Missing local fixture: ${game.name}`);
    assert.equal(catalogue.roms[index].art, true);
    assert.equal(catalogue.roms[index].maker, game.maker);
    return { ...game, index };
  });
  const pageBytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  assert.deepEqual(pageBytes, await readFile(join(repo, "core/crates/worker/src/page/index.html")));
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const errors = [];
  for (const shell of ["ps3", "wii", "switch"]) {
    const page = await browser.newPage();
    page.on("pageerror", error => errors.push(String(error)));
    await page.setViewport({ width: 1440, height: 1000 });
    await seedName(page, "catalogue");
    await page.evaluateOnNewDocument(shell => localStorage.setItem("nel3ab:shell", shell), shell);
    await page.goto(url);
    await page.waitForSelector("#watch");
    await page.click("#watch");
    // A closed game has no #screen. Its visible result is the game menu.
    await page.waitForSelector("#item-shelf-switch");
    const shapes = await page.evaluate(() => ["gc", "wii", "switch"].map(c => document.querySelector(`#item-shelf-${c} svg`).innerHTML));
    assert.equal(new Set(shapes).size, 3, "Consoles share a silhouette");
    await page.screenshot({ path: join(root, `${shell}-consoles.png`) });
    await page.$eval("#item-shelf-switch", e => e.click());
    for (const game of games) {
      await page.waitForFunction(({ index, width, height }) => {
        const image = document.querySelector(`img[src="/art/${index}.png"]`);
        return image?.complete && image.naturalWidth === width && image.naturalHeight === height;
      }, {}, game);
      const rendering = await page.$eval(`img[src="/art/${game.index}.png"]`, image => {
        const css = getComputedStyle(image); return [css.objectFit, css.imageRendering];
      });
      assert.deepEqual(rendering, ["contain", "auto"]);
    }
    await page.screenshot({ path: join(root, `${shell}-switch-games.png`) });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log("PASS: distinct consoles, both Switch titles and complete artwork in all three menus", root);
} finally {
  await browser?.close();
  if (worker.exitCode === null) { worker.kill("SIGTERM"); await once(worker, "exit"); }
  log.end();
}
