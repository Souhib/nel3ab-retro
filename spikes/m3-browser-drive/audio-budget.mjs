// Where the audio latency goes, on the client's side of the wire.
//
// The server side is measurable from the server; this half is not. What the page
// adds is the chunk it waits for, the lead it schedules with, and whatever the
// browser's own output costs — and only the page can report the last one.
//
// Needs the worker RUNNING. Autoplay is forced, which is the only thing this
// fakes: a person clicks the button instead.
import puppeteer from "puppeteer";

const url = process.argv[2] ?? "http://localhost:8100/";
const seconds = Number(process.argv[3] ?? 30);

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
await page.goto(url, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 2500));
await page.click("#sound");

// Long enough for the lead to settle: it decays one millisecond per clean
// second, so a short look reports the value it STARTED at rather than the one it
// lives at.
await new Promise((r) => setTimeout(r, seconds * 1000));

const out = await page.evaluate(() => {
  const text = document.getElementById("stats").innerText;
  const line = (name) => (text.match(new RegExp(`${name}\\s+(.+)`)) ?? [])[1] ?? "—";
  return {
    gap: line("écart son/image"),
    sound: line("son"),
    audio: globalThis.nel3abTest?.audio?.() ?? {},
  };
});
await browser.close();

console.log(`  écart son/image : ${out.gap}`);
console.log(`  son             : ${out.sound}`);
const ms = (v) => (v === null || v === undefined ? "—" : `${(v * 1000).toFixed(1)} ms`);
const a = out.audio;
console.log(`\n  le budget, poste par poste :`);
console.log(`    morceau attendu  : ${a.chunkMs === null ? "—" : a.chunkMs.toFixed(1) + " ms"}`);
console.log(`    avance de la page: ${ms(a.soundLead)}   (coupures : ${a.gaps})`);
console.log(`    sortie navigateur: ${ms(a.outputLatency)}  dont ${ms(a.baseLatency)} à la page`);
console.log(`    fréquence        : ${a.sampleRate} Hz`);
console.log(
  "\n  Le tuyau du serveur EST compté : le worker date ses morceaux de sa\n" +
  "  profondeur, sans quoi le son se déclarait plus frais qu'il n'est et la\n" +
  "  case « caler l'image sur le son » compensait 7 ms au lieu de 54.",
);
