// Ce que la page MONTRE pendant un changement de jeu, image par image.
//
// RESTARTS THE SESSION on purpose. Ne pas lancer pendant que quelqu'un joue.
//
// Le défaut à caractériser: l'écran de chargement se retire, on voit l'ancien
// jeu FIGÉ, puis le nouveau arrive. Trois explications tenaient debout sur le
// papier et se contredisaient, donc on mesure au lieu de choisir.
//
// Ce qui est échantillonné toutes les 100 ms:
//   - l'écran de chargement est-il dans le DOM;
//   - combien d'images ont été peintes en tout;
//   - une empreinte de ce qui est VISIBLE sur la toile.
//
// L'empreinte est ce qui tranche: si au moment où l'écran de chargement part
// elle vaut encore celle d'AVANT le changement, alors on découvre l'ancien jeu.
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";

const url = process.argv[2] ?? "http://localhost:8100/";
const roms = async () => (await fetch(new URL("/roms", url))).json();

const before = await roms();
if (before.roms.length < 2) {
  console.log(`RIEN TESTÉ — il faut au moins deux jeux, la salle en a ${before.roms.length}`);
  process.exit(0);
}

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await seedName(page);
page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);
await new Promise((r) => setTimeout(r, 4000));

// L'empreinte de la toile: quelques centaines de pixels, sommés. Assez pour
// distinguer deux jeux et le noir, assez peu pour être lue en une milliseconde.
const sample = () =>
  page.evaluate(() => {
    const canvas = document.getElementById("screen");
    let mark = 0;
    let lit = 0;
    if (canvas instanceof HTMLCanvasElement) {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) {
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const step = 4 * 977; // premier assez grand pour balayer sans motif
        for (let at = 0; at < data.length; at += step) {
          mark = (mark * 31 + data[at] + data[at + 1] + data[at + 2]) >>> 0;
          lit += data[at] + data[at + 1] + data[at + 2];
        }
      }
    }
    const counters = globalThis.nel3abTest?.counters?.() ?? {};
    const pacing = globalThis.nel3abTest?.pacing?.() ?? {};
    return {
      booting: document.getElementById("booting") !== null,
      painted: counters.painted ?? 0,
      mark,
      lit,
      probeP95: pacing.probeP95 ?? 0,
    };
  });

const trace = [];
const started = Date.now();
let sampling = true;
const loop = (async () => {
  while (sampling) {
    try {
      trace.push({ at: Date.now() - started, ...(await sample()) });
    } catch {
      trace.push({ at: Date.now() - started, gone: true });
    }
    await new Promise((r) => setTimeout(r, 100));
  }
})();

const press = (css) => page.evaluate((s) => document.querySelector(s)?.click(), css);
await press("#openMenu");
await new Promise((r) => setTimeout(r, 1500));
// L'ÉTAGÈRE d'abord: la bibliothèque a deux étages depuis qu'il y a des jeux
// Wii, et les jeux ne sont plus au premier niveau du menu. Sans cette étape, ce
// pilote cliquait dans le vide et rapportait une salle où rien ne se passe —
// c'est-à-dire un vert qui ne prouve rien. `games.mjs` a le même défaut.
//
// Et la CIBLE est choisie dans ce que l'étagère montre, pas décidée d'avance:
// un indice pris dans la bibliothèque entière peut désigner un jeu rangé sur
// l'autre étagère, et le pilote se tait alors sans rien prouver.
await press("#item-shelf-gc");
await new Promise((r) => setTimeout(r, 900));
const shown = await page.evaluate(() =>
  [...document.querySelectorAll("[id^='item-game']")].map((n) => Number(n.id.slice(9))),
);
// `NEL3AB_TARGET` force le jeu, parce que tous ne démarrent pas pareil: certains
// affichent une image tout de suite, d'autres passent des secondes sur du noir.
// Vérifier le correctif demande de pouvoir choisir le second.
const asked = Number(process.env.NEL3AB_TARGET ?? NaN);
const target = Number.isInteger(asked)
  ? shown.find((index) => index === asked)
  : shown.find((index) => index !== before.current);
