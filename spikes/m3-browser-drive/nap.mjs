// La sieste, et le seul défaut qu'elle peut encore produire.
//
// Une salle vide gèle son émulateur. Le worker attend alors son image prochaine
// aussi longtemps que dure la pause, et cette attente n'est PAS un hoquet de
// l'émulateur: la confondre faisait annoncer « l'émulateur a fait attendre
// 203 860 121 ms » pour une salle qui dormait deux jours.
//
// Le worker retranche donc la pause de l'attente. C'est une course entre deux
// fils, celui qui dégèle et celui qui encode, et aucun test unitaire ne peut la
// voir: elle se joue entre `docker unpause` et la première image, soit quelques
// millisecondes. Ce pilote la joue en vrai.
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer";

import { enterRoom, openRoom, ROOM_URL } from "./open.mjs";

let bad = 0;
const say = (ok, what) => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
};

const paused = () =>
  execFileSync("docker", ["inspect", "nel3ab-dolphin", "--format", "{{.State.Paused}}"])
    .toString()
    .trim() === "true";

/** Les tranches de dix secondes écrites depuis `depuis`. */
function tranches(depuis) {
  const raw = execFileSync("journalctl", [
    "-u", "nel3ab-worker", "--since", depuis, "-o", "json", "--no-pager",
  ]).toString();
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(JSON.parse(line).MESSAGE);
      } catch {
        return null;
      }
    })
    .filter((m) => m?.fields);
}

// 1. Attendre que la salle s'endorme. Le délai de grâce est d'une minute.
process.stdout.write("  on attend que la salle s'endorme");
for (let i = 0; i < 60 && !paused(); i++) {
  process.stdout.write(".");
  await new Promise((done) => setTimeout(done, 3000));
}
console.log();
say(paused(), "la salle vide finit par geler son émulateur");

const depuis = new Date(Date.now() - 5000).toISOString().slice(11, 19);

// 2. La réveiller en la regardant.
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await openRoom(browser, ROOM_URL);
await enterRoom(page);
await new Promise((done) => setTimeout(done, 25000));
const peintes = await page.evaluate(() => globalThis.nel3abTest?.counters?.().painted ?? 0);
await browser.close();

say(peintes > 300, `elle se réveille et peint (${peintes} images)`);
say(!paused(), "et elle reste éveillée tant qu'on regarde");

// 3. Ce que le worker a écrit du réveil.
const vues = tranches(depuis).filter((m) => m.fields.message === "streaming");
const dormi = vues.filter((m) => Number(m.fields.slept_ms ?? 0) > 0);
const attentes = vues.map((m) => Number(m.fields.waiting_max_ms ?? 0));

say(dormi.length > 0, `une tranche porte la sieste (${dormi.map((m) => m.fields.slept_ms)} ms)`);
say(
  Math.max(0, ...attentes) < 1000,
  `aucune tranche ne prend la sieste pour un hoquet (attente max ${Math.max(0, ...attentes).toFixed(0)} ms)`,
);

const cris = tranches(depuis).filter((m) => m.fields.message === "the emulator went quiet");
say(cris.length === 0, `aucun cri au secours (${cris.map((m) => Math.round(m.fields.waited_ms))})`);

console.log(bad === 0 ? "PASS — la sieste ne se fait plus passer pour une panne" : `ÉCHEC — ${bad}`);
process.exit(bad === 0 ? 0 : 1);
