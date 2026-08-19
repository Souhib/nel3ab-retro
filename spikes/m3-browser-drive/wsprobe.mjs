import { ROOM_URL } from "./open.mjs";
import puppeteer from "puppeteer";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"], acceptInsecureCerts: true });
const page = await browser.newPage();
await page.goto(ROOM_URL, { waitUntil: "domcontentloaded" });
await page.evaluate(() => new Promise((done) => {
  const socket = new WebSocket(`${ROOM_URL.replace(/^http/, "ws").replace(/\/$/, "")}/wstest`);
  socket.onopen = () => { socket.close(); done("ouverte"); };
  socket.onerror = () => done("erreur");
  setTimeout(() => done("délai"), 5000);
})).then((r) => console.log("handshake:", r));
await browser.close();