if (target === undefined) {
  console.log(`RIEN TESTÉ — rien d'autre à lancer sur cette étagère (vu ${shown.join(", ")})`);
  await browser.close();
  process.exit(0);
}
console.log(`  cible: jeu ${target} (${before.roms[target]?.name ?? "?"})`);
await press(`#item-game${target}`);
// Le panneau de choix met un instant à s'ouvrir. Attendre une durée fixe rendait
// ce pilote muet: il retombait sur la double pression, qui ne fait RIEN quand le
// jeu a des sauvegardes, et il mesurait donc une salle où rien ne s'est passé.
let picked = false;
for (let attempt = 0; attempt < 30 && !picked; attempt++) {
  await new Promise((r) => setTimeout(r, 200));
  picked = await page.evaluate(() => {
    const pick = document.querySelector('[id^="pick-"]');
    if (!pick) return false;
    pick.click();
    return true;
  });
}
if (!picked) {
  await press(`#item-game${target}`);
  console.log("  pas de panneau: double pression");
}
const requestedAt = Date.now() - started;
// Les premiers dixièmes de seconde, serrés: c'est là que l'écran de chargement
// doit apparaître, et c'est la seule fenêtre où un échantillonnage à 100 ms
// pourrait tout rater.
{
  const close = [];
  for (let n = 0; n < 24; n++) {
    close.push(
      await page.evaluate(() => ({
        t: Math.round(performance.now()),
        booting: document.getElementById("booting") !== null,
        seat: globalThis.nel3abTest?.room?.()?.mine ?? null,
      })),
    );
    await new Promise((r) => setTimeout(r, 60));
  }
  const zero = close[0].t;
  console.log(
    "  après le clic: " +
      close.map((s) => `${s.t - zero}:${s.booting ? "O" : "."}${s.seat ?? "-"}`).join(" "),
  );
}
console.log(`  changement demandé (${picked ? "panneau" : "double pression"}) vers ${target}`);

await new Promise((r) => setTimeout(r, 45000));
sampling = false;
await loop;
await browser.close();

import { writeFileSync } from "node:fs";
if (process.env.NEL3AB_TRACE) {
  writeFileSync(process.env.NEL3AB_TRACE, JSON.stringify({ requestedAt, trace }, null, 1));
}

// Le verdict. Ce qui est vérifié est ce qu'on VOIT, et non un compteur interne:
// le défaut du 31 août 2026 laissait tous les compteurs cohérents et montrait
// l'ancien jeu figé pendant cinq secondes et demie.
const after = trace.filter((s) => s.at >= requestedAt);
const beforeLit = trace.filter((s) => s.at < requestedAt && s.painted > 0).map((s) => s.lit);
const oldLit = beforeLit.at(-1) ?? 0;

// « L'ancienne image est découverte »: pas d'écran de chargement par-dessus, et
// une luminosité qui est encore celle d'avant. La luminosité plutôt qu'une
// empreinte de pixels: une empreinte s'est révélée instable d'un relevé à
// l'autre sur une image pourtant figée, donc inutilisable comme preuve.
const exposed = after.filter(
  (s) => !s.booting && oldLit > 1000 && Math.abs(s.lit - oldLit) < oldLit * 0.05,
);
// Et seulement AVANT que le nouveau jeu n'arrive: après, une ressemblance de
// luminosité entre deux jeux n'est qu'une coïncidence.
const firstAfterBooting = after.find((s) => s.booting)?.at ?? requestedAt;
const lifted = after.find((s) => s.at > firstAfterBooting && !s.booting)?.at ?? Infinity;
const early = exposed.filter((s) => s.at < lifted);

const covered = after.find((s) => s.booting);
const appearedAfter = covered ? covered.at - requestedAt : null;

console.log(`\n  écran de chargement affiché ${appearedAfter} ms après la demande`);
console.log(`  ancienne image découverte avant le nouveau jeu: ${early.length} relevés`);

const failures = [];
// Une demi-seconde de marge: la page rend à son rythme, et exiger l'instant même
// rendrait ce pilote capricieux sans rien prouver de plus.
if (appearedAfter === null || appearedAfter > 500) {
  failures.push(`l'écran de chargement n'apparaît pas dans la demi-seconde (${appearedAfter} ms)`);
}
if (early.length > 0) {
  failures.push(
    `l'ancienne image est restée visible de ${early[0].at - requestedAt} à ` +
      `${early.at(-1).at - requestedAt} ms après la demande`,
  );
}
if (lifted === Infinity) failures.push("l'écran de chargement n'est jamais parti");
// Et il ne doit pas partir sur du NOIR: c'est Dolphin qui démarre, pas le jeu
// qui est là. Mesuré le 31 août 2026: quatre secondes de noir découvert sur
// Mario Kart Double Dash, aucune sur Mario Party 4 — donc un défaut qui ne se
// montre qu'un jeu sur deux, et qu'un pilote doit attraper pour les deux.
const atLift = after.find((s) => s.at >= lifted);
if (atLift && atLift.lit < 30000) {
  failures.push(`l'écran s'est retiré sur une image noire (luminosité ${atLift.lit})`);
}

if (failures.length === 0) {
  console.log("PASS — l'écran couvre le changement, et l'ancien jeu ne réapparaît pas");
  process.exit(0);
}
for (const why of failures) console.log(`FAIL — ${why}`);
process.exit(1);
