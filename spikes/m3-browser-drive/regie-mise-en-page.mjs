// Trois défauts de mise en page corrigés le 22 novembre 2026, et leur garde.
//
// L'audit visuel les avait vus sur des captures, et seules des captures
// montraient leur correction: revenir sur chaque ligne laissait vitest et
// pytest verts, puisque jsdom ne pose rien. Ce pilote mesure dans un vrai rendu,
// sous un système sombre puis clair:
//
//   V6  le dialogue des réglages Switch est centré (il était collé en haut à
//       gauche: `margin: auto` manquait à `.n3-switch-setup`);
//   V8  sur un téléphone de 390 px, la légende de la jauge de l'accueil tient
//       sur deux lignes au plus (elle passait à un mot par ligne: la règle
//       visait `.jauge`, qui n'est pas l'enfant de la grille);
//   V9  les cases de la préparation partent du bord gauche du titre (elles
//       étaient collées au bord de la carte, 151 px à gauche du titre);
//
// et la zone d'image reste noire dans les deux régies.
//
//   node regie-mise-en-page.mjs
//       démarre son propre Vite avec `vite.planche.config.ts`, SANS relais
//       vers les salles (`just regie-visuel`);
//
//   node regie-mise-en-page.mjs http://127.0.0.1:54xx/
//       contre un Vite sans relais déjà lancé.
//
// Toute requête hors de cette origine est coupée, les API de la salle sont
// simulées. L'accueil est assemblé par les vrais modules du salon (`uv run`),
// sans démarrer le salon.
import { spawn, spawnSync } from "node:child_process";
import puppeteer from "puppeteer";
import { enterRoom } from "./open.mjs";

const given = process.argv.find((arg) => /^https?:\/\//.test(arg));
let vite = null;
if (!given) {
  vite = spawn("npx", ["vite", "--config", "vite.planche.config.ts", "--port", "5472", "--strictPort"], {
    cwd: new URL("../../front/", import.meta.url).pathname,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Arrêté aussi quand une précondition lève: un Vite orphelin garderait le port.
  process.on("exit", () => vite.kill("SIGTERM"));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Vite n'a pas démarré")), 25000);
    vite.stdout.on("data", (b) => { if (/Local:/.test(String(b))) { clearTimeout(timer); resolve(); } });
  });
}
const base = given ?? "http://127.0.0.1:5472/";
const origine = new URL(base).origin;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const assemble = spawnSync(
  "uv",
  ["run", "--quiet", "python", "-c", "import sys\nfrom nel3ab_control.api.routes import accueil\nsys.stdout.write(accueil.PAGE)"],
  { cwd: new URL("../../control/", import.meta.url).pathname, encoding: "utf-8", maxBuffer: 1 << 26 },
);
if (assemble.status !== 0 || !assemble.stdout.includes("jauge-mot")) {
  throw new Error(`l'accueil n'a pas pu être assemblé: ${assemble.stderr.slice(0, 400)}`);
}
const ACCUEIL = assemble.stdout;
const SALON = "http://salon.mise-en-page.invalid";
const SALLES = [
  { numero: 1, ouverte: true, chemin: "/r/1/", jeu: "Mario Kart: Double Dash!!", switch: false, gens: ["Ami", "Bo", "Cleo"], places: 1, ouverte_depuis: 3960 },
  { numero: 2, ouverte: true, chemin: "/r/2/", jeu: null, switch: false, gens: [], places: 4, ouverte_depuis: 20 },
  { numero: 3, ouverte: true, chemin: "/r/3/", jeu: "Super Mario Party Jamboree", switch: true, gens: ["Dami"], places: 3, ouverte_depuis: 900 },
];

const ROMS = [
  { name: "Mario Kart Wii", maker: "Nintendo", about: "Course", art: false, console: "wii" },
  { name: "Zelda Tears of the Kingdom", maker: "Nintendo", about: null, art: false, console: "switch" },
];
const salle = (index) => ({
  name: "salle 1",
  game: { index, key: `${index}.iso`, ...ROMS[index] },
  library: ROMS.map((g, i) => ({ index: i, key: `${i}.iso`, ...g })),
  seats: [
    { port: 1, player: "Ami", held: true, claim: "c0" },
    { port: 2, player: "Bo", held: true, claim: "c1" },
    { port: 3, player: null, held: false, claim: null },
    { port: 4, player: null, held: false, claim: null },
  ],
  owner: null,
  people: [
    { name: "Ami", id: "a", seat: 1 },
    { name: "Bo", id: "b", seat: 2 },
  ],
  ask_lasts: 10,
  media_url: "",
});

function simuler(page, room) {
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.protocol === "data:") return req.continue();
    const json = (body, status = 200) => req.respond({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (u.origin === SALON) {
      if (u.pathname === "/") return req.respond({ status: 200, contentType: "text/html; charset=utf-8", body: ACCUEIL });
      if (u.pathname === "/api/salles") return json(SALLES);
      return json({}, 404);
    }
    if (u.origin !== origine) return req.abort();
    const p = u.pathname;
    if (p === "/api/room") return json(room);
    if (p.startsWith("/api/")) return json({}, 404);
    if (p === "/roms") return json({ current: room.game.index, roms: ROMS });
    if (p === "/formats") return json({ half: true });
    if (/^\/(socket\.io|video|sound|input|mic|clip|art)/.test(p)) return req.abort();
    return req.continue();
  });
}

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
async function ouvrir(url, { scheme, room = salle(0), viewport = { width: 1440, height: 900 }, storage = {} }) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
  await page.evaluateOnNewDocument((s) => {
    localStorage.setItem("nel3ab:name", "banc");
    localStorage.setItem("nel3ab:banc", "1");
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, storage);
  await page.setRequestInterception(true);
  simuler(page, room);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
}
async function exiger(page, selector, what) {
  try {
    await page.waitForSelector(selector, { timeout: 6000 });
  } catch {
    throw new Error(`${what}: « ${selector} » absent, l'écran mesuré n'est pas celui qu'on croit`);
  }
}

