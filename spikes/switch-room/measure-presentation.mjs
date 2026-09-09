// A local source-to-browser measurement, not a remote controller latency claim.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const require = createRequire(new URL("../m3-browser-drive/package.json", import.meta.url));
const puppeteer = require("puppeteer");
const path = process.argv[2];
const url = process.env.SWITCH_TEST_URL ?? "http://127.0.0.1:8310";
assert(["http://127.0.0.1:8310", "http://127.0.0.1:8311"].includes(url));
const count = Number(process.env.SWITCH_BENCH_SAMPLES ?? 12);
assert(Number.isInteger(count) && count >= 12 && count <= 201);
assert(path?.startsWith("/tmp/nel3ab-switch-lab/"));
const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const child = spawn("docker", [
  "exec",
  "-i",
  "nel3ab-switch-ryubing-lab",
  "python3",
  "/probe/presentation-marker.py",
]);
child.stderr.on("data", (b) => process.stderr.write(b));
const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
async function line() {
  const next = await Promise.race([
    lines.next(),
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error("marker timeout")), 5000);
      t.unref();
    }),
  ]);
  assert(!next.done, "marker stopped");
  return JSON.parse(next.value);
}
try {
  assert.equal((await line()).ready, true);
  const page = await browser.newPage();
  const response = await page.goto(url);
  const hash = (b) => createHash("sha256").update(b).digest("hex");
  assert.equal(
    hash(await response.buffer()),
    hash(await readFile(new URL("./bridge/page.html", import.meta.url))),
  );
  await page.click("#watch");
  await page.waitForFunction(() => window.prototypeSession?.getSnapshot().video.painted > 5);
  const results = [];
  for (let i = 0; i < count; i++) {
    const color = i % 2 ? [240, 20, 20] : [20, 20, 240];
    const receiving = page.evaluate(
      (color) =>
        new Promise((resolve, reject) => {
          const until = performance.now() + 3000;
          function tick() {
            const canvas = document.querySelector("canvas");
            const p = canvas.getContext("2d").getImageData(30, 30, 1, 1).data;
            if (color.every((v, i) => Math.abs(v - p[i]) < 30))
              return resolve(performance.timeOrigin + performance.now());
            if (performance.now() > until) return reject(new Error("colour never reached browser"));
            requestAnimationFrame(tick);
          }
          tick();
        }),
      color,
    );
    child.stdin.write(JSON.stringify(color) + "\n");
    const sent = await line(),
      seen = await receiving;
    results.push({ ...sent, seen, ms: seen - sent.before });
    await new Promise((r) => setTimeout(r, 130 + ((i * 37) % 151)));
  }
  const ms = results
    .slice(1)
    .map((x) => x.ms)
    .sort((a, b) => a - b);
  const report = {
    samples: results.slice(1),
    discardedWarmup: results[0],
    p50Ms: ms[Math.floor(ms.length * 0.5)],
    p95Ms: ms[Math.floor(ms.length * 0.95)],
    snapshot: await page.evaluate(() => window.prototypeSession.getSnapshot()),
  };
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ p50Ms: report.p50Ms, p95Ms: report.p95Ms }));
  // Opt-in machine benchmark. A 100 ms median rejects the measured old 114.5 ms
  // path and accepts the 82.6 ms candidate; it is not a hardware-independent CI gate.
  if (process.argv.includes("--check"))
    assert(report.p50Ms < 100, "capture median must stay below 100 ms on this benchmark");
} finally {
  child.stdin.end();
  await browser.close();
}
