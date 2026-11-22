// La salle sur un téléphone et une tablette : chaque fonction est joignable,
// rien ne déborde, et rien ne sort des zones sûres.
//
// Pourquoi elle existe. L'audit du 22 novembre 2026 a trouvé, sur un téléphone :
// la colonne repliée d'office et ses fonctions nulle part ailleurs (P5, E2) ;
// la colonne dépliée à 50 % de la largeur, image de 195 px et touches hors de
// l'écran (M6) ; un plein écran qui lève une erreur sur iPhone (M8) ; l'entrée
// de la salle coupée en haut en paysage (M9) ; le réglage des touches réduit à
// une bande en paysage (M11). Aucun essai ne le voyait : jsdom ne pose rien.
//
// Ce qu'elle vérifie, à 375x667, 390x844, 430x932, 844x390, 932x430 et
// 768x1024, en tactile et avec les zones sûres d'un iPhone simulées
// (`Emulation.setSafeAreaInsetsOverride`), puis à 1440x900 à la souris :
//
//   1. la page ne défile pas en largeur, et aucune cible visible n'en recouvre
//      une autre ;
//   2. un seul bouton « ••• » ouvre la feuille du bas ; lui et chaque entrée
//      de la feuille tiennent dans les zones sûres, font 44 px au moins, et
//      reçoivent leur appui (`elementFromPoint`) ; « Menu du jeu » ouvre le
//      menu et ferme la feuille ;
//   3. la feuille ouvre le tiroir de la salle, qui tient dans l'écran sans
//      défiler en largeur, et où chaque fonction de la colonne se joint : les
//      places, prendre une place précise, demander celle d'un autre, signaler,
//      le diagnostic, les spectateurs, quitter, et le bouton qui le ferme ;
//   4. la manette à l'écran n'est pas montée tant que le tiroir est ouvert ;
//   5. sans l'API plein écran (un iPhone), aucune erreur de page, et la
//      feuille propose l'écran d'accueil ; avec elle, le plein écran ;
//   6. le son coupé se voit sur le « ••• », GameCube comme Xbox 360 ;
//   7. l'entrée de la salle tient en haut de l'écran, et sous la salle au
//      repos ou le rideau d'une arrivée, le tiroir reste joignable ;
//   8. le réglage des touches prend tout l'écran en paysage, avec une vraie
//      hauteur pour son contenu et un bouton fermer de 44 px ;
//   9. sur la page CONSTRUITE (`--page`), la première image porte le thème
//      choisi contre le système, et pas celui du système ;
//  10. à 1440x900, la colonne reste à côté de l'image, sans « ••• ».
//
// Deux jumeaux négatifs ouvrent la garde : un leurre posé sur une entrée de la
// feuille, et un bloc plus large que l'écran. Chacun doit être vu.
//
// Elle sert la page de l'arbre de travail par Vite, SANS relais : la session
// média est remplacée par `salle-telephone.session.ts`, l'API du salon est
// simulée par interception, et toutes les sockets sont muettes. Rien ne part
// vers une salle vivante.
//
//   node salle-telephone.mjs [dossier des captures] [--page <index.html construit>]
//
// Port 5446 par défaut, ou SALLE_TELEPHONE_PORT.
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const HERE = import.meta.dirname;
const REPO = resolve(HERE, "..", "..");
const FRONT = join(REPO, "front");
const PORT = Number(process.env.SALLE_TELEPHONE_PORT ?? 5446);
const args = process.argv.slice(2);
const pageAt = args.indexOf("--page");
const BUILT = resolve(
  pageAt >= 0 ? args[pageAt + 1] : join(REPO, "core", "crates", "worker", "src", "page", "index.html"),
);
const OUT = resolve(args.find((one, i) => !one.startsWith("--") && args[i - 1] !== "--page") ?? join(tmpdir(), "salle-telephone"));
const FAKE = join(HERE, "salle-telephone.session.ts");
// Une partie seulement, pour travailler :
// SEUL=salle,plein-ecran,liaison,voile,entree,touches,theme,pc.
const SEUL = process.env.SEUL?.split(",") ?? null;
const part = (name) => SEUL === null || SEUL.includes(name);

