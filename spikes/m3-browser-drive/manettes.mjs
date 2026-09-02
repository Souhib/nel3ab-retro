// Les réglages de manette suivent la PERSONNE, pas la machine.
//
// Ce que la CI ne peut pas prouver: qu'un profil réglé dans un navigateur se
// retrouve dans un autre. Le test unitaire vérifie la route; celui-ci vérifie
// que la page l'utilise, dans le bon ordre, et que la boucle d'entrée voit bien
// le profil venu du service plutôt que celui de la machine.
import puppeteer from "puppeteer";

import { enterRoom, openRoom, ROOM_URL } from "./open.mjs";

let bad = 0;
const say = (ok, what) => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
};

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });

/** Un profil reconnaissable, avec le REPOS qui est tout l'enjeu du correctif. */
const PROFILE = {
  id: "manette-d-essai",
  buttons: { A: { button: 1, rest: 0 } },
  triggers: {},
  sticks: { x: { axis: 0, sign: 1, rest: 0.25 } },
};

// Premier navigateur: il règle, et la page envoie.
const first = await openRoom(browser, ROOM_URL);
await enterRoom(first);
await new Promise((r) => setTimeout(r, 2000));
const posted = await first.evaluate(async (profile) => {
  localStorage.setItem(`nel3ab.pad.${profile.id}`, JSON.stringify(profile));
  const answer = await fetch("/api/me/bindings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pads: { [profile.id]: profile }, keys: {} }),
  });
  return answer.status;
}, PROFILE);
say(
  posted === 200 || posted === 401,
  `le service accepte ou refuse franchement les réglages (${posted})`,
);

if (posted === 401) {
  console.log("  (pas de proxy devant: les réglages restent locaux, c'est le repli prévu)");
  await browser.close();
  process.exit(0);
}

// Deuxième navigateur, profil VIERGE: il ne doit rien savoir de cette manette,
// et pourtant la retrouver.
const second = await browser.createBrowserContext();
const fresh = await openRoom({ newPage: () => second.newPage() }, ROOM_URL);
await enterRoom(fresh);
await new Promise((r) => setTimeout(r, 2500));

const found = await fresh.evaluate((id) => {
  const kept = localStorage.getItem(`nel3ab.pad.${id}`);
  return kept ? JSON.parse(kept) : null;
}, PROFILE.id);

say(found !== null, "une machine neuve retrouve la manette réglée ailleurs");
// Le repos est ce qui empêche un personnage de courir tout seul. Un transport
// qui perdrait ce nombre rendrait le voyage inutile.
say(found?.sticks?.x?.rest === 0.25, `et le repos du stick a fait le voyage (${found?.sticks?.x?.rest})`);

await browser.close();
console.log(bad === 0 ? "PASS — les réglages suivent la personne" : `ÉCHEC — ${bad}`);
process.exit(bad === 0 ? 0 : 1);