const resultats = [];
const noter = (nom, ok, detail) => {
  resultats.push({ nom, ok });
  console.log(`  ${ok ? "ok  " : "RATÉ"} ${nom}: ${detail}`);
};

for (const scheme of ["dark", "light"]) {
  const quoi = scheme === "dark" ? "système sombre" : "système clair";
  console.log(`\n== ${quoi} ==`);

  // La zone d'image, et V6 sur une salle Switch.
  const page = await ouvrir(base, { scheme, room: salle(1), storage: { "nel3ab:shell": "ps3" } });
  await enterRoom(page);
  await wait(1500);
  const ecran = await page.evaluate(() => getComputedStyle(document.querySelector("#screen").parentElement).backgroundColor);
  noter(`image noire (${quoi})`, ecran === "rgb(0, 0, 0)", ecran);
  await page.evaluate(() => document.querySelector("#openMenu")?.click());
  await exiger(page, "#ray-reglages", "V6 · menu");
  await page.evaluate(() => document.querySelector("#ray-reglages")?.click());
  await exiger(page, '#ray-reglages[data-selected="true"]', "V6 · réglages");
  await page.evaluate(() => document.querySelector("#item-bindings")?.click());
  await exiger(page, "dialog.n3-switch-setup[open]", "V6 · réglages Switch");
  await wait(400);
  const d = await page.evaluate(() => {
    const r = document.querySelector("dialog.n3-switch-setup").getBoundingClientRect();
    return { gauche: r.left, droite: innerWidth - r.right, haut: r.top, bas: innerHeight - r.bottom };
  });
  const centre = Math.abs(d.gauche - d.droite) < 2 && Math.abs(d.haut - d.bas) < 2 && d.gauche > 20;
  noter(`V6 dialogue Switch centré (${quoi})`, centre, `marges ${d.gauche.toFixed(0)} / ${d.droite.toFixed(0)} px, haut ${d.haut.toFixed(0)} / bas ${d.bas.toFixed(0)} px`);
  await page.close();

  // V9: l'aperçu de la préparation.
  const prep = await ouvrir(new URL("bindings-preview.html?preparation", base).href, { scheme, viewport: { width: 1440, height: 1000 } });
  await exiger(prep, ".n3-preparation-players > div", "V9 · préparation");
  await wait(400);
  const p = await prep.evaluate(() => {
    const titre = document.querySelector(".n3-preparation-heading").getBoundingClientRect();
    const cases = document.querySelector(".n3-preparation-players").getBoundingClientRect();
    return { titre: titre.left, cases: cases.left, carte: document.querySelector(".n3-preparation").getBoundingClientRect().left };
  });
  noter(`V9 cases alignées sur le titre (${quoi})`, Math.abs(p.titre - p.cases) < 1 && p.titre - p.carte > 20, `titre à ${p.titre.toFixed(0)} px, cases à ${p.cases.toFixed(0)} px, carte à ${p.carte.toFixed(0)} px`);
  await prep.close();

  // V8: l'accueil du salon sur un téléphone.
  const tel = await ouvrir(`${SALON}/`, { scheme, viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
  await exiger(tel, ".jauge-mot", "V8 · jauge de l'accueil");
  await wait(600);
  const mots = await tel.evaluate(() =>
    [...document.querySelectorAll(".jauge-mot")].map((m) => {
      const hauteur = m.getBoundingClientRect().height;
      const ligne = Number.parseFloat(getComputedStyle(m).lineHeight) || Number.parseFloat(getComputedStyle(m).fontSize) * 1.2;
      return { texte: m.textContent.trim(), lignes: Math.round(hauteur / ligne), largeur: Math.round(m.getBoundingClientRect().width) };
    }),
  );
  if (mots.length !== SALLES.length) throw new Error(`V8: ${mots.length} jauges pour ${SALLES.length} salles`);
  for (const m of mots) {
    noter(`V8 « ${m.texte} » (${quoi})`, m.lignes <= 2, `${m.lignes} ligne(s) sur ${m.largeur} px`);
  }
  await tel.close();
}
await browser.close();
vite?.kill("SIGTERM");
const faux = resultats.filter((r) => !r.ok).length;
console.log(`\n  ${faux === 0 ? "PASS" : `FAIL — ${faux} mesure(s) hors des bornes`} (${resultats.length} mesures)`);
process.exit(faux === 0 ? 0 : 1);
