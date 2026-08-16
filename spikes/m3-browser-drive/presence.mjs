// Combien de temps la salle met à oublier quelqu'un qui est parti.
//
// Deux départs différents, et ils ne se ressemblent pas: fermer proprement un
// onglet envoie un paquet de déconnexion, tuer le navigateur n'envoie rien et
// laisse le serveur le découvrir par lui-même.
import puppeteer from "puppeteer";
import { enterRoom } from "./open.mjs";

const api = "http://127.0.0.1:8200/api/room";
const url = "https://lgf.tail3bd01c.ts.net:8443/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const count = async () => (await (await fetch(api)).json()).people.length;

// En RELATIF: quelqu'un peut jouer à côté, et ce qu'on mesure est le temps que
// la salle met à oublier UNE page de plus, pas qu'elle finisse vide.
const before = await count();
console.log(`  ${before} présent(s) avant, on en ajoute une`);

for (const [what, leave] of [
  ["fermeture propre", async (browser, page) => { await page.close(); }],
  ["navigateur tué", async (browser) => { browser.process()?.kill("SIGKILL"); }],
]) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"], acceptInsecureCerts: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await enterRoom(page);
  await wait(3000);
  if ((await count()) !== before + 1) {
    console.log(`  ${what}: la page n'était pas comptée, rien à mesurer`);
    await browser.close().catch(() => {});
    continue;
  }
  const started = Date.now();
  await leave(browser, page);
  let seconds = null;
  for (let i = 0; i < 120; i++) {
    await wait(500);
    if ((await count()) === before) { seconds = (Date.now() - started) / 1000; break; }
  }
  console.log(`  ${what}: oubliée après ${seconds === null ? "PLUS DE 60 s" : seconds.toFixed(1) + " s"}`);
  await browser.close().catch(() => {});
  await wait(1000);
}
