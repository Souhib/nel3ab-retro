// Does sound arrive, and is it sound rather than silence?
//
// A page cannot play anything before somebody has asked it to, so this reads the
// stream the way the page does and looks at the samples themselves. Whether it
// sounds right is a person's job; what a test can say is that the bytes are real
// audio arriving at the rate they were recorded at.
import puppeteer from "puppeteer";
const url = process.argv[2] ?? "http://localhost:8100/";
const seconds = Number(process.argv[3] ?? 15);

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async (seconds) => {
  const ws = new WebSocket(location.origin.replace(/^http/, "ws") + "/sound");
  ws.binaryType = "arraybuffer";
  let bytes = 0, chunks = 0, peak = 0, loud = 0, first = null, last = null;
  await new Promise((done) => {
    ws.onmessage = (e) => {
      const b = new Uint8Array(e.data);
      if (b.length <= 8) return;
      const stamp = Number(new DataView(e.data).getBigUint64(0, true));
      if (first === null) first = stamp;
      last = stamp;
      bytes += b.length - 8;
      chunks += 1;
      const pcm = new Int16Array(e.data, 8);
      let top = 0;
      for (let i = 0; i < pcm.length; i += 7) top = Math.max(top, Math.abs(pcm[i]));
      peak = Math.max(peak, top);
      if (top > 500) loud += 1;
    };
    setTimeout(done, seconds * 1000);
  });
  ws.close();
  return { bytes, chunks, peak, loud, spanMs: (last - first) / 1000 };
}, seconds);

const rate = out.bytes / (out.spanMs / 1000) / 1024;
console.log(`  ${out.chunks} morceaux · ${(out.bytes / 1024).toFixed(0)} Kio sur ${(out.spanMs / 1000).toFixed(1)} s`);
console.log(`  débit ${rate.toFixed(0)} Kio/s (attendu 187) · amplitude max ${out.peak}/32767 · ${out.loud} morceaux avec du signal`);
const paced = Math.abs(rate - 187.5) < 20;
const audible = out.loud > out.chunks * 0.2;
console.log(paced && audible ? "PASS — du son, au bon rythme" : `FAIL — ${!paced ? "mauvais rythme" : "silence"}`);
await browser.close();
process.exit(paced && audible ? 0 : 1);
