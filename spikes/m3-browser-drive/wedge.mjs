// Breaks the decoder mid-stream and asks whether the page comes back.
//
// The failure this pins was seen in the wild: the sockets stayed up, the server
// kept writing 60 frames a second with nothing dropped, the page kept sending
// pad frames — and the picture stopped. Bytes arriving is what the silence
// watchdog watches, so a decoder that has died while the socket lives is
// invisible to it.
//
// `VideoDecoder.close()` leaves the object present and throwing on every
// `decode()`, which is exactly what a decoder error leaves behind.
import puppeteer from "puppeteer";

const url = process.argv[2] ?? "http://localhost:8100/";
const RECOVER_WITHIN = Number(process.argv[3] ?? 6) * 1000;

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 700 });
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

const counters = () => page.evaluate(() => globalThis.nel3abTest.counters());
const waitFor = async (predicate, within, what) => {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (predicate(await counters())) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`timed out waiting for ${what}`);
  return false;
};

// Assert the precondition rather than branch on it: a page that never painted
// would make the recovery below pass without proving anything.
if (!(await waitFor((c) => c.painted > 30, 15000, "the stream to be healthy"))) {
  console.log("FAIL — the stream never started, so nothing was tested");
  await browser.close();
  process.exit(1);
}

// Two deaths, two recovery paths. The loud one is caught by the decode call
// itself; the quiet one — chunks accepted, nothing produced — can only be seen
// by watching for the absence of output, so a test that only breaks it loudly
// would leave the watchdog unproven.
const deaths = [
  ["wedged (every decode throws)", "wedgeDecoder"],
  ["stalled (chunks swallowed, nothing produced)", "stallDecoder"],
];

let failures = 0;
for (const [what, how] of deaths) {
  const before = await counters();
  console.log(`\nhealthy: ${before.painted} painted, ${before.shown} decoded`);
  await page.evaluate((name) => globalThis.nel3abTest[name](), how);
  console.log(`decoder ${what}`);

  // 60 more paints is a second of moving picture — not one lucky frame.
  const recovered = await waitFor(
    (c) => c.painted > before.painted + 60,
    RECOVER_WITHIN,
    "the picture to come back",
  );
  const after = await counters();
  console.log(
    `after at most ${RECOVER_WITHIN / 1000}s: ${after.painted} painted ` +
      `(+${after.painted - before.painted}), ${after.restarts} decoder restart(s)`,
  );
  console.log(recovered ? "PASS — the page recovered on its own" : "FAIL — the page stayed frozen");
  if (!recovered) failures += 1;
}

await page.screenshot({ path: process.env.SHOT ?? "wedge.png" });
await browser.close();
process.exit(failures === 0 ? 0 : 1);