// Quarante-quatre : le plancher usuel d'une cible tactile (WCAG 2.5.5, Apple HIG).
const FLOOR = 44;
const SIZES = [
  [375, 667],
  [390, 844],
  [430, 932],
  [844, 390],
  [932, 430],
  [768, 1024],
];
// Les zones sûres d'un iPhone à encoche, en points CSS : 47 en haut et 34 en
// bas tenu droit, 47 de chaque côté et 21 en bas tenu en travers.
const zoneOf = (width, height) =>
  width > height ? { top: 0, right: 47, bottom: 21, left: 47 } : { top: 47, right: 0, bottom: 34, left: 0 };
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const OPENER = '[data-geste="feuille"], #ouvrirFeuille';
// Ce que le tiroir doit porter : la colonne entière, joignable au doigt.
const DRAWER_MUST = {
  "la rangée des places": "#ports",
  "prendre une place précise (la 3, libre)": "#port3",
  "demander la place d'un autre (la 2)": "#port2",
  "prendre ou rendre sa place": "#takePad, #watchOnly",
  signaler: "#complain",
  "le diagnostic de la liaison": "#connection-diagnostic > summary",
  "les spectateurs": "section[aria-label='spectateurs']",
  quitter: "#leaveRoom",
  "fermer le tiroir": "#foldColumn",
};

const BIBLIOTHEQUE = [
  { index: 0, name: "Mario Kart: Double Dash!!", maker: "Éditeur", about: "", console: "gc", art: false, players: 4 },
  { index: 1, name: "Sonic Generations", maker: "Éditeur", about: "", console: "x360", art: false, players: 4 },
];
const room = (game) => ({
  name: "salle 1",
  game: game === null ? null : BIBLIOTHEQUE[game],
  library: BIBLIOTHEQUE,
  seats: [
    { port: 1, player: "Ami", held: true, claim: "moi" },
    { port: 2, player: "Bo", held: true, claim: "bo" },
    { port: 3, player: null, held: false, claim: null },
    { port: 4, player: null, held: false, claim: null },
  ],
  owner: { name: "Ami", id: "a", moi: true, seat: 1 },
  people: [
    { name: "Ami", id: "a", moi: true, seat: 1 },
    { name: "Bo", id: "b", moi: false, seat: 2 },
    { name: "Cam", id: "c", moi: false, seat: null, seat_pending: false },
  ],
  ask_lasts: 10,
  media_url: "",
});

const fromFront = createRequire(join(FRONT, "package.json"));
const load = async (name) => (await import(pathToFileURL(fromFront.resolve(name)).href)).default;
const { createServer } = await import(pathToFileURL(fromFront.resolve("vite")).href);
const react = await load("@vitejs/plugin-react");
const tailwind = await load("@tailwindcss/vite");

const cache = mkdtempSync(join(tmpdir(), "salle-telephone-vite-"));
const server = await createServer({
  configFile: false,
  root: FRONT,
  cacheDir: cache,
  logLevel: "warn",
  plugins: [
    {
      name: "salle-telephone-session",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === "./lib/useSession" && importer?.endsWith("/src/App.tsx")) return FAKE;
        return null;
      },
    },
    react(),
    tailwind(),
  ],
  // Aucun `proxy` : c'est toute la différence avec `npm run dev`.
  server: { host: "127.0.0.1", port: PORT, strictPort: true, hmr: false, fs: { allow: [REPO] } },
});
await server.listen();
const BASE = `http://127.0.0.1:${PORT}`;

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const failures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (ok, what, details = []) => {
  console.log(`${ok ? "ok  " : "RATÉ"}  ${what}`);
  for (const one of details) console.log(`        ${one}`);
  if (!ok) failures.push(what);
};

