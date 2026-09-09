// Browser checks for the page offered to a player. No production room endpoint.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const require = createRequire(new URL("../m3-browser-drive/package.json", import.meta.url));
const { default: puppeteer } = await import(require.resolve("puppeteer"));
const url = process.env.SWITCH_TEST_URL ?? "http://127.0.0.1:8310";
assert(["http://127.0.0.1:8310", "https://lgf.tail3bd01c.ts.net:8445"].includes(url));
const hash = (x) => createHash("sha256").update(x).digest("hex");
const expected = await readFile(new URL("./bridge/page.html", import.meta.url));
const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1100 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    window.testPad = {
      id: "Xbox Wireless Controller",
      mapping: "standard",
      index: 0,
      connected: true,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    navigator.getGamepads = () => [window.testPad];
  });
  const response = await page.goto(url);
  assert.equal(
    hash(await response.buffer()),
    hash(expected),
    "Served page must match the rebuilt prototype",
  );
  await page.click("#watch");
  await page.waitForFunction(() => window.prototypeSession?.getSnapshot().video.painted > 10);
  assert.equal(await page.evaluate(() => window.prototypeSession.getSnapshot().input.port), null);
  await page.click("#play");
  await page.click("#setup-confirm");
  await page.waitForFunction(() => window.prototypeSession?.getSnapshot().input.port !== null);
  assert.match(await page.$eval("#seat", (e) => e.textContent), /^Joueur [1-4]$/);
  await page.waitForFunction(() =>
    document.querySelector("#notice").textContent.includes("Manette détectée"),
  );
  await page.waitForFunction(() => document.querySelector("#notice").textContent === "", {
    timeout: 10000,
  });
  assert.equal(await page.$eval("details", (e) => e.open), false);
  await page.click("#half");
  await page.waitForFunction(
    () => window.prototypeSession.getSnapshot().video.picture?.width === 640,
  );
  await page.click("#full");
  await page.waitForFunction(
    () => window.prototypeSession.getSnapshot().video.picture?.width === 1280,
  );
  await page.$eval("#volume", (e) => {
    e.value = "0";
    e.dispatchEvent(new Event("input"));
  });
  await page.waitForFunction(() => window.prototypeSession.getSnapshot().sound.gain === 0);
  await page.screenshot({ path: "/tmp/nel3ab-switch-lab/test-page.png", fullPage: true });
  await page.click("#leave");
  assert.equal(await page.evaluate(() => window.prototypeSession), undefined);
  assert.equal(await page.$eval("#seat", (e) => e.textContent), "Pas connecté");
  await page.click("#watch");
  await page.waitForFunction(() => window.prototypeSession?.getSnapshot().video.painted > 10);
  assert.equal(await page.evaluate(() => window.prototypeSession.getSnapshot().input.port), null);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      url,
      html: hash(expected),
      play: true,
      watch: true,
      leave: true,
      half: true,
      volume: true,
      notificationExpired: true,
      pageErrors: errors,
    }),
  );
} finally {
  await browser.close();
}
