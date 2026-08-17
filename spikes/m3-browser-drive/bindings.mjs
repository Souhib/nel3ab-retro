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
/** Ouvre l'écran des touches PAR LE MENU, qui est le seul chemin depuis que les
 * réglages ont quitté la colonne. L'écran s'ouvre par-dessus le menu: on ne
 * renvoie plus personne dans la partie pour changer une touche. */
const openBindings = async () => {
  await press(page, "#openMenu");
  await wait(700);
  await press(page, "#ray-reglages");
  await wait(500);
  await press(page, "#item-bindings");
  await wait(600);
};

const text = (id) => page.evaluate((i) => document.getElementById(i)?.textContent ?? null, id);
/** Cliquer depuis la page: deux allers-retours de moins qu'avec la souris de
 * puppeteer, sur une page qui décode soixante images par seconde. */
const press = (target, css) => target.evaluate((s) => document.querySelector(s)?.click(), css);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await openBindings();
await wait(400);

say((await text("pad-A")) === "✕ (bas)", `A se lit « ${await text("pad-A")} » sur une DualSense`);
say((await text("pad-L")) === "L1 ou L2", `L se lit « ${await text("pad-L")} »`);
say((await text("key-A")) === "X", `A au clavier se lit « ${await text("key-A")} »`);

await press(page, "#pad-A");
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

await press(page, "#key-B");
await wait(300);
await page.keyboard.press("KeyM");
await wait(400);
say((await text("key-B")) === "M", `B au clavier est passé sur « ${await text("key-B")} »`);

// Et ça survit à un rechargement, sinon ce n'est pas une configuration.
await page.reload({ waitUntil: "domcontentloaded" });
await enterRoom(page);
await wait(2500);
await openBindings();
await wait(400);
say((await text("pad-A")) === "▢ (gauche)", "la manette réassignée survit au rechargement");
say((await text("key-B")) === "M", "le clavier réassigné survit au rechargement");

// « Manette d'origine »: le bouton rend la disposition du constructeur.
//
// Trois assertions, et c'est la deuxième qui existe pour une vraie panne. Lire
// chaque manette avec son propre profil demande un cache, parce que la boucle
// d'entrée tourne cent fois par seconde et que `localStorage` est synchrone. Ce
// cache a survécu à une remise à zéro pendant quelques heures: le bouton effaçait
// le profil du disque, la boucle le relisait de la mémoire au tic suivant, et le
// bouton n'avait donc rien fait. L'écran, lui, affichait la bonne valeur pendant
// un instant. D'où l'attente avant de regarder.
await press(page, "#resetPad");
await wait(400);
say((await text("pad-A")) === "✕ (bas)", `après remise à zéro, A se lit « ${await text("pad-A")} »`);

await wait(1500);
say(
  (await text("pad-A")) === "✕ (bas)",
  "et une seconde et demie plus tard, l'ancien profil n'est pas revenu",
);

// Le clavier n'a PAS été touché: deux boutons, deux portées.
say((await text("key-B")) === "M", "la remise à zéro de la manette a laissé le clavier");

// Et c'est vraiment effacé, pas seulement masqué.
await page.reload({ waitUntil: "domcontentloaded" });
await enterRoom(page);
await wait(2500);
await openBindings();
await wait(400);
say((await text("pad-A")) === "✕ (bas)", "la remise à zéro survit au rechargement");

console.log(bad === 0 ? "PASS — l'antisèche dit vrai, la réassignation tient, et la remise à zéro efface" : `FAIL — ${bad} écart(s)`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