/** Une page neuve, à une taille, tactile ou non, sans aucune socket. */
async function ouvrir({ width, height, coarse = true, url, game = 0, stockage = {}, avant = null, built = null }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: coarse, hasTouch: coarse, deviceScaleFactor: 2 });
  if (coarse) await page.setUserAgent(IPHONE);
  const zone = coarse ? zoneOf(width, height) : { top: 0, right: 0, bottom: 0, left: 0 };
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: zone });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluateOnNewDocument(
    (stockage) => {
      class Muette {
        constructor(url) {
          this.url = url;
          this.readyState = 0;
          this.binaryType = "blob";
          this.bufferedAmount = 0;
        }
        send() {}
        close() {
          this.readyState = 3;
        }
        addEventListener() {}
        removeEventListener() {}
      }
      Object.assign(Muette, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
      window.WebSocket = Muette;
      try {
        localStorage.setItem("nel3ab:name", "banc");
        localStorage.setItem("nel3ab:banc", "1");
        for (const [k, v] of Object.entries(stockage)) localStorage.setItem(k, v);
      } catch {
        // Un stockage refusé laisse la page sur ses défauts.
      }
    },
    stockage,
  );
  if (avant) await page.evaluateOnNewDocument(avant);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.protocol === "data:" || u.protocol === "blob:") return req.continue();
    if (u.origin !== BASE) return req.abort();
    const p = u.pathname;
    const json = (body, status = 200) =>
      req.respond({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (built && p === "/construite/r/1/") return req.respond({ status: 200, contentType: "text/html", body: built });
    if (p.includes("/socket.io")) return req.abort();
    if (p === "/api/me") return json({ login: "banc@exemple.invalid", name: "Ami", publishes: false });
    if (p === "/api/me/bindings") return json({ pads: {}, keys: {}, setups: {} });
    if (p === "/api/room/bindings") return json({ pads: {}, keys: {} });
    if (p === "/api/me/connection") return json({ kind: "direct" });
    if (p === "/api/room") return json(room(game));
    if (p === "/api/salles") return json([{ numero: 1, ouverte: true, redemarre: false, chemin: "/r/1/", jeu: null }]);
    if (p.startsWith("/api/")) return json({ detail: "absent du banc" }, 404);
    if (p === "/r/1/saves") return json([true, true, true, true]);
    if (p === "/r/1/formats") return json({ half: true });
    if (/^\/r\/1\/(art|roms|clip)/.test(p)) return json({}, 404);
    return req.continue();
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return { page, errors, zone };
}

/** Le rectangle d'un élément, et s'il reçoit un appui en son centre. */
function boite(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
    hit: hit !== null && (hit === el || el.contains(hit)),
    who: hit ? hit.id || hit.dataset?.entree || hit.textContent?.trim().slice(0, 24) || hit.tagName : null,
    alerte: el.hasAttribute("data-alerte"),
  };
}

/** Ce qui déborde, et les cibles visibles qui se recouvrent. */
function etat() {
  const vw = window.innerWidth;
  const bad = [];
  const wide = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (wide > vw + 0.5) bad.push(`la page défile en largeur : ${wide} px pour ${vw}`);
  const shown = (el) => {
    if (el.closest("dialog:not([open])")) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || s.pointerEvents === "none") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // Les cibles de la couche du dessus seulement : un dialogue ouvert rend le
  // reste inerte, et ce qui est dessous ne se touche plus.
  const top = [...document.querySelectorAll("dialog[open]")].at(-1) ?? document.body;
  const targets = [...top.querySelectorAll("button, a[href], input, select, summary, [data-touche]")].filter(shown);
  const label = (el) => el.id || el.dataset.touche || el.dataset.entree || el.textContent.trim().slice(0, 20);
  for (let i = 0; i < targets.length; i++)
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i];
      const b = targets[j];
      if (a.contains(b) || b.contains(a)) continue;
      const A = a.getBoundingClientRect();
      const B = b.getBoundingClientRect();
      const w = Math.min(A.right, B.right) - Math.max(A.left, B.left);
      const h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
      if (w > 2 && h > 2) bad.push(`${label(a)} recouvre ${label(b)} (${Math.round(w)}x${Math.round(h)})`);
    }
  return bad;
}

