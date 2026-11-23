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
// Ajouté après la relecture du 22 novembre 2026, chaque cas vu rouge sur
// l'arbre d'avant (fbb3bcc) :
//
//  11. TOUTES les cibles visibles du tiroir font 44 px (bouton, champ, liste,
//      résumé, lien), sauf une exception nommée ; le bouton qui le ferme reste
//      joignable une fois le tiroir défilé jusqu'à « quitter » ; tenu droit
//      sous 480 px, il couvre toute la largeur ;
//  12. le focus revient au « ••• » quand la feuille ou le tiroir se ferme ;
//  13. un grand écran à la souris, manette à l'écran « toujours » : « La
//      salle » déplie la colonne et garde la manette, au lieu de tout cacher ;
//  14. Ctrl sous le menu ouvre le tiroir SANS l'empiler sur le menu ;
//  15. une page « manette seule » garde sa manette pendant un chargement
//      annoncé par le salon, et son jumeau (avec l'image) montre l'écran de
//      chargement ;
//  16. la demande de place et la reprise de la salle ne passent ni sous le
//      « ••• » ni sous l'encoche ;
//  17. le fond du menu va jusqu'aux bords ;
//  18. le configurateur Pro (Switch, Xbox 360) et la préparation d'une partie
//      prennent tout l'écran tenu en travers ;
//  19. la page construite est servie avec la politique du worker (une
//      empreinte par script) et n'en viole aucune, et son jumeau (une
//      empreinte oubliée) est vu.
//
// Le salon est simulé par une fausse socket (`salon: true`), qui répond à la
// poignée de main d'engine.io et laisse la garde envoyer un événement : une
// annonce de chargement, une demande de place, une reprise. Elle ne sort pas
// du navigateur.
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
import { createHash } from "node:crypto";
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
// SEUL=salle,plein-ecran,liaison,voile,entree,touches,theme,pc,toujours,ctrl,
// manette-seule,demande.
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
  // Le curseur quand le son joue, le bouton qui l'allume sinon.
  "le son": "#side input[type='range'], #sound",
  quitter: "#leaveRoom",
  "fermer le tiroir": "#foldColumn",
};

const CONTENEURS = ["#ports", "section[aria-label='spectateurs']"];
/** Ce que la mesure des 44 px laisse de côté, chacun avec sa raison. */
const EXCEPTIONS_DU_TIROIR = [];

/** Les cibles visibles d'un calque plus petites que `floor`, sauf exception
 * nommée. Une cible hors de l'écran compte aussi : sa taille ne dépend pas du
 * défilement. */
function petites({ racine, floor, exceptions }) {
  const top = document.querySelector(racine);
  if (!top) return [`${racine} absent`];
  const shown = (el) => {
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const label = (el) =>
    el.id || el.getAttribute("aria-label") || el.dataset.entree || el.textContent.trim().slice(0, 28) || el.tagName;
  const bad = [];
  for (const el of top.querySelectorAll("button, a[href], input:not([type='hidden']), select, summary")) {
    if (!shown(el)) continue;
    if (exceptions.some((one) => el.matches(one))) continue;
    const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) < floor - 0.5)
      bad.push(`${el.tagName.toLowerCase()} « ${label(el)} » mesure ${Math.round(r.width)}x${Math.round(r.height)} px`);
  }
  return bad;
}

/** Les empreintes des scripts de la page, calculées comme le worker
 * (`script_policy`, core/crates/transport/src/browser/page.rs) : le contenu de
 * chaque `<script ...>` jusqu'à son `</script>`. */
