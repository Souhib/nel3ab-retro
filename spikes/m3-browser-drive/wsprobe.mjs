import puppeteer from "puppeteer";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"], acceptInsecureCerts: true });
const page = await browser.newPage();
await page.goto("https://lgf.tail3bd01c.ts.net:8443/", { waitUntil: "domcontentloaded" });
await page.evaluate(() => new Promise((done) => {
  const socket = new WebSocket("wss://lgf.tail3bd01c.ts.net:8443/wstest");
  socket.onopen = () => { socket.close(); done("ouverte"); };
  socket.onerror = () => done("erreur");
  setTimeout(() => done("délai"), 5000);
})).then((r) => console.log("handshake:", r));
await browser.close();