/** Une cible : dans l'écran, dans les zones sûres, assez grande, et touchée. */
const dansLaZone = (name, b, zone, vw, vh, floor = FLOOR) => {
  const bad = [];
  if (!b) return [`${name} : absent`];
  if (b.left < zone.left - 0.5 || b.right > vw - zone.right + 0.5 || b.top < zone.top - 0.5 || b.bottom > vh - zone.bottom + 0.5)
    bad.push(
      `${name} sort des zones sûres : [${Math.round(b.left)}, ${Math.round(b.top)}, ${Math.round(b.right)}, ${Math.round(b.bottom)}] dans ${vw}x${vh}`,
    );
  if (Math.min(b.width, b.height) < floor - 0.5) bad.push(`${name} mesure ${Math.round(b.width)}x${Math.round(b.height)} px`);
  if (!b.hit) bad.push(`${name} ne reçoit pas son appui : ${b.who}`);
  return bad;
};

const tap = async (page, selector) => {
  const b = await page.evaluate(boite, selector);
  if (!b) throw new Error(`${selector} absent`);
  await page.touchscreen.tap(b.left + b.width / 2, b.top + b.height / 2);
};

async function attendre(page, test, arg, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await page.evaluate(test, arg)) return true;
    if (Date.now() > end) return false;
    await sleep(100);
  }
}

const ENTRIES = () =>
  [...document.querySelectorAll("#feuilleDuBas [data-entree]")].map((el) => el.dataset.entree);

