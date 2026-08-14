// Does the PAGE play what it receives, on its own schedule?
//
// Chrome will not start an AudioContext without a gesture, which is the right
// behaviour and makes the page untestable without a flag. The flag is the only
// thing this test fakes; everything below it is the page's own code.
import puppeteer from "puppeteer";
const url = process.argv[2] ?? "http://localhost:8100/";
const seconds = Number(process.argv[3] ?? 12);

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 3000));
await page.click("#sound");
await new Promise((r) => setTimeout(r, 1500));

const read = () =>
  page.evaluate(() => {
    const line = document.getElementById("stats").innerText.match(/son\s+(\w+), (\d+) morceaux, (\d+) coupures/);
    return line ? { state: line[1], chunks: Number(line[2]), gaps: Number(line[3]) } : null;
  });
const before = await read();
await new Promise((r) => setTimeout(r, seconds * 1000));
const after = await read();

if (before === null || after === null) {
  console.log("FAIL — la page ne dit rien de son son");
  await browser.close();
  process.exit(1);
}
const played = after.chunks - before.chunks;
const expected = seconds * 50;
const gaps = after.gaps - before.gaps;
console.log(`  contexte ${after.state} · ${played} morceaux joués en ${seconds}s (attendu ~${expected}) · ${gaps} coupures`);
const paced = played > expected * 0.9 && played < expected * 1.1;
const smooth = gaps <= 1;
console.log(paced && smooth ? "PASS — la page joue au rythme du son" : `FAIL — ${!paced ? "mauvais rythme" : `${gaps} coupures`}`);
await browser.close();
process.exit(paced && smooth ? 0 : 1);
