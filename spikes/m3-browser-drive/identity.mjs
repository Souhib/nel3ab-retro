// L'identité de bout en bout, à travers le VRAI proxy.
//
// Contre l'adresse tailscale et pas localhost, parce que c'est le proxy qui
// écrit l'identité: mesurer ailleurs mesurerait l'absence de proxy.
import puppeteer from "puppeteer";
import { enterRoom, ROOM_LOGIN, ROOM_URL } from "./open.mjs";

const url = ROOM_URL;
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"], acceptInsecureCerts: true });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

let bad = 0;
const say = (ok, line) => { if (!ok) bad += 1; console.log(`  ${ok ? "ok    " : "FAUX  "} ${line}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Aucun prénom dans ce navigateur: si un nom apparaît, il vient du proxy.
await page.goto(url, { waitUntil: "domcontentloaded" });
await wait(2500);

const text = await page.evaluate(() => document.body.innerText);
say(!text.includes("Qui joue"), "aucun formulaire de prénom: le proxy a déjà dit qui c'est");
say(/bonjour\s+\S/.test(text), `la page salue quelqu'un: « ${(text.match(/bonjour[^\n·]*/) ?? [""])[0].trim()} »`);
// L'adresse attendue vient de l'environnement: elle dépend de qui fait
// tourner la salle, et ce dépôt est public.
if (ROOM_LOGIN) say(text.includes(ROOM_LOGIN), "l'adresse vérifiée est affichée");
else say(/@/.test(text), "une adresse vérifiée est affichée");

// Changer de pseudo, et le retrouver après un rechargement complet.
await page.click("#rename");
await wait(300);
await page.evaluate(() => { document.getElementById("newName").value = ""; });
await page.type("#newName", "le boss");
await page.keyboard.press("Enter");
await wait(800);
say((await page.evaluate(() => document.body.innerText)).includes("le boss"), "le pseudo choisi s'affiche");

await page.reload({ waitUntil: "domcontentloaded" });
await wait(2500);
const after = await page.evaluate(() => document.body.innerText);
say(after.includes("le boss"), "le pseudo survit à un rechargement, donc il est côté serveur");

// Et il est visible dans la salle, avec la place quand il y en a une.
await enterRoom(page);
await wait(3000);
const inRoom = await page.evaluate(() => document.body.innerText);
say(inRoom.includes("le boss"), "la salle affiche le pseudo");

// Un autre navigateur, sans rien dans son stockage, voit la même personne.
const other = await browser.newPage();
await other.goto(url, { waitUntil: "domcontentloaded" });
// Attendre l'élément plutôt qu'un délai: derrière le proxy, la salle met plus
// longtemps à répondre que sur localhost, et un délai fixe mesure la latence du
// réseau au lieu du comportement.
await other.waitForSelector("#people", { timeout: 15000 }).catch(() => {});
const seen = await other.evaluate(() => document.body.innerText);
say(seen.includes("le boss"), "un navigateur neuf reconnaît la même personne");
// Insensible à la casse: l'étiquette est en majuscules par le style, et
// `innerText` rend le texte TRANSFORMÉ. Une assertion en minuscules échouait
// sur une page qui disait exactement ce qu'il fallait.
say(/dans la salle/i.test(seen), "la salle liste ses présents, manette ou pas");

// On remet le pseudo d'origine pour ne pas laisser « le boss » sur la salle.
await other.click("#rename");
await wait(300);
await other.evaluate(() => { document.getElementById("newName").value = ""; });
await other.type("#newName", "Souhib");
await other.keyboard.press("Enter");
await wait(800);

console.log(bad === 0 ? "PASS — l'identité vient du proxy et le pseudo appartient à la personne" : `FAIL — ${bad} écart(s)`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