try {
  // Les jumeaux négatifs de la mesure elle-même.
  {
    const { page } = await ouvrir({ width: 390, height: 844, url: `${BASE}/r/1/?entrer=jouer` });
    await page.waitForSelector("#screen", { timeout: 20000 });
    await page.evaluate(() => {
      const wide = document.createElement("div");
      wide.id = "leurre-large";
      Object.assign(wide.style, { position: "absolute", left: "0", top: "0", width: "2000px", height: "4px" });
      document.body.append(wide);
    });
    const seen = (await page.evaluate(etat)).some((line) => line.includes("défile en largeur"));
    say(seen, "jumeau : la garde voit une page qui défile en largeur");
    await page.evaluate(() => document.getElementById("leurre-large")?.remove());
    await page.evaluate(() => {
      const cover = document.createElement("button");
      cover.id = "leurre-dessus";
      Object.assign(cover.style, { position: "fixed", inset: "0", zIndex: "2147483647" });
      document.body.append(cover);
    });
    const covered = !(await page.evaluate(boite, "#screen"))?.hit;
    say(covered, "jumeau : la garde voit une cible recouverte par un calque");
    await page.close();
  }

  for (const [width, height] of part("salle") ? SIZES : []) {
    const size = `${width}x${height}`;
    for (const { game, name, sound } of [
      { game: 0, name: "gc", sound: "running" },
      ...(size === "390x844" || size === "844x390"
        ? [
            { game: 1, name: "x360", sound: "running" },
            { game: 1, name: "x360-muet", sound: "suspended" },
            { game: 0, name: "gc-muet", sound: "suspended" },
          ]
        : []),
    ]) {
      const what = `${name} ${size}`;
      const pw = game === 0 ? 640 : 1280;
      const ph = game === 0 ? 480 : 720;
      const { page, errors, zone } = await ouvrir({
        width,
        height,
        url: `${BASE}/r/1/?entrer=jouer&pw=${pw}&ph=${ph}&son=${sound}`,
        game,
      });
      const bad = [];
      try {
        await page.waitForSelector("#screen", { timeout: 20000 });
        await page.waitForSelector(".n3-pave", { timeout: 8000 });
        await sleep(900);
        await page.screenshot({ path: join(OUT, `salle-${name}-${size}.png`) });
        bad.push(...(await page.evaluate(etat)));
        const openers = await page.evaluate((s) => document.querySelectorAll(s).length, OPENER);
        if (openers !== 1) bad.push(`${openers} boutons « ••• » trouvés, 1 attendu`);
        const opener = await page.evaluate(boite, OPENER);
        bad.push(...dansLaZone("le « ••• »", opener, zone, width, height));
        if (opener && sound !== "running" && !opener.alerte) bad.push("le son est coupé et le « ••• » ne le dit pas");
        if (opener && sound === "running" && opener.alerte) bad.push("le son joue et le « ••• » s'alerte");
        if (opener) {
          await tap(page, OPENER);
          if (!(await attendre(page, () => document.querySelector("#feuilleDuBas")?.open === true)))
            bad.push("le « ••• » n'ouvre pas la feuille du bas");
          else {
            await sleep(350);
            await page.screenshot({ path: join(OUT, `feuille-${name}-${size}.png`) });
            const entries = await page.evaluate(ENTRIES);
            const wanted = ["son", "menu", "salle", "manette", "signaler"];
            for (const one of wanted) if (!entries.includes(one)) bad.push(`la feuille n'a pas l'entrée « ${one} »`);
            if (!entries.includes("plein-ecran") && !entries.includes("ecran-accueil"))
              bad.push("la feuille n'a ni plein écran ni écran d'accueil");
            for (const one of entries)
              bad.push(...dansLaZone(`l'entrée « ${one} »`, await page.evaluate(boite, `[data-entree="${one}"]`), zone, width, height));
            bad.push(...(await page.evaluate(etat)));
            const son = await page.evaluate(boite, '[data-entree="son"]');
            if (son && sound !== "running" && !son.alerte) bad.push("le son est coupé et la feuille ne le dit pas");
            // Le menu du jeu, depuis la feuille, puis retour à la feuille.
            if (name === "gc") {
              await tap(page, '[data-entree="menu"]');
              if (!(await attendre(page, () => document.querySelector("#menu")?.open === true)))
                bad.push("« Menu du jeu » n'ouvre pas le menu");
              else {
                await sleep(300);
                if (await page.$("#feuilleDuBas")) bad.push("la feuille reste ouverte sous le menu");
                await page.evaluate(() => document.querySelector("#closeMenu")?.click());
                await attendre(page, () => document.querySelector("#menu") === null);
              }
              await tap(page, OPENER);
              await attendre(page, () => document.querySelector("#feuilleDuBas")?.open === true);
              await sleep(300);
            }
            // La salle, depuis la feuille.
            await tap(page, '[data-entree="salle"]');
            if (!(await attendre(page, () => document.querySelector("#tiroir")?.open === true)))
              bad.push("« la salle » n'ouvre pas le tiroir");
            else {
              await sleep(350);
              await page.screenshot({ path: join(OUT, `tiroir-${name}-${size}.png`) });
              if (await page.$(".n3-pave")) bad.push("la manette à l'écran reste montée sous le tiroir");
              const side = await page.evaluate(() => {
                const el = document.querySelector("#side");
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { left: r.left, right: r.right, scroll: el.scrollWidth, client: el.clientWidth };
              });
              if (!side) bad.push("le tiroir n'a pas la colonne (#side)");
              else {
                if (side.left < -0.5 || side.right > width + 0.5)
                  bad.push(`le tiroir sort de l'écran : ${Math.round(side.left)} à ${Math.round(side.right)}`);
                if (side.scroll > side.client + 1) bad.push(`le tiroir défile en largeur : ${side.scroll} pour ${side.client}`);
              }
              for (const [label, selector] of Object.entries(DRAWER_MUST)) {
                await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "center" }), selector);
                await sleep(60);
                const b = await page.evaluate(boite, selector);
                const floor = selector.includes("summary") || selector.includes("section") || selector === "#ports" ? 0 : FLOOR;
                bad.push(...dansLaZone(label, b, zone, width, height, floor));
              }
              bad.push(...(await page.evaluate(etat)));
              await tap(page, "#foldColumn");
              if (!(await attendre(page, () => document.querySelector("#tiroir")?.open !== true)))
                bad.push("« fermer » ne ferme pas le tiroir");
              else if (!(await attendre(page, () => document.querySelector(".n3-pave") !== null)))
                bad.push("la manette ne revient pas quand le tiroir se ferme");
            }
          }
        }
      } catch (error) {
        bad.push(`le parcours s'arrête : ${error.message}`);
      }
      bad.push(...errors.map((e) => `erreur de page : ${e}`));
      say(bad.length === 0, `salle ${what}`, bad);
      await page.close();
    }
  }

  // Le plein écran sans API, comme sur un iPhone, et son jumeau.
  for (const [width, height] of part("plein-ecran")
    ? [
        [390, 844],
        [844, 390],
      ]
    : []) {
    for (const sansApi of [true, false]) {
      const what = `plein écran ${sansApi ? "absent (iPhone)" : "présent"} ${width}x${height}`;
      const { page, errors } = await ouvrir({
        width,
        height,
        url: `${BASE}/r/1/?entrer=jouer`,
        avant: sansApi
          ? () => {
              // Les deux noms: Chrome porte aussi la forme préfixée, qu'un
              // iPhone n'a pas non plus.
              delete Element.prototype.requestFullscreen;
              delete Element.prototype.webkitRequestFullscreen;
              delete Element.prototype.webkitRequestFullScreen;
              delete Document.prototype.exitFullscreen;
              delete Document.prototype.webkitExitFullscreen;
              for (const name of ["fullscreenEnabled", "webkitFullscreenEnabled"])
                Object.defineProperty(Document.prototype, name, { get: () => undefined, configurable: true });
            }
          : null,
      });
      const bad = [];
      try {
        await page.waitForSelector(OPENER, { timeout: 20000 });
        await sleep(600);
        await tap(page, OPENER);
        await attendre(page, () => document.querySelector("#feuilleDuBas")?.open === true);
        await sleep(300);
        const entries = await page.evaluate(ENTRIES);
        const wanted = sansApi ? "ecran-accueil" : "plein-ecran";
        const unwanted = sansApi ? "plein-ecran" : "ecran-accueil";
        if (!entries.includes(wanted)) bad.push(`pas d'entrée « ${wanted} »`);
        if (entries.includes(unwanted)) bad.push(`une entrée « ${unwanted} » qui ne tiendra pas`);
        if (entries.includes(wanted)) {
          await tap(page, `[data-entree="${wanted}"]`);
          await sleep(400);
          if (sansApi && !(await page.$("#aideEcranAccueil"))) bad.push("l'écran d'accueil ne dit pas comment faire");
          await page.screenshot({ path: join(OUT, `plein-ecran-${sansApi ? "iphone" : "api"}-${width}x${height}.png`) });
        }
      } catch (error) {
        bad.push(`le parcours s'arrête : ${error.message}`);
      }
      bad.push(...errors.map((e) => `erreur de page : ${e}`));
      say(bad.length === 0, what, bad);
      await page.close();
    }
  }

  // L'aide de liaison, sur l'image et dans le tiroir (E2).
  for (const [width, height] of part("liaison")
    ? [
        [390, 844],
        [844, 390],
      ]
    : []) {
    const { page, errors } = await ouvrir({ width, height, url: `${BASE}/r/1/?entrer=jouer&liaison=irreguliere` });
    const bad = [];
    try {
      await page.waitForSelector("#rough", { timeout: 20000 });
      await sleep(700);
      await page.screenshot({ path: join(OUT, `liaison-${width}x${height}.png`) });
      for (const s of ["#takeHalf", "#keepFull"]) {
        const b = await page.evaluate(boite, s);
        if (!b?.hit) bad.push(`${s} ne reçoit pas son appui : ${b?.who ?? "absent"}`);
      }
    } catch (error) {
      bad.push(`la proposition de format réduit ne se montre pas : ${error.message}`);
    }
    bad.push(...errors.map((e) => `erreur de page : ${e}`));
    say(bad.length === 0, `aide de liaison visible ${width}x${height}`, bad);
    await page.close();
  }

  // Sous un écran qui couvre l'image (salle au repos, rideau d'une arrivée
  // qui n'aboutit pas), le tiroir reste joignable : le « ••• » passe dessus.
  for (const [what, game, liaison] of [
    ["salle au repos", null, "ok"],
    ["rideau d'arrivée", 0, "injoignable"],
  ]) {
    for (const [width, height] of part("voile")
      ? [
          [390, 844],
          [844, 390],
        ]
      : []) {
      const { page, errors, zone } = await ouvrir({
        width,
        height,
        url: `${BASE}/r/1/?entrer=jouer&liaison=${liaison}`,
        game,
      });
      const bad = [];
      try {
        // Une salle au repos ouvre le menu d'elle-même : on le referme pour
        // voir l'écran du repos.
        if (game === null) {
          await page.waitForSelector("#menu", { timeout: 20000 });
          await sleep(400);
          await page.evaluate(() => document.querySelector("#closeMenu")?.click());
        }
        await page.waitForSelector(game === null ? "#idle-room" : "#arrivee", { timeout: 20000 });
        await sleep(700);
        bad.push(...dansLaZone("le « ••• »", await page.evaluate(boite, OPENER), zone, width, height));
        if (await page.$(".n3-pave")) bad.push("la manette reste montée sous l'écran qui couvre l'image");
        await tap(page, OPENER);
        if (!(await attendre(page, () => document.querySelector("#feuilleDuBas")?.open === true)))
          bad.push("le « ••• » n'ouvre pas la feuille");
        else {
          await sleep(300);
          await tap(page, '[data-entree="salle"]');
          if (!(await attendre(page, () => document.querySelector("#tiroir")?.open === true)))
            bad.push("« la salle » n'ouvre pas le tiroir");
          else {
            await sleep(300);
            await page.screenshot({ path: join(OUT, `voile-${game === null ? "repos" : "rideau"}-${width}x${height}.png`) });
            for (const s of ["#leaveRoom", "#complain"]) {
              await page.evaluate((one) => document.querySelector(one)?.scrollIntoView({ block: "center" }), s);
              await sleep(60);
              bad.push(...dansLaZone(s, await page.evaluate(boite, s), zone, width, height));
            }
          }
        }
      } catch (error) {
        bad.push(`le parcours s'arrête : ${error.message}`);
      }
      bad.push(...errors.map((e) => `erreur de page : ${e}`));
      say(bad.length === 0, `${what} ${width}x${height} : le tiroir reste joignable`, bad);
      await page.close();
    }
  }

  // L'entrée de la salle (M9) : son haut reste dans l'écran.
  for (const [width, height] of part("entree") ? [...SIZES, [667, 375]] : []) {
    const { page, errors, zone } = await ouvrir({ width, height, url: `${BASE}/r/1/` });
    const bad = [];
    try {
      await page.waitForSelector("#enter", { timeout: 20000 });
      await sleep(700);
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(100);
      await page.screenshot({ path: join(OUT, `entree-${width}x${height}.png`) });
      for (const s of ["#toRooms", "#rename"]) {
        const b = await page.evaluate(boite, s);
        if (b && b.top < zone.top - 0.5) bad.push(`${s} commence à ${Math.round(b.top)} px, au-dessus du bord`);
      }
      bad.push(...(await page.evaluate(etat)));
    } catch (error) {
      bad.push(`l'entrée ne se montre pas : ${error.message}`);
    }
    bad.push(...errors.map((e) => `erreur de page : ${e}`));
    say(bad.length === 0, `entrée de la salle ${width}x${height}`, bad);
    await page.close();
  }

  // Le réglage des touches en paysage (M11).
  for (const [width, height] of part("touches")
    ? [
        [844, 390],
        [932, 430],
        [390, 844],
      ]
    : []) {
    const { page, errors } = await ouvrir({ width, height, url: `${BASE}/bindings-preview.html` });
    const bad = [];
    try {
      await page.waitForSelector(".n3-bindings[open]", { timeout: 20000 });
      await sleep(700);
      await page.screenshot({ path: join(OUT, `touches-${width}x${height}.png`) });
      const m = await page.evaluate(() => {
        // Un objet simple : un DOMRect revient vide de `evaluate`, ses
        // champs vivent sur son prototype.
        const box = (s) => {
          const r = document.querySelector(s)?.getBoundingClientRect();
          return r ? { width: r.width, height: r.height } : null;
        };
        return {
          dialog: box(".n3-bindings"),
          header: box(".n3-bindings-header"),
          content: box(".n3-bindings-content"),
          close: box(".n3-bindings .n3-close"),
        };
      });
      if (!m.dialog || m.dialog.height < height - 1) bad.push(`le panneau fait ${Math.round(m.dialog?.height ?? 0)} px de haut sur ${height}`);
      if (m.header && m.header.height > height * 0.3) bad.push(`l'en-tête prend ${Math.round(m.header.height)} px sur ${height}`);
      if (!m.content || m.content.height < height * 0.4) bad.push(`le contenu n'a que ${Math.round(m.content?.height ?? 0)} px de haut`);
      if (!m.close || Math.min(m.close.width, m.close.height) < FLOOR - 0.5)
        bad.push(`fermer mesure ${Math.round(m.close?.width ?? 0)}x${Math.round(m.close?.height ?? 0)} px`);
    } catch (error) {
      bad.push(`le réglage des touches ne s'ouvre pas : ${error.message}`);
    }
    bad.push(...errors.map((e) => `erreur de page : ${e}`));
    say(bad.length === 0, `réglage des touches ${width}x${height}`, bad);
    await page.close();
  }

  // La première image de la page construite suit le thème choisi.
  if (part("theme")) {
    const built = readFileSync(BUILT, "utf8");
    const bad = [];
    for (const [choisi, systeme, attendu] of [
      ["nuit", "light", "#15171b"],
      ["jour", "dark", "#f2f3f5"],
    ]) {
      for (let essai = 0; essai < 4; essai++) {
        const { page } = await ouvrir({
          width: 390,
          height: 844,
          url: `${BASE}/construite/r/1/`,
          built,
          stockage: { "nel3ab:theme": choisi },
          // Lu quand le corps commence, c'est-à-dire au plus tôt où le
          // navigateur peut peindre : le script de la page est un module, lancé
          // seulement après la lecture de tout le document. Le premier rappel
          // d'image ne suffisait pas ici : il tombait après le module, et la
          // page d'avant passait (essai du 22 novembre 2026).
          avant: () => {
            const watch = new MutationObserver(() => {
              if (!document.getElementById("root")) return;
              watch.disconnect();
              window.__premiere = getComputedStyle(document.documentElement).getPropertyValue("--fond").trim();
            });
            watch.observe(document, { childList: true, subtree: true });
          },
        });
        await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: systeme }]);
        await page.reload({ waitUntil: "domcontentloaded" });
        await attendre(page, () => window.__premiere !== undefined);
        const vu = await page.evaluate(() => window.__premiere);
        if (vu !== attendu) bad.push(`« ${choisi} » sous un système ${systeme} : première image en ${vu || "rien"}, ${attendu} attendu`);
        await page.close();
      }
    }
    say(bad.length === 0, `la première image suit le thème choisi (${BUILT.replace(REPO + "/", "")})`, bad);
  }

  // À la souris, sur un grand écran : la colonne à côté de l'image.
  if (part("pc")) {
    const { page, errors } = await ouvrir({ width: 1440, height: 900, coarse: false, url: `${BASE}/r/1/?entrer=jouer` });
    const bad = [];
    try {
      await page.waitForSelector("#side", { timeout: 20000 });
      await sleep(700);
      await page.screenshot({ path: join(OUT, "salle-pc-1440x900.png") });
      if (await page.$(OPENER)) bad.push("un « ••• » sur un grand écran à la souris");
      if (await page.evaluate(() => document.querySelector("#side")?.closest("dialog") !== null))
        bad.push("la colonne est dans un tiroir sur un grand écran");
      bad.push(...(await page.evaluate(etat)));
    } catch (error) {
      bad.push(`la salle ne s'ouvre pas : ${error.message}`);
    }
    bad.push(...errors.map((e) => `erreur de page : ${e}`));
    say(bad.length === 0, "grand écran 1440x900 : la colonne reste à côté", bad);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
  rmSync(cache, { recursive: true, force: true });
}

console.log(`captures dans ${OUT}`);
if (failures.length) {
  console.log(`RATÉ  ${failures.length} cas`);
  process.exit(1);
}
console.log("ok    la salle tient sur téléphone et tablette");
