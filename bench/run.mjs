// One benchmark run of the whole chain, as it ships.
//
// The decision this supports: did a change to the pipeline make the picture
// arrive sooner, cost less bandwidth, or leave more of the machine free — and is
// the difference bigger than this bench's own noise.
//
// It measures the PRODUCTION artifact: the release worker under systemd, the
// real Dolphin container, the real GPU, a real headless Chrome as the viewer.
// Nothing here is a simulation, which also means nothing here is silent: the run
// restarts the session, so it must not be started while somebody is playing.
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer";

const label = process.argv[2] ?? "baseline";
const WARMUP_S = Number(process.env.BENCH_WARMUP ?? 45);
const MEASURE_S = Number(process.env.BENCH_MEASURE ?? 90);
const URL = process.env.BENCH_URL ?? "http://localhost:8100/";

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── environment, captured before anything is measured ──────────────────────
const environment = {
  when: new Date().toISOString(),
  git: {
    sha: sh("git rev-parse --short HEAD"),
    dirty: sh("git status --porcelain") !== "",
    branch: sh("git rev-parse --abbrev-ref HEAD"),
  },
  machine: {
    cpu: sh("lscpu | grep 'Model name' | head -1 | cut -d: -f2 | xargs"),
    cores: sh("nproc"),
    kernel: sh("uname -r"),
    gpu: sh("lspci | grep -i 'vga\\|display' | head -1 | cut -d: -f3 | xargs"),
  },
  build: {
    worker: "cargo build --release -p nel3ab-worker",
    dolphin: sh("docker image inspect nel3ab/dolphin:dev --format '{{.Id}}' | cut -c1-19"),
    binary_bytes: Number(sh("stat -c%s core/target/release/nel3ab-worker")),
  },
  settings: sh("systemctl show nel3ab-worker -p Environment --value"),
  workload: { warmup_s: WARMUP_S, measure_s: MEASURE_S, url: URL, viewers: 1 },
};

console.log(`banc « ${label} » · ${environment.git.sha}${environment.git.dirty ? " (modifié)" : ""}`);

// ── a cold session, then a warm one ────────────────────────────────────────
sh("sudo systemctl restart nel3ab-worker");
const startedAt = new Date();
for (let i = 0; i < 60; i++) {
  await wait(2000);
  try {
    if (sh(`journalctl -u nel3ab-worker --since '${startedAt.toISOString()}' -o cat | grep -c '"streaming"'`) !== "0") break;
  } catch { /* not yet */ }
}
const ready = new Date();
console.log(`  flux vivant après ${((ready - startedAt) / 1000).toFixed(0)} s · chauffe ${WARMUP_S} s`);

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });

// The bench must OWN the controller, or the input figures belong to whoever else
// has a page open. Three runs were reported before anybody noticed the bench had
// sent zero pad frames and the input latency being compared was some other
// browser's — a load generator has to be verified, not assumed.
await wait(3000);
if (await page.evaluate(() => !document.getElementById("claim").hidden)) {
  await page.click("#claim");
  await wait(2000);
}
const seat = await page.evaluate(() => document.getElementById("seat").textContent);
console.log(`  manette : ${seat}`);
await wait(WARMUP_S * 1000);

// ── the measured window ────────────────────────────────────────────────────
const cpuTicks = (name) => {
  try {
    const pid = sh(`pgrep -x ${name}`).split("\n")[0];
    const stat = sh(`cat /proc/${pid}/stat`).split(") ").at(-1).split(" ");
    // utime and stime, fields 14 and 15 of proc(5), counted from the field after
    // the command name.
    return (Number(stat[11]) + Number(stat[12])) / Number(sh("getconf CLK_TCK"));
  } catch {
    return null;
  }
};

const from = new Date();
const cpuBefore = { worker: cpuTicks("nel3ab-worker"), dolphin: cpuTicks("dolphin-emu-nog") };
const padsSent = () =>
  page.evaluate(
    () => Number((document.getElementById("stats").innerText.match(/pad frames\s+(\d+)/) ?? [])[1] ?? 0),
  );
const before = await page.evaluate(() => globalThis.nel3abTest.counters());
const padsBefore = await padsSent();
await wait(MEASURE_S * 1000);
const after = await page.evaluate(() => globalThis.nel3abTest.counters());
const cpuAfter = { worker: cpuTicks("nel3ab-worker"), dolphin: cpuTicks("dolphin-emu-nog") };
const padFrames = (await padsSent()) - padsBefore;
const elapsed = (new Date() - from) / 1000;
const busy = (a, b) => (a === null || b === null ? null : Number((100 * (b - a) / elapsed).toFixed(1)));
const cpuBusy = {
  worker: busy(cpuBefore.worker, cpuAfter.worker),
  dolphin: busy(cpuBefore.dolphin, cpuAfter.dolphin),
};
const client = {
  ...(await page.evaluate(() => globalThis.nel3abTest.pacing())),
  painted: after.painted - before.painted,
  decoded: after.shown - before.shown,
  stalls: after.stalls - before.stalls,
  restarts: after.restarts - before.restarts,
  stats: await page.evaluate(() => document.getElementById("stats").innerText),
};
await browser.close();

