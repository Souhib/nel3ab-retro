// La planche d'Aïn dans un vrai navigateur. Lancé par `just planche-garde`.
//
// Pourquoi ce pilote existe. Le vrai cadre de la salle ne porte pas encore
// toutes les ancres que les scènes complètes demandent (les START viennent
// du chantier personnes, la prise du chantier etats) : dans `cadre.mjs`,
// ces scènes se replient en version courte, et `data-refus` le dit. La
// planche (`front/src/apercu/planche.tsx`) a un décor qui les porte toutes.
// Ici, chaque scène y joue sa version COMPLÈTE, ou le pilote échoue.
//
// Trois mesures, chacune avec son jumeau :
//
// 1. versions : dans la salle et au salon, chaque scène prend sa version
//    complète sans aucun repli ; sur le plateau, chaque scène joue. Jumeau :
//    la planche sans l'ancre « start-2 » (`?sans=start-2`) replie
//    « arrivee » de 2P, et le refus nomme l'ancre.
// 2. hors-zones : à chaque image d'écran, la boîte serrée de chaque sprite
//    (`data-serre`) ne touche ni l'image, ni un contrôle, ni un mot. Jumeau :
//    l'image glissée sous le logo pendant une scène est vue.
// 3. immobile : rien ne tourne entre deux scènes. La page compte ses appels
//    à requestAnimationFrame (la planche n'a pas de boucle vidéo : tout
//    appel vient d'Aïn) et ses animations en cours sur Aïn. Après la fin
//    d'une scène, deux secondes sans aucun appel ni animation. Jumeau :
//    pendant la scène, le compteur monte.
//
// La planche est servie par un Vite SANS relais (`vite.planche.config.ts`) :
// rien de vivant n'est touché, et toute requête hors de son origine est
// coupée.
//
//   node planche-ain.mjs [--port 5489] [--mesures versions,hors-zones,immobile]
import { spawn } from "node:child_process";
import puppeteer from "puppeteer";

const args = process.argv.slice(2);
const option = (nom, defaut) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 ? args[i + 1] : defaut;
};
const PORT = Number(option("port", "5489"));
const MESURES = option("mesures", "versions,hors-zones,immobile").split(",");
const LIEUX = option("lieux", "salle,salon,plateau").split(",");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Vite lui-même, pas `npx vite` : tuer npx laissait Vite orphelin, et le
// port pris (premier essai de ce pilote, 23 novembre 2026).
const FRONT = new URL("../../front/", import.meta.url).pathname;
const vite = spawn(`${FRONT}node_modules/.bin/vite`, ["--config", "vite.planche.config.ts", "--port", String(PORT), "--strictPort"], {
  cwd: FRONT,
  stdio: ["ignore", "pipe", "pipe"],
});
// Arrêté aussi quand une précondition lève : un Vite orphelin garderait le port.
process.on("exit", () => vite.kill("SIGTERM"));
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Vite n'a pas démarré")), 30000);
  vite.stdout.on("data", (b) => {
    if (/Local:/.test(String(b))) {
      clearTimeout(timer);
      resolve();
    }
  });
  vite.on("exit", (code) => reject(new Error(`Vite est sorti (${code})`)));
});
const BASE = `http://127.0.0.1:${PORT}/planche.html`;
const ORIGINE = new URL(BASE).origin;

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
process.on("exit", () => browser.process()?.kill("SIGKILL"));

/** La sonde : chaque image d'écran, les boîtes des sprites contre l'image,
 * les contrôles et les mots (les mêmes règles que le planificateur : un
 * contrôle porteur d'ancre est un endroit où se poser, un mot jamais). */
