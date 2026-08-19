// Le mode manette seule: ce qu'il n'ouvre pas, et ce qu'il montre à la place.
//
// La promesse de ce mode est une SOUSTRACTION, et une soustraction ne se voit
// pas à l'œil: une page qui affiche « manette seule » tout en décodant la vidéo
// derrière aurait exactement l'air de marcher. Ce pilote compte donc les
// sockets ouvertes, ce qui est la seule chose qui prouve l'économie.
import puppeteer from "puppeteer";

import { enterRoom, ROOM_URL, seedName } from "./open.mjs";

let bad = 0;
const say = (ok, what) => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
};

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });

/** Ouvre la salle dans le mode demandé, et rend les sockets vues. */
async function room(padOnly) {
  const page = await browser.newPage();
  await seedName(page);
  await page.evaluateOnNewDocument((only) => {
    localStorage.setItem("nel3ab:padonly", only ? "oui" : "non");
  }, padOnly);
  const opened = [];
  const client = await page.target().createCDPSession();
  await client.send("Network.enable");
  client.on("Network.webSocketCreated", ({ url }) => opened.push(new URL(url).pathname));
  await page.goto(ROOM_URL, { waitUntil: "domcontentloaded" });
  await enterRoom(page);
  await new Promise((done) => setTimeout(done, 6000));
  return { page, opened };
}

const only = await room(true);
say(only.opened.includes("/input"), "la manette seule ouvre bien le canal des boutons");
say(!only.opened.includes("/video"), "elle n'ouvre PAS la vidéo");
say(!only.opened.includes("/sound"), "elle n'ouvre PAS le son");
say(
  await only.page.evaluate(() => Boolean(document.getElementById("padOnlyNotice"))),
  "elle dit pourquoi l'écran est vide",
);
const trip = await only.page.evaluate(
  () => globalThis.nel3abTest?.counters?.().roundTripMs ?? null,
);
say(typeof trip === "number" && trip >= 0 && trip < 2000, `l'aller-retour est mesuré (${trip} ms)`);
await only.page.close();

const full = await room(false);
say(full.opened.includes("/video"), "le mode ordinaire ouvre la vidéo");
say(
  !(await full.page.evaluate(() => Boolean(document.getElementById("padOnlyNotice")))),
  "et il n'affiche pas le panneau de la manette seule",
);
await full.page.close();

await browser.close();
console.log(bad === 0 ? "PASS — la manette seule ne décode rien" : `ÉCHEC — ${bad}`);
process.exit(bad === 0 ? 0 : 1);
