import puppeteer from "puppeteer";
import { enterRoom, launchPrepared } from "./open.mjs";

// L'adresse en ARGUMENT: le port 8100 n'existe plus depuis que les salles
// ont pris les leurs (8110, 8120, 8130). Un pilote qui l'écrit en dur se
// connecte à rien et meurt sur ECONNREFUSED sans que sa recette le dise.
const url = process.argv[2] ?? process.env.NEL3AB_URL ?? "http://localhost:8110/";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem("nel3ab:name", "banc"); localStorage.setItem("nel3ab:banc", "1");
  localStorage.setItem("nel3ab:shell", "ps3");
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page); await wait(3500);

const look = () => page.evaluate(() => {
  const c = globalThis.nel3abTest?.counters?.() ?? {};
  const p = globalThis.nel3abTest?.pacing?.() ?? {};
  const canvas = document.getElementById("screen");
  let lit = 0;
  if (canvas instanceof HTMLCanvasElement) {
    const ink = canvas.getContext("2d", { willReadFrequently: true });
    if (ink) {
      const d = ink.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let at = 0; at < d.length; at += 4 * 977) lit += d[at] + d[at + 1] + d[at + 2];
    }
  }
  return { t: Math.round(performance.now()), booting: document.getElementById("booting") !== null,
           painted: c.painted ?? 0, restarts: c.restarts ?? 0, undecoded: c.undecoded ?? 0,
           queue: p.queue ?? 0, lit };
});

// On lance, puis on regarde toutes les 500 ms pendant une minute.
await page.evaluate(() => document.querySelector("#openMenu")?.click());
await wait(1200);
await page.evaluate(() => document.querySelector("#item-shelf-gc")?.click());
await wait(900);
const target = await page.evaluate(() =>
  [...document.querySelectorAll("[id^='item-game']")].map((n) => Number(n.id.slice(9)))[0]);
await page.evaluate((i) => document.getElementById(`item-game${i}`)?.click(), target);
// Le panneau de sauvegardes met un instant VARIABLE à s'ouvrir, et l'attendre
// une durée FIXE est le piège que `loading.mjs` documente depuis sa propre
// panne. À 1200 ms le panneau n'était pas encore là, le clic tombait dans le
// vide, et la sonde échantillonnait une salle où rien ne s'était lancé.
// Mesuré le 13 septembre 2026: cinquante et une secondes de zéros sur toutes
// les colonnes, `current` nul avant comme après, et une sortie 0.
// La préparation, jusqu'au bout. Presser la vignette ne fait plus que
// l'ouvrir: sans ces trois gestes, la sonde échantillonnait une salle où rien
// ne s'était lancé et rendait une minute de zéros.
await launchPrepared(page, () =>
  page.evaluate((i) => document.getElementById(`item-game${i}`)?.click(), target));
const zero = Date.now();
console.log(`  demandé le jeu ${target}\n`);
console.log("   t(s)  chargement  peintes  relances  non-déc  file  luminosité");
let last = null;
// A-t-on vu quoi que ce soit? Une sonde qui n'a rien vu doit le dire.
let vu = false;
for (let n = 0; n < 120; n++) {
  await wait(500);
  let s; try { s = await look(); } catch { console.log("   page absente"); continue; }
  const dt = ((Date.now() - zero) / 1000).toFixed(1);
  const key = `${s.booting}|${s.restarts}|${s.painted > (last?.painted ?? -1)}|${s.lit > 40000}`;
  if (!last || key !== last.key || n % 20 === 0) {
    console.log(`  ${dt.padStart(5)}  ${(s.booting ? "OUI" : "non").padStart(10)}  ${String(s.painted).padStart(7)}  ${String(s.restarts).padStart(8)}  ${String(s.undecoded).padStart(7)}  ${String(s.queue).padStart(4)}  ${s.lit}`);
  }
  if (s.painted > 0 || s.booting) vu = true;
  last = { ...s, key };
}
await browser.close();
// Sans cette garde, la sonde imprimait un tableau de zéros et sortait 0, ce qui
// se lit comme « mesuré, tout va bien ». Un instrument qui ne voit rien doit
// refuser, pas rendre une page de néant présentable.
if (!vu) {
  console.log("\nRIEN MESURÉ — aucune image peinte et aucun chargement vu en une minute.");
  console.log("  Le jeu n'a pas démarré: le tableau ci-dessus ne mesure rien.");
  process.exit(1);
}
console.log(`\nMESURÉ — ${last?.painted ?? 0} images peintes, ${last?.restarts ?? 0} relance(s).`);