function empreintes(page) {
  const out = [];
  let rest = page;
  for (;;) {
    const open = rest.indexOf("<script");
    if (open < 0) break;
    const head = rest.indexOf(">", open);
    if (head < 0) break;
    const close = rest.indexOf("</script>", head + 1);
    if (close < 0) break;
    out.push(`'sha256-${createHash("sha256").update(rest.slice(head + 1, close), "utf8").digest("base64")}'`);
    rest = rest.slice(close);
  }
  return out;
}
/** La politique du worker (`policy_headers`), avec ces empreintes. */
const politiqueDe = (scripts) =>
  `default-src 'self'; script-src 'self' ${scripts.join(" ")}; style-src 'self' 'unsafe-inline'; ` +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'";

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
async function ouvrir({
  width,
  height,
  coarse = true,
  url,
  game = 0,
  stockage = {},
  avant = null,
  built = null,
  salon = false,
  politique = null,
}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: coarse, hasTouch: coarse, deviceScaleFactor: 2 });
  if (coarse) await page.setUserAgent(IPHONE);
  const zone = coarse ? zoneOf(width, height) : { top: 0, right: 0, bottom: 0, left: 0 };
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: zone });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluateOnNewDocument(
    (stockage, salon) => {
      class Muette {
        constructor(url) {
          this.url = url;
          this.readyState = 0;
          this.binaryType = "blob";
          this.bufferedAmount = 0;
          // Le faux salon : la poignée de main d'engine.io (« 0 » puis « 40 »),
          // et `window.__salon.emit` pour qu'un cas envoie un événement à la
          // page. Rien d'autre ne lui répond ; aucune requête ne part.
          if (salon && String(url).includes("/socket.io/")) {
            window.__salon = this;
            setTimeout(() => {
              this.readyState = 1;
              this.onopen?.({});
              this.onmessage?.({
                data: '0{"sid":"banc","upgrades":[],"pingInterval":25000,"pingTimeout":60000,"maxPayload":1000000}',
              });
            }, 30);
          }
        }
        send(data) {
          if (this !== window.__salon || typeof data !== "string") return;
          // La réponse au « 40 » part APRÈS l'envoi, comme d'un vrai serveur :
          // rendue pendant `send`, elle arrivait avant que le client soit prêt
          // à l'entendre, et la socket ne passait jamais « connectée ».
          if (data.startsWith("40"))
            setTimeout(() => {
              this.onmessage?.({ data: '40{"sid":"banc-salon"}' });
              window.__salonConnecte = this === window.__salon;
            }, 0);
        }
        emit(name, payload) {
          this.onmessage?.({ data: `42${JSON.stringify([name, payload])}` });
        }
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
    salon,
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
    if (built && p === "/construite/r/1/")
      return req.respond({
        status: 200,
        contentType: "text/html",
        headers: politique ? { "Content-Security-Policy": politique } : {},
        body: built,
      });
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

/** Le focus, rendu après la fermeture d'une couche : au « ••• » qui l'a
 * ouverte, ou au jeu qui l'avait avant. Jamais au document, d'où un lecteur
 * d'écran repart du début de la page (WCAG 2.4.3). */
const focusRendu = (opener) => {
  const ici = document.activeElement;
  return ici !== null && ici !== document.body && (ici.matches(opener) || ici.closest("[data-zone-jeu]") !== null);
};

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
            // Échap ferme la feuille, et le focus revient au « ••• » : celui de
            // la manette est démonté pendant qu'elle est ouverte.
            if (name === "gc") {
              await page.keyboard.press("Escape");
              if (!(await attendre(page, () => document.querySelector("#feuilleDuBas") === null)))
                bad.push("Échap ne ferme pas la feuille");
              else if (!(await attendre(page, focusRendu, OPENER, 1500)))
                bad.push(
                  `la feuille fermée, le focus est sur ${await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)}, ni sur le « ••• » ni sur le jeu`,
                );
              await tap(page, OPENER);
              await attendre(page, () => document.querySelector("#feuilleDuBas")?.open === true);
              await sleep(300);
            }
            // Le menu du jeu, depuis la feuille, puis retour à la feuille.
            if (name === "gc") {
              await tap(page, '[data-entree="menu"]');
              if (!(await attendre(page, () => document.querySelector("#menu")?.open === true)))
                bad.push("« Menu du jeu » n'ouvre pas le menu");
              else {
                await sleep(300);
                await page.screenshot({ path: join(OUT, `menu-${name}-${size}.png`) });
                if (await page.$("#feuilleDuBas")) bad.push("la feuille reste ouverte sous le menu");
                // Le fond du menu va jusqu'aux bords : posé dans la zone sûre,
                // il laissait une bande de fond uni sous l'encoche.
                const fond = await page.evaluate(() => {
                  const r = document
                    .querySelector("#menu .pointer-events-none.absolute.inset-0.overflow-hidden")
                    ?.getBoundingClientRect();
                  return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
                });
                if (!fond) bad.push("le fond du menu est absent");
                else if (fond.left > 0.5 || fond.top > 0.5 || fond.right < width - 0.5 || fond.bottom < height - 0.5)
                  bad.push(
                    `le fond du menu s'arrête à [${Math.round(fond.left)}, ${Math.round(fond.top)}, ${Math.round(fond.right)}, ${Math.round(fond.bottom)}] dans ${width}x${height}`,
                  );
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
                // Tenu droit sous 480 px, une bande de jeu assombri à gauche
                // n'est ni l'image ni le tiroir : il prend toute la largeur.
                if (height > width && width <= 480 && side.left > 0.5)
                  bad.push(`le tiroir laisse ${Math.round(side.left)} px à sa gauche, tenu droit`);
              }
              bad.push(...(await page.evaluate(petites, { racine: "#tiroir", floor: FLOOR, exceptions: EXCEPTIONS_DU_TIROIR })));
              for (const [label, selector] of Object.entries(DRAWER_MUST)) {
                await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "center" }), selector);
                await sleep(60);
                const b = await page.evaluate(boite, selector);
                // Deux conteneurs et pas des cibles : la rangée des places et la
                // section des spectateurs se mesurent par leurs boutons (`petites`).
                const floor = CONTENEURS.includes(selector) ? 0 : FLOOR;
                bad.push(...dansLaZone(label, b, zone, width, height, floor));
              }
              // Descendu jusqu'à « quitter », le bouton qui referme reste là :
              // il défilait avec le contenu, et le tiroir tenu droit n'a pas
              // de fond où toucher.
              await page.evaluate(() => {
                document.querySelector("#leaveRoom")?.scrollIntoView({ block: "end" });
                const aside = document.querySelector("#side");
                if (aside) aside.scrollTop = aside.scrollHeight;
              });
              await sleep(120);
              await page.screenshot({ path: join(OUT, `tiroir-bas-${name}-${size}.png`) });
              bad.push(
                ...dansLaZone("fermer, tiroir défilé jusqu'en bas", await page.evaluate(boite, "#foldColumn"), zone, width, height),
              );
              await page.evaluate(() => {
                const aside = document.querySelector("#side");
                if (aside) aside.scrollTop = 0;
              });
              await sleep(120);
              bad.push(...(await page.evaluate(etat)));
              await tap(page, "#foldColumn");
              if (!(await attendre(page, () => document.querySelector("#tiroir")?.open !== true)))
                bad.push("« fermer » ne ferme pas le tiroir");
              else if (!(await attendre(page, () => document.querySelector(".n3-pave") !== null)))
                bad.push("la manette ne revient pas quand le tiroir se ferme");
              else if (!(await attendre(page, focusRendu, OPENER, 1500)))
                bad.push(
                  `le tiroir fermé, le focus est sur ${await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)}, ni sur le « ••• » ni sur le jeu`,
                );
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
        // Absent, il ne prouve rien : la mesure passait sans rien mesurer.
        if (!b) bad.push(`${s} est absent de l'entrée`);
        else if (b.top < zone.top - 0.5) bad.push(`${s} commence à ${Math.round(b.top)} px, au-dessus du bord`);
      }
      // Le bouton principal tient dans l'écran sans défiler. En paysage bas,
      // « Rejoindre » tombait sous le pli, à 393-438 px pour 390 de haut
      // (vérification finale du 22 novembre 2026). Le jumeau est la mesure du
      // haut juste au-dessus : resserrer ne doit pas couper le haut.
      const entrer = await page.evaluate(boite, "#enter");
      const hauteur = await page.evaluate(() => innerHeight);
      if (!entrer) bad.push("#enter est absent de l'entrée");
      else if (entrer.bottom > hauteur + 0.5)
        bad.push(`#enter finit à ${Math.round(entrer.bottom)} px, sous le bas de l'écran (${hauteur} px)`);
      bad.push(...(await page.evaluate(etat)));
    } catch (error) {
      bad.push(`l'entrée ne se montre pas : ${error.message}`);
    }
    bad.push(...errors.map((e) => `erreur de page : ${e}`));
    say(bad.length === 0, `entrée de la salle ${width}x${height}`, bad);
    await page.close();
  }

  // Le réglage des touches en paysage (M11) : le panneau de la GameCube et de
  // la Wii, celui d'une préparation, et le configurateur Pro (Switch, Xbox
  // 360), seul et pendant une préparation.
  const PANNEAUX = {
    touches: {
      url: "bindings-preview.html",
      dialog: ".n3-bindings",
      header: ".n3-bindings-header",
      content: ".n3-bindings-content",
      close: ".n3-bindings .n3-close",
    },
    preparation: {
      url: "bindings-preview.html?preparation",
      dialog: ".n3-bindings",
      header: ".n3-bindings-header",
      content: ".n3-bindings-scroll",
      close: null,
    },
    pro: {
      url: "bindings-preview.html?pro=switch",
      dialog: ".n3-switch-setup",
      header: ".n3-switch-setup > header",
      content: ".n3-switch-body",
      close: ".n3-switch-setup > header button",
    },
    "pro-preparation": {
      url: "bindings-preview.html?pro=x360&preparation",
      dialog: ".n3-switch-setup",
      header: ".n3-switch-setup > header",
      content: ".n3-switch-body",
      close: null,
    },
  };
  for (const [width, height] of part("touches")
    ? [
        [844, 390],
        [932, 430],
        [390, 844],
      ]
    : []) {
    for (const [nom, panneau] of Object.entries(PANNEAUX)) {
      // Tenu droit, seul le panneau des touches était mesuré: les autres y
      // prennent déjà tout l'écran par leur propre règle.
      if (height > width && nom !== "touches") continue;
      const { page, errors } = await ouvrir({ width, height, url: `${BASE}/${panneau.url}` });
      const bad = [];
      try {
        await page.waitForSelector(`${panneau.dialog}[open]`, { timeout: 20000 });
        await sleep(700);
        await page.screenshot({ path: join(OUT, `${nom}-${width}x${height}.png`) });
        const m = await page.evaluate((panneau) => {
          // Un objet simple : un DOMRect revient vide de `evaluate`, ses
          // champs vivent sur son prototype.
          const box = (s) => {
            const r = s ? document.querySelector(s)?.getBoundingClientRect() : null;
            return r ? { width: r.width, height: r.height } : null;
          };
          return {
            dialog: box(panneau.dialog),
            header: box(panneau.header),
            content: box(panneau.content),
            close: box(panneau.close),
          };
        }, panneau);
        if (!m.dialog || m.dialog.height < height - 1)
          bad.push(`le panneau fait ${Math.round(m.dialog?.height ?? 0)} px de haut sur ${height}`);
        if (!m.dialog || m.dialog.width < width - 1)
          bad.push(`le panneau fait ${Math.round(m.dialog?.width ?? 0)} px de large sur ${width}`);
        if (!m.header) bad.push(`${panneau.header} est absent`);
        else if (m.header.height > height * 0.3) bad.push(`l'en-tête prend ${Math.round(m.header.height)} px sur ${height}`);
        if (!m.content || m.content.height < height * 0.4) bad.push(`le contenu n'a que ${Math.round(m.content?.height ?? 0)} px de haut`);
        if (panneau.close && (!m.close || Math.min(m.close.width, m.close.height) < FLOOR - 0.5))
          bad.push(`fermer mesure ${Math.round(m.close?.width ?? 0)}x${Math.round(m.close?.height ?? 0)} px`);
      } catch (error) {
        bad.push(`le panneau ne s'ouvre pas : ${error.message}`);
      }
      bad.push(...errors.map((e) => `erreur de page : ${e}`));
      say(bad.length === 0, `réglage « ${nom} » ${width}x${height}`, bad);
      await page.close();
    }
  }

  // La première image de la page construite suit le thème choisi, servie avec
  // la politique du worker : un script de l'en-tête que la politique
  // bloquerait ne poserait rien, et la page sans politique ne le verrait pas.
  if (part("theme")) {
    const built = readFileSync(BUILT, "utf8");
    const scripts = empreintes(built);
    const bad = [];
    if (scripts.length < 2) bad.push(`${scripts.length} script trouvé dans la page construite, 2 au moins attendus`);
    const ouvrirConstruite = (choisi, politique) =>
      ouvrir({
        width: 390,
        height: 844,
        url: `${BASE}/construite/r/1/`,
        built,
        politique,
        stockage: { "nel3ab:theme": choisi },
        // Lu quand le corps commence, c'est-à-dire au plus tôt où le
        // navigateur peut peindre : le script de la page est un module, lancé
        // seulement après la lecture de tout le document. Le premier rappel
        // d'image ne suffisait pas ici : il tombait après le module, et la
        // page d'avant passait (essai du 22 novembre 2026).
        avant: () => {
          window.__violations = [];
          document.addEventListener("securitypolicyviolation", (event) =>
            window.__violations.push(`${event.effectiveDirective} ${event.blockedURI}`),
          );
          const watch = new MutationObserver(() => {
            if (!document.getElementById("root")) return;
            watch.disconnect();
            window.__premiere = getComputedStyle(document.documentElement).getPropertyValue("--fond").trim();
          });
          watch.observe(document, { childList: true, subtree: true });
        },
      });
    for (const [choisi, systeme, attendu] of [
      ["nuit", "light", "#0c0e1a"],
      ["jour", "dark", "#dfe6f2"],
    ]) {
      for (let essai = 0; essai < 4; essai++) {
        const { page } = await ouvrirConstruite(choisi, politiqueDe(scripts));
        await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: systeme }]);
        await page.reload({ waitUntil: "domcontentloaded" });
        await attendre(page, () => window.__premiere !== undefined);
        await sleep(300);
        const vu = await page.evaluate(() => window.__premiere);
        if (vu !== attendu) bad.push(`« ${choisi} » sous un système ${systeme} : première image en ${vu || "rien"}, ${attendu} attendu`);
        const refus = await page.evaluate(() => window.__violations);
        if (refus.length) bad.push(`la politique du worker refuse : ${refus.join(" ; ")}`);
        await page.close();
      }
    }
    say(bad.length === 0, `la première image suit le thème choisi, sous la politique du worker (${BUILT.replace(REPO + "/", "")})`, bad);
    // Le jumeau : une empreinte oubliée doit se voir, sinon l'écoute ne prouve rien.
    {
      const { page } = await ouvrirConstruite("nuit", politiqueDe(scripts.slice(1)));
      await page.reload({ waitUntil: "domcontentloaded" });
      await attendre(page, () => window.__violations?.length > 0, null, 4000);
      const refus = await page.evaluate(() => window.__violations);
      say(refus.length > 0, "jumeau : une politique qui oublie l'empreinte du premier script est vue", [
        `refus vus : ${refus.join(" ; ") || "aucun"}`,
      ]);
      await page.close();
    }
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

  // 13. Un grand écran à la souris, la manette à l'écran réglée sur
  // « toujours » : son « ••• » ouvre la feuille, et « La salle » n'a pas de
  // tiroir à ouvrir. Elle démontait la manette et ne montrait rien.
  for (const bare of part("toujours") ? ["1", "0"] : []) {
    const what = `grand écran, manette « toujours », colonne ${bare === "1" ? "repliée" : "dépliée"}`;
    const { page, errors } = await ouvrir({
      width: 1440,
      height: 900,
      coarse: false,
      url: `${BASE}/r/1/?entrer=jouer`,
      stockage: { "nel3ab:touchpad": "on", "nel3ab:bare": bare },
    });
    const bad = [];
    try {
      await page.waitForSelector(".n3-pave", { timeout: 20000 });
      await sleep(700);
      await page.click(OPENER);
      if (!(await attendre(page, () => document.querySelector("#feuilleDuBas")?.open === true)))
        bad.push("le « ••• » n'ouvre pas la feuille");
      else {
        await sleep(300);
        await page.click('[data-entree="salle"]');
        await sleep(800);
        const vu = await page.evaluate(() => {
          const side = document.querySelector("#side");
          const r = side?.getBoundingClientRect();
          return {
            side: side ? { width: r.width, tiroir: side.closest("dialog") !== null } : null,
            pave: document.querySelector(".n3-pave") !== null,
            ouverts: [...document.querySelectorAll("dialog[open]")].map((d) => d.id),
          };
        });
        await page.screenshot({ path: join(OUT, `toujours-1440x900-bare${bare}.png`) });
        if (!vu.side || vu.side.width < 100) bad.push("« La salle » ne montre pas la colonne");
        else if (vu.side.tiroir) bad.push("la colonne d'un grand écran est dans un tiroir");
        if (!vu.pave) bad.push("la manette à l'écran a disparu");
        if (vu.ouverts.length) bad.push(`un dialogue reste ouvert : ${vu.ouverts.join(", ")}`);
      }
    } catch (error) {
      bad.push(`le parcours s'arrête : ${error.message}`);
    }
    bad.push(...errors.map((e) => `erreur de page : ${e}`));
    say(bad.length === 0, what, bad);
    await page.close();
  }

  // 14. Ctrl seule sous le menu, puis sous la feuille : le tiroir s'ouvre
  // SEUL. Deux dialogues modaux empilés rendaient le bouton « menu » du
  // tiroir sans effet.
  if (part("ctrl")) {
    const { page, errors } = await ouvrir({ width: 820, height: 900, coarse: false, url: `${BASE}/r/1/?entrer=jouer` });
    const bad = [];
    const ouverts = () => page.evaluate(() => [...document.querySelectorAll("dialog[open]")].map((d) => d.id).join(", "));
    const ctrl = async () => {
      await page.keyboard.down("Control");
      await page.keyboard.up("Control");
      await sleep(500);
    };
    try {
      await page.waitForSelector("#ouvrirFeuille", { timeout: 20000 });
      await sleep(700);
      await page.keyboard.press("Escape");
      if (!(await attendre(page, () => document.querySelector("#menu")?.open === true))) bad.push("Échap n'ouvre pas le menu");
      await sleep(400);
      await ctrl();
      const sousMenu = await ouverts();
      await page.screenshot({ path: join(OUT, "ctrl-sous-menu-820x900.png") });
      if (sousMenu !== "tiroir") bad.push(`Ctrl sous le menu : « ${sousMenu} » ouvert, le tiroir seul attendu`);
      // Le jumeau : Ctrl referme le tiroir, et rien ne reste.
      await ctrl();
      if ((await ouverts()) !== "") bad.push(`Ctrl ne referme pas le tiroir : « ${await ouverts()} »`);
      await page.click("#ouvrirFeuille");
      await attendre(page, () => document.querySelector("#feuilleDuBas")?.open === true);
      await sleep(300);
      await ctrl();
      const sousFeuille = await ouverts();
      if (sousFeuille !== "tiroir") bad.push(`Ctrl sous la feuille : « ${sousFeuille} » ouvert, le tiroir seul attendu`);
    } catch (error) {
      bad.push(`le parcours s'arrête : ${error.message}`);
    }
    bad.push(...errors.map((e) => `erreur de page : ${e}`));
    say(bad.length === 0, "Ctrl sous le menu et sous la feuille : le tiroir, seul", bad);
    await page.close();
  }

  // 15. Une page « manette seule » pendant un chargement annoncé par le salon.
  // Sans image, l'écran de chargement attendait une image peinte qui ne vient
  // jamais : la manette restait démontée après chaque lancement. Le jumeau,
  // avec l'image, montre l'écran de chargement et pas la manette.
  for (const padonly of part("manette-seule") ? ["oui", "non"] : []) {
    const what = padonly === "oui" ? "manette seule pendant un chargement : la manette reste" : "avec l'image pendant un chargement : l'écran de chargement";
    const { page, errors } = await ouvrir({
      width: 390,
      height: 844,
      url: `${BASE}/r/1/?entrer=jouer`,
      salon: true,
      stockage: { "nel3ab:padonly": padonly },
    });
    const bad = [];
    try {
      await page.waitForSelector(".n3-pave", { timeout: 20000 });
      if (!(await attendre(page, () => window.__salonConnecte === true, null, 6000))) bad.push("le faux salon ne se connecte pas");
      await sleep(500);
      await page.evaluate(() => window.__salon.emit("booting", { game: "Sonic Generations", save: "partie neuve" }));
      await sleep(1500);
      await page.screenshot({ path: join(OUT, `chargement-padonly-${padonly}-390x844.png`) });
      const vu = await page.evaluate(() => {
        const a = document.querySelector('[data-touche="A"]');
        let touchee = false;
        if (a) {
          const r = a.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          touchee = hit === a || a.contains(hit);
        }
        return { pave: document.querySelector(".n3-pave") !== null, chargement: document.querySelector("#booting") !== null, touchee };
      });
      if (padonly === "oui") {
        if (!vu.pave) bad.push("la manette est démontée pendant le chargement");
        else if (!vu.touchee) bad.push("la touche A ne reçoit pas son appui");
        if (vu.chargement) bad.push("un écran de chargement couvre une page sans image");
      } else {
        if (!vu.chargement) bad.push("pas d'écran de chargement : l'annonce du faux salon n'est pas arrivée");
        if (vu.pave) bad.push("la manette reste montée sous l'écran de chargement");
      }
    } catch (error) {
      bad.push(`le parcours s'arrête : ${error.message}`);
    }
    bad.push(...errors.map((e) => `erreur de page : ${e}`));
    say(bad.length === 0, what, bad);
    await page.close();
  }

  // 16. La demande de place et la reprise de la salle : ni sous le « ••• »
  // seul, ni sous l'encoche.
  for (const [width, height] of part("demande")
    ? [
        [390, 844],
        [844, 390],
      ]
    : []) {
    const { page, errors, zone } = await ouvrir({
      width,
      height,
      url: `${BASE}/r/1/?entrer=jouer`,
      salon: true,
      stockage: { "nel3ab:touchpad": "off" },
    });
    const bad = [];
    try {
      await page.waitForSelector("#ouvrirFeuille", { timeout: 20000 });
      if (!(await attendre(page, () => window.__salonConnecte === true, null, 6000))) bad.push("le faux salon ne se connecte pas");
      await sleep(400);
      await page.evaluate(() => window.__salon.emit("asked", { from: "Bo", port: 1 }));
      if (!(await attendre(page, () => document.querySelector("#asked") !== null))) bad.push("la demande de place ne se montre pas");
      else {
        await sleep(400);
        await page.screenshot({ path: join(OUT, `demande-${width}x${height}.png`) });
        const deux = await page.evaluate(() => {
          const box = (s) => {
            const r = document.querySelector(s)?.getBoundingClientRect();
            return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
          };
          return { demande: box("#asked"), plus: box("#ouvrirFeuille") };
        });
        const { demande, plus } = deux;
        if (demande && plus) {
          const w = Math.min(demande.right, plus.right) - Math.max(demande.left, plus.left);
          const h = Math.min(demande.bottom, plus.bottom) - Math.max(demande.top, plus.top);
          if (w > 0.5 && h > 0.5) bad.push(`le « ••• » mord sur la demande de place : ${Math.round(w)}x${Math.round(h)} px`);
        }
        if (demande && demande.top < zone.top - 0.5) bad.push(`la demande commence à ${Math.round(demande.top)} px, sous l'encoche`);
        bad.push(...(await page.evaluate(etat)));
        for (const s of ["#giveSeat", "#keepSeat"]) bad.push(...dansLaZone(s, await page.evaluate(boite, s), zone, width, height));
        await page.click("#keepSeat");
      }
      await page.evaluate(() =>
        window.__salon.emit("recovery", { id: "banc", port: 1, from: "Bo", to: "Ami", asking: false, remaining: 30, reason: null }),
      );
      if (!(await attendre(page, () => document.querySelector("#recovery") !== null))) bad.push("la reprise de la salle ne se montre pas");
      else {
        await sleep(300);
        await page.screenshot({ path: join(OUT, `reprise-${width}x${height}.png`) });
        const r = await page.evaluate(boite, "#recovery");
        if (r && (r.top < zone.top - 0.5 || r.left < zone.left - 0.5 || r.right > width - zone.right + 0.5))
          bad.push(`la reprise sort des zones sûres : [${Math.round(r.left)}, ${Math.round(r.top)}, ${Math.round(r.right)}]`);
      }
    } catch (error) {
      bad.push(`le parcours s'arrête : ${error.message}`);
    }
    bad.push(...errors.map((e) => `erreur de page : ${e}`));
    say(bad.length === 0, `demande de place et reprise ${width}x${height}`, bad);
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
