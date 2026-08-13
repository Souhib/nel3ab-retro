// Switches away from a playing page, waits, and comes back.
//
// This is the failure the user saw and I did not: a tab that is not the front
// one gets no `requestAnimationFrame`, so nothing paints — while access units
// keep arriving and keep being fed to a decoder nobody is draining. Measured on
// a real tab: four frames painted in three minutes, a decoder backlog of 1564
// chunks and a stream 23 seconds behind. Coming back could never recover.
//
// A second page is what makes the first one hidden, which is exactly how a
// person does it.
import puppeteer from "puppeteer";

const url = process.argv[2] ?? "http://localhost:8100/";
const away = Number(process.argv[3] ?? 30) * 1000;

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

const state = () =>
  page.evaluate(() => ({
    ...globalThis.nel3abTest.counters(),
    hidden: document.hidden,
    backlog: globalThis.nel3abTest.backlog(),
  }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const healthy = async (what) => {
  for (let i = 0; i < 60; i++) {
    const now = await state();
    if (now.painted > 30) return now;
    await wait(250);
  }
  console.log(`FAIL — ${what}`);
  await browser.close();
  process.exit(1);
};

const playing = await healthy("the stream never started, so nothing was tested");
console.log(`playing: ${playing.painted} painted, backlog ${playing.backlog}`);

// Somebody opens another tab. Ours is now the back one.
const other = await browser.newPage();
await other.goto("about:blank");
await other.bringToFront();
await wait(1000);
console.log(`hidden: ${(await state()).hidden}`);
await wait(away);

const behind = await state();
const decodedWhileAway = behind.shown - playing.shown;
console.log(
  `after ${away / 1000}s away: ${decodedWhileAway} access units decoded, ` +
    `${behind.undecoded - playing.undecoded} skipped, backlog ${behind.backlog}`,
);

await page.bringToFront();
const before = await state();
const deadline = Date.now() + 8000;
let back = null;
while (Date.now() < deadline) {
  const now = await state();
  if (now.painted > before.painted + 60) {
    back = now;
    break;
  }
  await wait(200);
}
const resumed = back !== null;
console.log(
  `back in front: ${resumed ? `painting again (+${back.painted - before.painted})` : "STILL FROZEN"}`,
);

// THE assertion, and it is not about the backlog. A fast enough decoder keeps
// up with work nobody wanted and shows no backlog at all — this machine does
// exactly that, so a test that watched the queue could not fail here. What is
// true on every machine is the rule itself: what nobody paints is not decoded.
// One second of grace, because the switch away is not instantaneous.
const idle = decodedWhileAway < 60;
console.log(
  idle && resumed
    ? `PASS — nothing was decoded for a screen that was not asking, and the picture came back`
    : !idle
      ? `FAIL — ${decodedWhileAway} access units were decoded for nobody`
      : `FAIL — nothing was decoded, but the picture never came back`,
);
await browser.close();
process.exit(idle && resumed ? 0 : 1);