function sonde() {
  const etat = { images: 0, fautes: {}, appels: 0, fin: false };
  window.__ain = etat;
  // Le compteur d'appels : posé avant tout module de la page.
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (f) => {
    etat.appels += 1;
    return raf(f);
  };
  const coupe = (a, b) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  const CONTROLES = 'button, a[href], input, select, summary, [role="button"], [data-interdit]';
  const tour = () => {
    if (!etat.sonde) return raf(tour);
    const enScene = document.querySelector(".rt-mascotte[data-scene]");
    for (const s of document.querySelectorAll(".rt-ain-sprite")) {
      if (!enScene || s.hidden || !s.dataset.serre) continue;
      etat.images += 1;
      const c = s.getBoundingClientRect();
      const [x0, y0, x1, y1] = s.dataset.serre.split(" ").map(Number);
      const r = { left: c.left + x0, top: c.top + y0, right: c.left + x1, bottom: c.top + y1 };
      const qui = `${enScene.dataset.scene} (${s.dataset.acteur})`;
      const toile = document.querySelector("#screen");
      const cadre = toile?.closest("[data-cadre]");
      if (toile && cadre?.dataset.sansImage === "non" && coupe(r, toile.getBoundingClientRect()))
        etat.fautes[`${qui} sur l'image`] = 1;
      for (const o of document.querySelectorAll(CONTROLES)) {
        if (o.closest("[data-zone-jeu], [data-ancre], [data-sol], [data-hote]")) continue;
        if (coupe(r, o.getBoundingClientRect())) etat.fautes[`${qui} sur ${o.tagName.toLowerCase()} « ${o.textContent.trim().slice(0, 24)} »`] = 1;
      }
      for (const o of document.querySelectorAll("[data-texte]"))
        if (coupe(r, o.getBoundingClientRect())) etat.fautes[`${qui} sur le mot « ${o.textContent.trim().slice(0, 24)} »`] = 1;
    }
    raf(tour);
  };
  raf(tour);
}

async function nouvelle(chemin = BASE, { sonder = true } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith(ORIGINE) || r.url().startsWith("data:") ? r.continue() : r.abort()));
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e)));
  page.__erreurs = erreurs;
  await page.evaluateOnNewDocument(sonde);
  await page.goto(chemin, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelectorAll(".rt-mascotte").length === 4, { timeout: 15000 });
  await page.evaluate((s) => {
    window.__ain.sonde = s;
  }, sonder);
  return page;
}

/** Fait défiler jusqu'au décor, pour que la scène se joue dans la fenêtre. */
async function montrer(page, lieu) {
  await page.evaluate((l) => {
    document.querySelector(`#planche-${l}`).scrollIntoView({ block: "center" });
  }, lieu);
  await sleep(100);
}

async function jouer(page, lieu, scene, version = "complete") {
  const r = await page.evaluate((l, s, v) => window.planche.jouer(l, s, v), lieu, scene, version);
  await page.waitForFunction(() => !document.querySelector(".rt-mascotte[data-scene]"), { timeout: 6000 });
  // Le refus se lit après le choix du plan, posé par le rendu.
  return r;
}

const fautes = [];
const ok = (nom, detail = {}) => console.log(JSON.stringify({ mesure: nom, ok: true, ...detail }));

if (MESURES.includes("versions") || MESURES.includes("hors-zones")) {
  const lieux = await (async () => {
    const p = await nouvelle();
    const l = await p.evaluate(() => window.planche.lieux);
    await p.close();
    return l;
  })();
  let images = 0;
  for (const lieu of LIEUX) {
    const versions = {};
    for (const scene of lieux[lieu]) {
      // Une page neuve par scène : chacune part d'Aïn chez lui.
      const page = await nouvelle();
      await montrer(page, lieu);
      const r = await jouer(page, lieu, scene);
      versions[scene] = r.version;
      if (lieu !== "plateau" && (r.version !== "complete" || r.refus))
        fautes.push(`${lieu} ${scene} : ${r.version}${r.refus ? ` (${r.refus})` : ""}`);
      if (lieu === "plateau" && r.version === "cle") fautes.push(`plateau ${scene} : pose clé seule (${r.refus})`);
      const lu = await page.evaluate(() => window.__ain);
      images += lu.images;
      for (const f of Object.keys(lu.fautes)) fautes.push(`${lieu} : ${f}`);
      if (page.__erreurs.length) fautes.push(`${lieu} ${scene} : ${page.__erreurs.join(" | ")}`);
      await page.close();
    }
    console.log(JSON.stringify({ lieu, versions }));
  }
  if (images < 50 * LIEUX.length) throw new Error(`la sonde n'a vu que ${images} images de sprites : elle ne prouve rien`);
  // Jumeau des versions : l'ancre de 2P absente, « arrivee » se replie.
  {
    const page = await nouvelle(`${BASE}?sans=start-2`);
    await montrer(page, "salle");
    const r = await jouer(page, "salle", "arrivee");
    await page.close();
    if (r.version === "complete" || !/start-2/.test(r.refus))
      throw new Error(`jumeau : sans « start-2 », arrivee joue ${r.version} (${r.refus})`);
    ok("jumeau-versions", { version: r.version, refus: r.refus });
  }
  // Jumeau de la sonde : l'image glisse sous le logo pendant une scène.
  {
    const page = await nouvelle();
    await montrer(page, "salle");
    await page.evaluate(() => window.planche.jouer("salle", "fier", "complete"));
    await sleep(200);
    await page.evaluate(() => {
      const logo = document.querySelector('#planche-salle [data-hote="coin"] > canvas').getBoundingClientRect();
      const zone = document.querySelector("#planche-salle [data-zone-jeu]");
      const cadre = zone.parentElement.getBoundingClientRect();
      Object.assign(zone.style, { left: `${logo.left - cadre.left - 40}px`, top: `${logo.top - cadre.top - 120}px` });
    });
    await sleep(500);
    const lu = await page.evaluate(() => window.__ain);
    await page.close();
    if (!Object.keys(lu.fautes).some((f) => f.includes("sur l'image")))
      throw new Error(`jumeau : la sonde ne voit pas Aïn sur l'image (${JSON.stringify(lu.fautes)})`);
    ok("jumeau-hors-zones");
  }
  ok("versions et hors-zones", { images });
}

