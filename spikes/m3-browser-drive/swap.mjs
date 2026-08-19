// Demander la manette de quelqu'un, et la lui voir céder.
//
// Deux pages, à travers le VRAI proxy: la négociation traverse le salon, et le
// salon ne sait qui tient quoi que parce que le proxy dit qui est qui.
import puppeteer from "puppeteer";
import { enterRoom, seatOf, ROOM_URL } from "./open.mjs";

const url = ROOM_URL;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const say = (ok, line) => { if (!ok) bad += 1; console.log(`  ${ok ? "ok    " : "FAUX  "} ${line}`); };

/** Cliquer depuis la page plutôt qu'avec la souris de puppeteer.
 *
 * `page.click` fait défiler l'élément dans la vue, ce qui demande plusieurs
 * allers-retours au navigateur. Deux pages qui décodent chacune soixante images
 * par seconde sur cette machine suffisent à les faire expirer. Un `click()` dans
 * la page est un seul aller-retour, et c'est le même clic pour le bouton. */
const press = (page, selector) =>
  page.evaluate((css) => document.querySelector(css)?.click(), selector);

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox"],
  acceptInsecureCerts: true,
  protocolTimeout: 30000,
});

const holder = await browser.newPage();
holder.on("pageerror", (e) => console.log(`[holder] ${e.message.slice(0, 160)}`));
await holder.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(holder);
await wait(3500);
const held = await seatOf(holder);
if (held === null) {
  console.log("RIEN TESTÉ — la première page n'a pas eu de manette");
  await browser.close();
  process.exit(2);
}

const asker = await browser.newPage();
asker.on("pageerror", (e) => console.log(`[asker] ${e.message.slice(0, 160)}`));
await asker.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(asker);
await wait(3500);
const own = await seatOf(asker);
say(own !== held, `page 1 tient ${held}, page 2 tient ${own}`);

// La page 2 demande la manette de la page 1, depuis la colonne.
await press(asker, `#port${held}`);
await wait(1200);
say(await asker.$("#asking") !== null, "le demandeur voit sa demande partir");
say(await holder.$("#asked") !== null, "le porteur voit la demande arriver");

// Il refuse d'abord: rien ne doit bouger.
await press(holder, "#keepSeat");
await wait(1500);
say((await seatOf(holder)) === held, "après un refus, le porteur garde sa manette");
const said = await asker.evaluate(() => document.getElementById("asking")?.textContent ?? "");
say(/a dit non/.test(said), `le demandeur est prévenu du refus (« ${said.replace("fermer", "").trim()} »)`);

// Il redemande, et cette fois on accepte.
await press(asker, `#port${held}`);
await wait(1200);
await press(holder, "#giveSeat");
await wait(4000);
say((await seatOf(asker)) === held, `la manette ${held} a changé de main`);
say((await seatOf(holder)) !== held, "l'ancien porteur ne l'a pas reprise par réflexe");

console.log(bad === 0 ? "PASS — on demande, l'autre répond, et la manette suit" : `FAIL — ${bad} écart(s)`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
