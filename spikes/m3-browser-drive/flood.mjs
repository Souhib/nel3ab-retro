import puppeteer from "puppeteer";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto("http://localhost:8100/", { waitUntil: "domcontentloaded" });
const measure = async (label) => {
  const out = await page.evaluate(async () => {
    const ws = new WebSocket(location.origin.replace(/^http/, "ws") + "/video");
    ws.binaryType = "arraybuffer";
    let bytes = 0, n = 0;
    await new Promise((done) => {
      ws.onmessage = (e) => { if (e.data.byteLength > 8) { bytes += e.data.byteLength; n++; } if (n >= 300) done(); };
      setTimeout(done, 8000);
    });
    ws.close();
    return { bytes, n };
  });
  console.log(`  ${label} : ${(out.bytes / out.n / 1024).toFixed(1)} Kio par image sur ${out.n} images`);
  return out.bytes / out.n;
};
const before = await measure("au repos");
// One socket asking for a key frame as fast as it can.
await page.evaluate(() => {
  const ws = new WebSocket(location.origin.replace(/^http/, "ws") + "/video");
  ws.binaryType = "arraybuffer";
  ws.onopen = () => { globalThis.__flood = setInterval(() => ws.send(new Uint8Array([1])), 2); };
  globalThis.__floodSocket = ws;
});
await new Promise((r) => setTimeout(r, 2000));
const during = await measure("pendant la rafale");
await page.evaluate(() => { clearInterval(globalThis.__flood); globalThis.__floodSocket.close(); });
console.log(`  → ${(during / before).toFixed(1)}× la taille d'image, pour un client qui envoie un octet`);
await browser.close();