if (MESURES.includes("immobile")) {
  const releve = [];
  for (const [lieu, scene, niveau] of [
    ["salle", "fier", "conseille"],
    ["salle", "decroche", "conseille"],
    ["salon", "depot", "conseille"],
    ["plateau", "attente", "conseille"],
    ["salle", "arrivee", "tout"],
  ]) {
    const page = await nouvelle(BASE, { sonder: false });
    await page.evaluate((n) => localStorage.setItem("nel3ab:effets", JSON.stringify({ niveau: n, sons: false })), niveau);
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.querySelectorAll(".rt-mascotte").length === 4);
    await montrer(page, lieu);
    // Avant toute scène : la page est déjà immobile.
    await sleep(300);
    const avant = await page.evaluate(async () => {
      window.__ain.appels = 0;
      await new Promise((r) => setTimeout(r, 1000));
      return window.__ain.appels;
    });
    // Une scène cède quand deux images de suite arrivent à plus de 50 ms
    // (la page a du retard) : elle saute à sa fin en trois appels. Sous la
    // charge des autres portes, « arrivee » a cédé ainsi le 23 novembre 2026.
    // Une scène finie avant 400 ms a cédé : on la rejoue, trois fois au plus.
    let pendant = 0;
    let cede = 0;
    for (;;) {
      await page.evaluate(() => {
        window.__ain.appels = 0;
      });
      await page.evaluate((l, s) => window.planche.jouer(l, s, "complete"), lieu, scene);
      await sleep(400);
      const vu = await page.evaluate(() => ({ appels: window.__ain.appels, joue: !!document.querySelector(".rt-mascotte[data-scene]") }));
      pendant = vu.appels;
      await page.waitForFunction(() => !document.querySelector(".rt-mascotte[data-scene]"), { timeout: 6000 });
      if (vu.joue) break;
      cede += 1;
      if (cede > 3) break;
      await sleep(500);
    }
    // Le pointeur passe au niveau Tout : un calcul par geste, puis plus rien.
    if (niveau === "tout") for (const [x, y] of [[700, 300], [900, 600], [300, 700]]) await page.mouse.move(x, y, { steps: 3 });
    await sleep(300);
    const apres = await page.evaluate(async () => {
      window.__ain.appels = 0;
      await new Promise((r) => setTimeout(r, 2000));
      const animations = document
        .getAnimations()
        .filter((a) => a.playState === "running" && a.effect?.target?.closest?.("[data-hote], .rt-ain-calque"))
        .map((a) => a.effect.target.className || a.effect.target.tagName);
      return { appels: window.__ain.appels, animations };
    });
    await page.close();
    releve.push({ lieu, scene, niveau, avant, pendant, cede, apres });
    if (cede > 3) throw new Error(`« ${scene} » a cédé à chaque essai : la page a trop de retard pour mesurer`);
    if (pendant < 10) throw new Error(`jumeau : pendant « ${scene} », ${pendant} appels seulement : le compteur ne voit pas la boucle`);
    if (avant !== 0) fautes.push(`${lieu} : ${avant} appels en 1 s avant toute scène`);
    if (apres.appels !== 0) fautes.push(`${lieu} ${scene} (${niveau}) : ${apres.appels} appels en 2 s après la fin`);
    if (apres.animations.length) fautes.push(`${lieu} ${scene} : animations en cours après la fin : ${apres.animations.join(", ")}`);
  }
  console.log(JSON.stringify({ mesure: "immobile", releve }));
}

await browser.close();
if (fautes.length) {
  console.error(fautes.map((f) => `FAUTE ${f}`).join("\n"));
  process.exit(1);
}
console.log("planche d'Aïn : tout est vert");
process.exit(0);
