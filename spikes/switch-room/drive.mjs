// Interactive inspection of a real game in the isolated Switch prototype.
// JSON commands on stdin drive simulated browser pads; screenshots are evidence
// to inspect, not automatic assertions about a match or its frame rate.
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
const require = createRequire(new URL("../m3-browser-drive/package.json", import.meta.url));
const { default: puppeteer } = await import(require.resolve("puppeteer"));
const root = process.env.SWITCH_LAB ?? "/tmp/nel3ab-switch-lab";
const { url } = JSON.parse(await readFile(`${root}/pads/bridge.json`, "utf8"));
assert.equal(new URL(url).hostname, "127.0.0.1");
assert.notEqual(new URL(url).port, "8100");
const browser = await puppeteer.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});
const pages = [];
async function join() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1400, height: 1100 });
  await page.evaluateOnNewDocument(() => {
    window.rumbles = [];
    window.pad = {
      id: "Xbox Wireless Controller",
      mapping: "standard",
      index: 0,
      connected: true,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      axes: [0, 0, 0, 0],
      vibrationActuator: {
        type: "dual-rumble",
        playEffect: async (t, v) => {
          window.rumbles.push(v);
          return "complete";
        },
        reset: async () => "complete",
      },
    };
    navigator.getGamepads = () => [window.pad];
  });
  page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
  await page.goto(url);
  assert.equal(await page.title(), "Prototype Switch nel3ab");
  await page.click("#play");
  await page.click("#setup-confirm");
  await page.waitForFunction(() => window.prototypeSession?.getSnapshot().video.painted > 10, {
    timeout: 20000,
  });
  pages.push(page);
  return page.evaluate(() => ({
    port: window.prototypeSession.getSnapshot().input.port,
    picture: window.prototypeSession.getSnapshot().video.picture,
  }));
}
const input = createInterface({ input: process.stdin });
try {
  console.log(JSON.stringify({ ready: await join() }));
  for await (const line of input) {
    try {
      const command = JSON.parse(line);
      const page = pages[(command.player ?? 1) - 1];
      let result;
      if (command.action === "join") result = await join();
      if (command.action === "press") {
        assert(
          Array.isArray(command.buttons) &&
            command.buttons.every((i) => Number.isInteger(i) && i >= 0 && i < 17),
        );
        assert(
          Number.isInteger(command.count ?? 1) &&
            (command.count ?? 1) >= 1 &&
            (command.count ?? 1) <= 40,
        );
        assert(
          Number.isFinite(command.ms ?? 180) &&
            (command.ms ?? 180) >= 20 &&
            (command.ms ?? 180) <= 2000,
        );
        for (let i = 0; i < (command.count ?? 1); i++) {
          await page.bringToFront();
          await page.evaluate((buttons) => {
            for (const i of buttons)
              window.pad.buttons[i] = { pressed: true, touched: true, value: 1 };
          }, command.buttons);
          await new Promise((r) => setTimeout(r, command.ms ?? 180));
          await page.evaluate(() => {
            for (const b of window.pad.buttons) {
              b.pressed = false;
              b.touched = false;
              b.value = 0;
            }
          });
          await new Promise((r) => setTimeout(r, 120));
        }
        result = "pressed";
      }
      if (command.action === "axis")
        result = await page.evaluate((axes) => {
          window.pad.axes = axes;
          return axes;
        }, command.axes);
      if (command.action === "shot") {
        await page.bringToFront();
        await new Promise((r) => setTimeout(r, command.ms ?? 500));
        const data = await page.evaluate(() => document.querySelector("canvas").toDataURL());
        assert(/^[a-zA-Z0-9_-]+$/.test(command.name ?? "mario-browser"));
        const path = `${root}/${command.name ?? "mario-browser"}.png`;
        await writeFile(path, Buffer.from(data.split(",")[1], "base64"));
        result = path;
      }
      if (command.action === "stats") {
        assert(/^[a-zA-Z0-9_-]+$/.test(command.name ?? "mario-stats"));
        const all = await Promise.all(
          pages.map((p) =>
            p.evaluate(() => ({
              snapshot: window.prototypeSession.getSnapshot(),
              rumble: window.rumbles.length,
            })),
          ),
        );
        await writeFile(
          `${root}/${command.name ?? "mario-stats"}.json`,
          JSON.stringify(all, null, 2),
        );
        result = all.map((x) => ({
          port: x.snapshot.input.port,
          video: x.snapshot.video,
          sound: x.snapshot.sound,
          rumble: x.rumble,
        }));
      }
      if (command.action === "half") {
        await page.click("#half");
        await page.waitForFunction(
          () => window.prototypeSession.getSnapshot().video.picture?.width === 640,
        );
        result = "half";
      }
      if (command.action === "clip") {
        const response = await fetch(`${url}/clip`, { method: "POST", headers: { Origin: url } });
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /^video\/mp4/);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(bytes.toString("ascii", 4, 8), "ftyp");
        await writeFile(`${root}/mario-clip.mp4`, bytes);
        result = { bytes: bytes.length };
      }
      if (command.action === "quit") break;
      assert(
        ["join", "press", "axis", "shot", "stats", "half", "clip"].includes(command.action),
        "Unknown action",
      );
      console.log(JSON.stringify({ at: new Date().toISOString(), action: command.action, result }));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message }));
    }
  }
} finally {
  input.close();
  process.stdin.pause();
  await browser.close();
}