// ── what the server said during that window ────────────────────────────────
const lines = sh(
  `journalctl -u nel3ab-worker --since '${from.toISOString()}' -o cat | grep '"streaming"' || true`,
)
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const windows = lines.map((l) => l.fields);
// The frame rate is counted between the FIRST and LAST report, not over the
// whole wall clock: the first report covers a period that began before the
// window opened, and dividing by the requested duration reported 53 /s for a
// stream the client was painting at 59.9.
const span =
  (new Date(lines.at(-1).timestamp) - new Date(lines[0].timestamp)) / 1000;

if (windows.length < 3) {
  console.log(`ÉCHEC — ${windows.length} fenêtre(s) serveur, la mesure ne vaut rien`);
  process.exit(1);
}

// Each ten-second window is one independent observation of the pipeline. They
// are reported as a range across windows rather than averaged into one number:
// averaging percentiles is exactly what the benchmark skill forbids.
const across = (key) => {
  const values = windows.map((w) => w[key]).filter((v) => typeof v === "number");
  values.sort((a, b) => a - b);
  return { min: values[0], median: values[values.length >> 1], max: values.at(-1), n: values.length };
};
const produced = windows.at(-1).produced - windows[0].produced;

const result = {
  label,
  environment,
  server: {
    windows: windows.length,
    frames: produced,
    fps: span > 0 ? produced / span : 0,
    span_seconds: span,
    dropped: windows.at(-1).dropped - windows[0].dropped,
    waiting_p50_ms: across("waiting_p50_ms"),
    waiting_p95_ms: across("waiting_p95_ms"),
    converting_p50_ms: across("converting_p50_ms"),
    encoding_p50_ms: across("encoding_p50_ms"),
    encoding_p95_ms: across("encoding_p95_ms"),
    encoding_p99_ms: across("encoding_p99_ms"),
    megabits_per_second: across("megabits_per_second"),
    input_to_frame_p50_ms: across("input_to_frame_p50_ms"),
    input_to_frame_p95_ms: across("input_to_frame_p95_ms"),
  },
  input: {
    // Whether THIS bench drove the pad. Without it the input numbers are
    // somebody else's, and the honest report is that they were not measured.
    pad_frames_sent: padFrames,
    seat,
  },
  client,
  cost: {
    // CPU over the MEASURED window. `ps -o %cpu` averages over the process's
    // whole life, which for a session that spent its first seconds compiling
    // shaders is a different question than the one being asked.
    worker_cpu_percent: cpuBusy.worker,
    dolphin_cpu_percent: cpuBusy.dolphin,
    vram_mib: Number(sh("cat /sys/class/drm/card0/device/mem_info_vram_used")) / 1048576,
    gtt_mib: Number(sh("cat /sys/class/drm/card0/device/mem_info_gtt_used")) / 1048576,
  },
  measured_seconds: elapsed,
};

mkdirSync("bench/results", { recursive: true });
const file = `bench/results/${environment.when.replace(/[:.]/g, "-")}-${label}.json`;
writeFileSync(file, JSON.stringify(result, null, 2));

const ms = (m) => `${m.median.toFixed(2)} (${m.min.toFixed(2)}–${m.max.toFixed(2)})`;
console.log(`
  images          ${result.server.frames} sur ${span.toFixed(0)} s · ${result.server.fps.toFixed(2)} /s · ${result.server.dropped} jetées
  attente p50     ${ms(result.server.waiting_p50_ms)} ms
  conversion p50  ${ms(result.server.converting_p50_ms)} ms
  encodage p50    ${ms(result.server.encoding_p50_ms)} ms
  encodage p95    ${ms(result.server.encoding_p95_ms)} ms
  débit           ${ms(result.server.megabits_per_second)} Mbit/s
  manette→image   ${
    padFrames > 0
      ? `p50 ${ms(result.server.input_to_frame_p50_ms)} ms · p95 ${ms(result.server.input_to_frame_p95_ms)} ms · ${padFrames} trames (${(padFrames / elapsed).toFixed(0)} /s)`
      : "NON MESURÉ — la page du banc n'avait pas de manette"
  }
  client          ${client.painted} peintes / ${client.decoded} décodées · marge ${client.slackMs} ms · ${client.stalls} reprises
  coût            worker ${result.cost.worker_cpu_percent} %CPU · dolphin ${result.cost.dolphin_cpu_percent} %CPU · vram ${result.cost.vram_mib.toFixed(0)} Mio
  brut            ${file}`);
