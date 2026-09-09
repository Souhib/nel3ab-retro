// Uses only the private prototype. Verifies the actual recorder processes.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const require = createRequire(new URL("../m3-browser-drive/package.json", import.meta.url));
const puppeteer = require("puppeteer");
const root = process.env.SWITCH_RESULTS_DIR ?? "/tmp/nel3ab-switch-lab/three-latency";
assert(root.startsWith("/tmp/nel3ab-switch-lab/"));
const url = process.env.SWITCH_TEST_URL ?? "http://127.0.0.1:8310";
assert(["http://127.0.0.1:8310", "http://127.0.0.1:8311"].includes(url));
function recorders() {
  return execFileSync("docker", ["exec", "nel3ab-switch-ryubing-lab", "ps", "-eo", "pid,args"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((x) => x.includes("/usr/local/bin/nel3ab-wf-recorder"))
    .map((x) => ({ pid: Number(x.trim().split(/\s+/)[0]), half: x.includes("w=640:h=360") }));
}
async function until(check) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(100);
  }
  assert(check(), "demand never reached the expected recorder state");
}
const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage();
  const response = await page.goto(url);
  const hash = (x) => createHash("sha256").update(x).digest("hex");
  assert.equal(
    hash(await response.buffer()),
    hash(await readFile(new URL("./bridge/page.html", import.meta.url))),
  );
  await page.click("#watch");
  await page.waitForFunction(() => window.prototypeSession?.getSnapshot().video.painted > 30);
  assert.equal(
    recorders().filter((x) => x.half).length,
    0,
    "an unused half recorder must be stopped",
  );
  const fullPid = recorders().find((x) => !x.half)?.pid;
  assert(fullPid);
  const first = await browser.newPage();
  await first.goto(url);
  await first.click("#watch");
  await first.click("#half");
  await first.waitForFunction(
    () => window.prototypeSession?.getSnapshot().video.picture?.width === 640,
  );
  await until(() => recorders().filter((x) => x.half).length === 1);
  const halfPid = recorders().find((x) => x.half).pid;
  const second = await browser.newPage();
  await second.goto(url);
  await second.click("#watch");
  await second.click("#half");
  await second.waitForFunction(
    () => window.prototypeSession?.getSnapshot().video.picture?.width === 640,
  );
  await first.close();
  await delay(300);
  assert.equal(
    recorders().find((x) => x.half)?.pid,
    halfPid,
    "one remaining viewer keeps the same encoder",
  );
  const before = await page.evaluate(() => window.prototypeSession.getSnapshot().video.painted);
  await second.close();
  await until(() => recorders().every((x) => !x.half));
  assert.equal(
    recorders().find((x) => !x.half)?.pid,
    fullPid,
    "demand must not restart the full encoder",
  );
  await page.waitForFunction(
    (before) => window.prototypeSession.getSnapshot().video.painted > before + 30,
    {},
    before,
  );
  await page.click("#half");
  await page.waitForFunction(
    () => window.prototypeSession.getSnapshot().video.picture?.width === 640,
  );
  const restartedPid = recorders().find((x) => x.half)?.pid;
  assert(restartedPid && restartedPid !== halfPid);
  await page.click("#full");
  await page.waitForFunction(
    () => window.prototypeSession.getSnapshot().video.picture?.width === 1280,
  );
  await until(() => recorders().every((x) => !x.half));
  const shot = await page.evaluate(() => window.prototypeSession.getSnapshot());
  assert.equal(shot.video.restarts, 0);
  assert(shot.sound.playedSeconds > 5);
  const report = {
    fullPid,
    halfPid,
    restartedPid,
    unusedStopped: true,
    lastDepartureStopped: true,
    remainingViewerKeptEncoder: true,
    restartedAndDecoded: true,
    shot,
  };
  await writeFile(root + "/demand.json", JSON.stringify(report, null, 2));
  console.log(
    "half starts on demand, survives one departure, stops after the last, restarts cleanly; full stream and audio continue",
  );
} finally {
  await browser.close();
}
