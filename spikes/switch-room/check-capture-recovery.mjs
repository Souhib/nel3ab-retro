// Kills only disposable capture children in the isolated Switch prototype.
// The emulator must keep its PID, input place and game; no production endpoint.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const require = createRequire(new URL("../m3-browser-drive/package.json", import.meta.url));
const puppeteer = require("puppeteer");
const docker = (...args) =>
  execFileSync("docker", ["exec", "nel3ab-switch-ryubing-lab", ...args], { encoding: "utf8" });
const rows = () => docker("ps", "-eo", "pid,args").trim().split("\n");
const pid = (text, check) => Number(text.find(check)?.trim().split(/\s+/)[0]);
const recorder = (text, half) =>
  pid(
    text,
    (x) => x.includes("/usr/local/bin/nel3ab-wf-recorder") && x.includes("w=640:h=360") === half,
  );
const engine = (text) =>
  pid(text, (x) => /^\s*\d+\s+\/emulator\/publish\/Ryujinx --no-gui/.test(x));
const capture = (text) => pid(text, (x) => x.includes("python3 /probe/capture.py"));
const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const smallBrowser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
let suspended;
try {
  const page = await browser.newPage(),
    small = await smallBrowser.newPage();
  await page.bringToFront();
  await small.bringToFront();
  const response = await page.goto("http://127.0.0.1:8311");
  const hash = (data) => createHash("sha256").update(data).digest("hex");
  assert.equal(
    hash(await response.buffer()),
    hash(await readFile(new URL("./bridge/page.html", import.meta.url))),
  );
  await page.click("#play");
  await page.click("#setup-confirm");
  await page.waitForFunction(
    () =>
      window.prototypeSession?.getSnapshot().input.port !== null &&
      window.prototypeSession?.getSnapshot().video.painted > 30,
  );
  await small.goto("http://127.0.0.1:8311");
  await small.click("#watch");
  await small.click("#half");
  await small.waitForFunction(
    () => window.prototypeSession?.getSnapshot().video.picture?.width === 640,
  );
  const initial = await page.evaluate(() => window.prototypeSession.getSnapshot());
  const game = engine(rows());
  assert(game > 1);
  const report = [];
  const audioOnly = process.argv.includes("--silent-audio");
  const silent = audioOnly || process.argv.includes("--silent");
  const producer = (state, half) =>
    audioOnly ? pid(state, (x) => /^\s*\d+\s+\/usr\/bin\/parec /.test(x)) : recorder(state, half);
  for (const half of silent ? [false] : [false, true]) {
    const before = rows(),
      victim = producer(before, half),
      oldCapture = capture(before);
    assert(victim > 1 && oldCapture > 1);
    const fullFrames = await page.evaluate(
      () => window.prototypeSession.getSnapshot().video.painted,
    );
    const halfFrames = await small.evaluate(
      () => window.prototypeSession.getSnapshot().video.painted,
    );
    const sound = await page.evaluate(
      () => window.prototypeSession.getSnapshot().sound.playedSeconds,
    );
    const start = performance.now();
    docker("kill", silent ? "-STOP" : "-KILL", String(victim));
    if (silent) suspended = victim;
    if (silent && !audioOnly) {
      await page.waitForFunction(
        () =>
          !document.querySelector("#placeholder").hidden &&
          document.querySelector("#connection").textContent.includes("interrompue"),
        { timeout: 6000 },
      );
    }
    let resumed = false;
    while (performance.now() - start < (silent ? 43000 : 8000)) {
      const state = rows(),
        replacement = producer(state, half);
      const fullShot = await page.evaluate(() => window.prototypeSession.getSnapshot());
      const smallShot = await small.evaluate(() => window.prototypeSession.getSnapshot());
      if (
        replacement > 1 &&
        replacement !== victim &&
        capture(state) !== oldCapture &&
        fullShot.video.painted > fullFrames + 30 &&
        smallShot.video.painted > halfFrames + 30 &&
        fullShot.sound.playedSeconds > sound + 0.5
      ) {
        resumed = true;
        break;
      }
      await delay(100);
    }
    assert(
      resumed,
      `${audioOnly ? "audio" : half ? "half" : "full"} capture must recover without a page reload`,
    );
    assert.equal(
      await page.$eval("#placeholder", (element) => element.hidden),
      true,
      "recovery message clears when images return",
    );
    assert.equal(engine(rows()), game, "capture failure must not restart the game");
    const shot = await page.evaluate(() => window.prototypeSession.getSnapshot());
    assert.equal(shot.input.port, initial.input.port, "input seat must survive capture recovery");
    assert.equal(
      shot.video.reconnects,
      initial.video.reconnects,
      "the bridge keeps its browser socket",
    );
    report.push({
      stream: audioOnly ? "audio" : half ? "half" : "full",
      failure: silent ? "unresponsive" : "crashed",
      resumeMs: performance.now() - start,
      seat: shot.input.port,
      emulatorPid: game,
    });
  }
  console.log(JSON.stringify(report));
} finally {
  // A failed experiment must not leave its disposable child suspended.
  if (
    suspended &&
    rows().some(
      (x) =>
        Number(x.trim().split(/\s+/)[0]) === suspended &&
        (x.includes("/usr/bin/parec") || x.includes("/usr/local/bin/nel3ab-wf-recorder")),
    )
  ) {
    docker("kill", "-CONT", String(suspended));
  }
  await browser.close();
  await smallBrowser.close();
}
