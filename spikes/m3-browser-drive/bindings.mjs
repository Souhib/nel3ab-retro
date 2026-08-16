// L'antisèche et le configurateur, contre une vraie page.
//
// La manette est SIMULÉE, en remplaçant `navigator.getGamepads`. Ce qui est
// vérifié est la traduction et la réassignation, pas le pilote USB: brancher une
// vraie DualSense sur le serveur pour tester l'affichage d'un nom serait un
// montage que personne ne peut rejouer.
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";

const url = process.argv[2] ?? "http://localhost:8100/";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await seedName(page, "config");

// Une DualSense, telle que Chrome la rapporte.
await page.evaluateOnNewDocument(() => {
  globalThis.__pad = {
    id: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)",
    mapping: "standard",
    index: 0,
    connected: true,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
  navigator.getGamepads = () => [globalThis.__pad];
});

await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);
await new Promise((r) => setTimeout(r, 2500));

let bad = 0;
const say = (ok, line) => {
  if (!ok) bad += 1;
  console.log(`  ${ok ? "ok    " : "FAUX  "} ${line}`);
};
const text = (id) => page.evaluate((i) => document.getElementById(i)?.textContent ?? null, id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.click("#bindings");
await wait(400);

say((await text("pad-A")) === "✕ (bas)", `A se lit « ${await text("pad-A")} » sur une DualSense`);
say((await text("pad-L")) === "L1 ou L2", `L se lit « ${await text("pad-L")} »`);
say((await text("key-A")) === "X", `A au clavier se lit « ${await text("key-A")} »`);

await page.click("#pad-A");
await wait(300);
say((await text("pad-A")) === "appuie sur la manette", "la case attend un appui");

const before = await page.evaluate(() => globalThis.nel3abTest.counters().attempts);
await page.evaluate(() => {
  globalThis.__pad.buttons[2] = { pressed: true, touched: true, value: 1 };
});
await wait(500);
await page.evaluate(() => {
  globalThis.__pad.buttons[2] = { pressed: false, touched: false, value: 0 };
});
await wait(400);
say((await text("pad-A")) === "▢ (gauche)", `A est passé sur « ${await text("pad-A")} »`);

const during = (await page.evaluate(() => globalThis.nel3abTest.counters().attempts)) - before;
say(during > 0, `la page a continué d'envoyer pendant la capture (${during} trames, en neutre)`);

await page.click("#key-B");
await wait(300);
await page.keyboard.press("KeyM");
await wait(400);
say((await text("key-B")) === "M", `B au clavier est passé sur « ${await text("key-B")} »`);

// Et ça survit à un rechargement, sinon ce n'est pas une configuration.
await page.reload({ waitUntil: "domcontentloaded" });
await enterRoom(page);
await wait(2500);
await page.click("#bindings");
await wait(400);
say((await text("pad-A")) === "▢ (gauche)", "la manette réassignée survit au rechargement");
say((await text("key-B")) === "M", "le clavier réassigné survit au rechargement");

console.log(bad === 0 ? "PASS — l'antisèche dit vrai et la réassignation tient" : `FAIL — ${bad} écart(s)`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
