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
//   2. un seul bouton « La salle » ouvre la feuille (dans la barre, dans la
//      bande gauche en travers, ou parmi les touches quand la barre manque) ;
//      lui et chaque entrée de la feuille tiennent dans les zones sûres, font
//      44 px au moins, et reçoivent leur appui (`elementFromPoint`) ; « Menu
//      du jeu » ouvre le menu et ferme la feuille ; aucune touche de la
//      manette ne touche l'image, et la feuille à mi-hauteur non plus ;
//   3. « Toute la salle » agrandit la même feuille, qui tient dans l'écran
//      sans défiler en largeur, et où chaque fonction de la colonne se joint :
//      les places, prendre une place précise, demander celle d'un autre,
//      signaler, le diagnostic, les spectateurs, quitter, et « Fermer » ;
//      jamais deux dialogues ouverts ;
//   4. la manette à l'écran n'est pas montée tant que la feuille est ouverte ;
//   5. sans l'API plein écran (un iPhone), aucune erreur de page, et la
//      feuille propose l'écran d'accueil ; avec elle, le plein écran ;
//   6. le son coupé se voit sur « La salle », GameCube comme Xbox 360 ;
//   7. l'entrée de la salle tient en haut de l'écran, et sous la salle au
//      repos ou le rideau d'une arrivée, la salle entière reste joignable ;
//   8. le réglage des touches prend tout l'écran en paysage, avec une vraie
//      hauteur pour son contenu et un bouton fermer de 44 px ;
//   9. sur la page CONSTRUITE (`--page`), la première image porte le thème
//      choisi contre le système, et pas celui du système ;
//  10. à 1440x900, la colonne reste à côté de l'image, sans « La salle ».
//
// Ajouté après la relecture du 22 novembre 2026, chaque cas vu rouge sur
// l'arbre d'avant (fbb3bcc) :
//
//  11. TOUTES les cibles visibles de la feuille agrandie font 44 px (bouton,
//      champ, liste, résumé, lien), sauf une exception nommée ; « Fermer »
//      reste joignable une fois la colonne défilée jusqu'à « quitter » ; tenue
//      droite sous 480 px, la feuille couvre toute la largeur ;
//  12. le focus revient à « La salle » quand la feuille se ferme ;
//  13. un grand écran à la souris, manette à l'écran « toujours » : « La
//      salle » déplie la colonne et garde la manette, au lieu de tout cacher ;
//  14. tenue en main, Ctrl sous le menu agrandit la feuille SANS l'empiler
//      sur le menu ; étroite à la souris, la colonne est sous l'image et Ctrl
//      agrandit l'image ;
//  15. une page « manette seule » garde sa manette pendant un chargement
//      annoncé par le salon, et son jumeau (avec l'image) montre l'écran de
//      chargement ;
//  16. la demande de place et la reprise de la salle ne passent ni sous « La
//      salle » ni sous l'encoche ;
//  17. le fond du menu va jusqu'aux bords ;
//  18. le configurateur Pro (Switch, Xbox 360) et la préparation d'une partie
//      prennent tout l'écran tenu en travers ;
//  19. la page construite est servie avec la politique du worker (une
//      empreinte par script) et n'en viole aucune, et son jumeau (une
//      empreinte oubliée) est vu ;
//  20. un spectateur tenu en main (qui a choisi de regarder) n'a pas de
//      manette, et « Prendre la place N » est dans la bande ; en travers, le
//      panneau est debout.
//
// Ajouté par le chantier personnes le 23 novembre 2026 :
//
//  21. la rangée des places ne touche jamais la toile, dessous, en tête de
//      colonne, debout ou en petit selon le cadre, aux trois niveaux
//      d'effets ; ses places font 44 px, ne se recouvrent pas et tiennent
//      dans le panneau ; trop étroite, elle est un seul bouton qui ouvre la
//      salle ; son jumeau, la rangée posée sur l'image, est vu ;
//  22. une page ouverte sur une salle pleine n'allume aucun « prêt ! » et
//      n'annonce personne ; puis, quand Cam s'assied, à chaque image pendant
//      2,6 s, « 3P prêt ! » ne coupe pas la toile, et le centre et les coins
//      de la toile rendent la toile ; deux jumeaux, un « prêt ! » et un
//      calque posés sur l'image ;
//  23. sur la page construite, à CPU x4, le clic sur une place libre
//      travaille moins de 50 ms ; son jumeau, un clic qui tient le
//      processeur 120 ms, est vu.
//
// Ajouté par le chantier de fin de la salle le 24 novembre 2026 :
//
//  24. couché, menu ouvert, ton étiquette posée en tête de la bande reste
//      lisible : le menu ne couvre aucune de ses lettres ; son jumeau,
//      l'étiquette poussée sous le menu, est vu.
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
//        [--port 5446]
//
// Sans `--port`, Vite prend un port libre (`port.mjs`).
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer";
import { portDemande } from "./port.mjs";

const HERE = import.meta.dirname;
const REPO = resolve(HERE, "..", "..");
const FRONT = join(REPO, "front");
const args = process.argv.slice(2);
const PORT = portDemande(args);
const pageAt = args.indexOf("--page");
const BUILT = resolve(
  pageAt >= 0 ? args[pageAt + 1] : join(REPO, "core", "crates", "worker", "src", "page", "index.html"),
);
const OUT = resolve(
  args.find((one, i) => !one.startsWith("--") && !["--page", "--port"].includes(args[i - 1])) ??
    join(tmpdir(), "salle-telephone"),
);
const FAKE = join(HERE, "salle-telephone.session.ts");
// Une partie seulement, pour travailler :
// SEUL=salle,plein-ecran,liaison,voile,entree,touches,theme,pc,toujours,ctrl,menu-etroit,
// manette-seule,manette-seule-parle,spectateur,demande,places-sous-image,arrivee,clic-court,
// arrivee-telephone,pastille,menu-etiquette.
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

const OPENER = '[data-geste="feuille"]';
const FEUILLE = "#feuilleSalle";
const AGRANDIE = '#feuilleSalle[data-hauteur="agrandie"]';
// Ce que la feuille agrandie doit porter : la colonne entière, joignable au doigt.
const DRAWER_MUST = {
  "la rangée des places": "#ports",
  "prendre une place précise (la 3, libre)": "#port3",
  "demander la place d'un autre (la 2)": "#port2",
  "prendre ou rendre sa place": "#takePad, #watchOnly",
  signaler: "#complain",
  // Les mesures de la liaison, ouvertes par la ligne du coin (23 novembre
  // 2026 : `ConnectionDiagnostic` est parti dans `Mesures`).
  "les mesures de la liaison": "#mesures",
  "les spectateurs": "section[aria-labelledby='ilsRegardent']",
  // Le curseur quand le son joue, le bouton qui l'allume sinon.
  "le son": "#side input[type='range'], #sound",
  quitter: "#leaveRoom",
  "fermer la feuille": "#fermerFeuille",
};

const CONTENEURS = ["#ports", "section[aria-labelledby='ilsRegardent']"];
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
// Le port que Vite a vraiment pris : le système le choisit sans `--port`.
const BASE = `http://127.0.0.1:${server.httpServer.address().port}`;

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
    // Le contenu d'un `<details>` replié n'est pas rendu (« Autres réglages »
    // de la colonne) : Chrome lui garde pourtant une boîte, posée sous le
    // résumé, qui se lisait comme un recouvrement.
    if (el.closest("details:not([open])") && el.tagName !== "SUMMARY") return false;
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

/** Le focus, rendu après la fermeture de la feuille : au « La salle » qui
 * l'a ouverte, ou au jeu qui l'avait avant. Jamais au document, d'où un lecteur
 * d'écran repart du début de la page (WCAG 2.4.3). */
const focusRendu = (opener) => {
  const ici = document.activeElement;
  return ici !== null && ici !== document.body && (ici.matches(opener) || ici.closest("[data-zone-jeu]") !== null);
};

const ENTRIES = () =>
  [...document.querySelectorAll("#feuilleSalle [data-entree]")].map((el) => el.dataset.entree);

/** Ce qui touche l'image : chaque pièce de la manette et chaque « La salle »,
 * comparés au rectangle de la toile. Rien n'a le droit d'y mordre (règle du
 * cadre, 23 novembre 2026). */
function surLImage() {
  const toile = document.querySelector("#screen")?.getBoundingClientRect();
  if (!toile || toile.width < 2 || toile.height < 2) return ["la toile n'a pas de taille"];
  const bad = [];
  for (const el of document.querySelectorAll(".n3-pave > *, [data-geste]")) {
    const r = el.getBoundingClientRect();
    const w = Math.min(r.right, toile.right) - Math.max(r.left, toile.left);
    const h = Math.min(r.bottom, toile.bottom) - Math.max(r.top, toile.top);
    if (w > 0.5 && h > 0.5)
      bad.push(`${el.dataset.touche ?? el.dataset.geste ?? el.id ?? el.className} mord sur l'image : ${Math.round(w)}x${Math.round(h)} px`);
  }
  return bad;
}

/** Le jumeau de `surLImage` : une touche posée exprès sur l'image est vue. */
function leurreSurLImage() {
  const toile = document.querySelector("#screen")?.getBoundingClientRect();
  const pave = document.querySelector(".n3-pave");
  if (!toile || !pave) return false;
  const leurre = document.createElement("button");
  leurre.dataset.touche = "leurre";
  Object.assign(leurre.style, {
    position: "fixed",
    left: `${toile.left + toile.width / 2}px`,
    top: `${toile.top + toile.height / 2}px`,
    width: "44px",
    height: "44px",
  });
  pave.append(leurre);
  return true;
}

/** Les cas des places hors de l'image : taille, tactile, manette à l'écran,
 * jeu, et la forme de la rangée attendue (`formeDesPlaces`). Le premier porte
 * les jumeaux.
 *
 * Au bureau, la forme suit l'image : à 1440x900, une image 4:3 remplit la
 * hauteur et ne laisse pas les 64 px du panneau (la rangée monte en tête de
 * colonne), une image 16:9 les laisse (la rangée est dessous). Le plan du
 * chantier attendait « dessous » pour la 4:3 ; le cadre de la salle en
 * décide autrement, et la garde lit ce qu'il décide. Tenue en main, l'écran
 * court en travers (667x375) a la rangée en petit ; 375x667 tenu droit n'a
 * pas de panneau du tout, et ses places vivent dans la feuille. */
const PLACES_CAS = [
  { width: 1440, height: 900, coarse: false, touchpad: "auto", game: 1, image: "pw=1280&ph=720", attendue: "rangee" },
  { width: 1440, height: 900, coarse: false, touchpad: "auto", game: 0, image: "", attendue: "deux-rangees" },
  { width: 1280, height: 720, coarse: false, touchpad: "auto", game: 0, image: "", attendue: "deux-rangees" },
  { width: 390, height: 844, coarse: true, touchpad: "auto", game: 0, image: "", attendue: "rangee" },
  { width: 667, height: 375, coarse: true, touchpad: "auto", game: 0, image: "", attendue: "petite" },
  { width: 844, height: 390, coarse: true, touchpad: "off", game: 0, image: "", attendue: "debout" },
];

/** La rangée des places est rendue et a une taille. */
const placesVisibles = () => {
  const rangee = document.querySelector(".n3-places");
  return rangee !== null && rangee.checkVisibility() && rangee.getBoundingClientRect().width > 0;
};

/** La toile, la rangée des places et sa forme, en nombres : un DOMRect
 * arrive vide de `page.evaluate`. */
function placesEtToile() {
  const nombres = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  };
  const toile = document.querySelector("#screen");
  // La rangée entière : ses places, ou le bouton qui les montre toutes
  // quand elles n'ont pas la largeur (`#placesToutes`).
  const ports = document.querySelector(".n3-places");
  // Les cibles visibles de la rangée : chacune fait 44 px, aucune n'en
  // recouvre une autre, et toutes tiennent dans le panneau que le cadre donne.
  const panneau = document.querySelector("#panneau");
  const cibles = [...(ports?.querySelectorAll("button") ?? [])]
    .filter((b) => b.checkVisibility() && b.getBoundingClientRect().width > 0)
    .map((b) => ({ id: b.id, ...nombres(b) }));
  const defauts = [];
  const cadre = panneau ? nombres(panneau) : null;
  for (const [i, a] of cibles.entries()) {
    if (Math.min(a.right - a.left, a.bottom - a.top) < 43.5)
      defauts.push(`${a.id} mesure ${Math.round(a.right - a.left)}x${Math.round(a.bottom - a.top)} px`);
    if (cadre && (a.left < cadre.left - 0.5 || a.right > cadre.right + 0.5 || a.top < cadre.top - 0.5 || a.bottom > cadre.bottom + 0.5))
      defauts.push(`${a.id} sort du panneau`);
    for (const b of cibles.slice(i + 1)) {
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 0.5 && h > 0.5) defauts.push(`${a.id} recouvre ${b.id} sur ${Math.round(w)}x${Math.round(h)} px`);
    }
  }
  return {
    cibles: cibles.length,
    defauts,
    toile: toile ? nombres(toile) : null,
    ports: ports ? nombres(ports) : null,
    panneau: document.querySelector("#panneau")?.getAttribute("data-forme") ?? null,
    rangee: ports?.getAttribute("data-forme") ?? null,
    colonne: ports !== null && ports.closest("#side") !== null,
  };
}

const croiseLaToile = (a, toile) =>
  a !== null &&
  toile !== null &&
  Math.min(a.right, toile.right) - Math.max(a.left, toile.left) > 0.5 &&
  Math.min(a.bottom, toile.bottom) - Math.max(a.top, toile.top) > 0.5;

const cadreDe = (r) => `[${Math.round(r.left)}, ${Math.round(r.top)}, ${Math.round(r.right)}, ${Math.round(r.bottom)}]`;

/** Le niveau des effets, écrit pour chaque page : le navigateur du pilote
 * garde le stockage d'une page à l'autre, et une étape précédente laissait
 * « tout » allumé (le 23 novembre 2026, la rangée en petit ne débordait
 * qu'après l'étape du thème). */
const effetsAuNiveau = (niveau) => ({ "nel3ab:effets": JSON.stringify({ niveau, sons: false }) });

/** Le jumeau des places : la rangée posée exprès sur l'image. */
function leurreDesPlaces() {
  const c = document.querySelector("#screen").getBoundingClientRect();
  const style = document.createElement("style");
  style.textContent = `.n3-places { position: fixed !important; left: ${c.left + 8}px !important; top: ${c.top + 8}px !important; }`;
  document.head.append(style);
}

/** Combien de temps suivre une arrivée : les 2,2 s de « prêt ! », et la marge
 * d'un salon qui annonce un peu après. */
const SUIVI_MS = 2600;

/** La salle quand Cam s'assied à la place 3, pour la première fois. */
const AVEC_CAM = (() => {
  const salle = room(0);
  return {
    ...salle,
    seats: salle.seats.map((s) => (s.port === 3 ? { port: 3, player: "Cam", held: true, claim: "cam", premiere: true } : s)),
    people: salle.people.map((p) => (p.name === "Cam" ? { ...p, seat: 3 } : p)),
  };
})();

/** À chaque image pendant `ms` : la boîte de chaque « prêt ! » contre la
 * toile, et ce que rendent le centre et les quatre coins de la toile (à 3 px
 * du bord). Tourne dans la page. */
function suivreLArrivee(ms) {
  return new Promise((resolve) => {
    const toile = document.querySelector("#screen");
    const nom = (el) => (el === null ? "rien" : el.id || el.className || el.tagName);
    const debut = performance.now();
    let avant = debut;
    const r = { images: 0, pretVu: 0, prets: [], dites: [], pireEcart: 0, croise: [], cache: [] };
    const pas = () => {
      const t = performance.now();
      r.images += 1;
      r.pireEcart = Math.max(r.pireEcart, t - avant);
      avant = t;
      const c = toile.getBoundingClientRect();
      const dite = document.querySelector("#ligneParlee")?.textContent ?? "";
      if (dite !== "" && !r.dites.includes(dite)) r.dites.push(dite);
      for (const p of document.querySelectorAll(".rt-pret")) {
        const b = p.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        r.pretVu += 1;
        const qui = p.textContent.split(" ")[0];
        if (!r.prets.includes(qui)) r.prets.push(qui);
        const w = Math.min(b.right, c.right) - Math.max(b.left, c.left);
        const h = Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top);
        if (w > 0.5 && h > 0.5) r.croise.push(`à ${Math.round(t - debut)} ms, « ${p.textContent} » coupe l'image sur ${Math.round(w)}x${Math.round(h)} px`);
      }
      const i = 3;
      const points = [
        [c.left + c.width / 2, c.top + c.height / 2],
        [c.left + i, c.top + i],
        [c.right - i, c.top + i],
        [c.left + i, c.bottom - i],
        [c.right - i, c.bottom - i],
      ];
      for (const [x, y] of points) {
        const e = document.elementFromPoint(x, y);
        if (e !== toile) r.cache.push(`à ${Math.round(t - debut)} ms, (${Math.round(x)}, ${Math.round(y)}) rend ${nom(e)}, pas la toile`);
      }
      if (t - debut < ms) requestAnimationFrame(pas);
      else resolve(r);
    };
    requestAnimationFrame(pas);
  });
}

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
    await page.evaluate(() => document.getElementById("leurre-dessus")?.remove());
    // Le jumeau de « rien sur l'image » : une touche posée exprès au milieu
    // de l'image est vue. Sans lui, une garde qui ne trouverait jamais la
    // toile passerait.
    await page.waitForSelector(".n3-pave", { timeout: 8000 });
    const avant = await page.evaluate(surLImage);
    const pose = await page.evaluate(leurreSurLImage);
    const apres = await page.evaluate(surLImage);
    say(
      avant.length === 0 && pose && apres.some((line) => line.startsWith("leurre")),
      "jumeau : la garde voit une touche posée sur l'image",
      [...avant, ...(pose ? [] : ["pas de manette où poser le leurre"])],
    );
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
        bad.push(...(await page.evaluate(surLImage)));
        const openers = await page.evaluate((s) => document.querySelectorAll(s).length, OPENER);
        if (openers !== 1) bad.push(`${openers} boutons « La salle » trouvés, 1 attendu`);
        const opener = await page.evaluate(boite, OPENER);
        bad.push(...dansLaZone("« La salle »", opener, zone, width, height));
        if (opener && sound !== "running" && !opener.alerte) bad.push("le son est coupé et « La salle » ne le dit pas");
        if (opener && sound === "running" && opener.alerte) bad.push("le son joue et « La salle » s'alerte");
        // Tenu droit, la barre porte « La salle » dès qu'elle tient.
        if (height > width && height >= 667 && !(await page.$("#barreSalle #laSalle")))
          bad.push("tenu droit, « La salle » n'est pas dans la barre");
        if (opener) {
          await tap(page, OPENER);
          if (!(await attendre(page, () => document.querySelector("#feuilleSalle")?.open === true)))
            bad.push("« La salle » n'ouvre pas la feuille");
          else {
            await sleep(350);
            await page.screenshot({ path: join(OUT, `feuille-mi-${name}-${size}.png`) });
            // À mi-hauteur, la feuille ne touche pas l'image, et le fond ne
            // s'assombrit plus.
            const mi = await page.evaluate(() => {
              const f = document.querySelector("#feuilleSalle .n3-feuille-boite")?.getBoundingClientRect();
              const t = document.querySelector("#screen")?.getBoundingClientRect();
              const fond = getComputedStyle(document.querySelector("#feuilleSalle"), "::backdrop").backgroundColor;
              const boite = document.querySelector("#feuilleSalle .n3-feuille-boite");
              if (!f || !t || !boite) return null;
              const w = Math.min(f.right, t.right) - Math.max(f.left, t.left);
              const h = Math.min(f.bottom, t.bottom) - Math.max(f.top, t.top);
              return {
                coupe: w > 0.5 && h > 0.5 ? Math.round(w * h) : 0,
                fond,
                // La hauteur NATURELLE du contenu : `scrollHeight` vaut la
                // hauteur de la boîte dès que le contenu est plus court.
                contenu: Math.round(
                  Math.max(...[...boite.children].map((one) => one.getBoundingClientRect().bottom)) -
                    boite.getBoundingClientRect().top +
                    parseFloat(getComputedStyle(boite).paddingBottom),
                ),
                hauteur: boite.getBoundingClientRect().height,
              };
            });
            if (!mi) bad.push("la feuille ou la toile n'a pas de boîte");
            else {
              if (mi.coupe > 0) bad.push(`la feuille à mi-hauteur couvre ${mi.coupe} px² de l'image`);
              if (mi.fond !== "rgba(0, 0, 0, 0)") bad.push(`le fond de la feuille s'assombrit : ${mi.fond}`);
              // Toutes les entrées se voient sans faire défiler la feuille.
              if (mi.contenu > mi.hauteur + 1)
                bad.push(`la feuille à mi-hauteur défile : ${mi.contenu} px de contenu pour ${mi.hauteur}`);
              console.log(`      mesure : feuille à mi-hauteur ${what}, ${mi.contenu} px de contenu pour ${mi.hauteur}`);
            }
            const entries = await page.evaluate(ENTRIES);
            const wanted = ["son", "menu", "manette", "toute-la-salle"];
            for (const one of wanted) if (!entries.includes(one)) bad.push(`la feuille n'a pas l'entrée « ${one} »`);
            if (!entries.includes("plein-ecran") && !entries.includes("ecran-accueil"))
              bad.push("la feuille n'a ni plein écran ni écran d'accueil");
            for (const one of entries)
              bad.push(...dansLaZone(`l'entrée « ${one} »`, await page.evaluate(boite, `[data-entree="${one}"]`), zone, width, height));
            bad.push(...(await page.evaluate(etat)));
            const son = await page.evaluate(boite, '[data-entree="son"]');
            if (son && sound !== "running" && !son.alerte) bad.push("le son est coupé et la feuille ne le dit pas");
            // Échap ferme la feuille, et le focus revient à « La salle » : la
            // manette est démontée pendant qu'elle est ouverte.
            if (name === "gc") {
              await page.keyboard.press("Escape");
              if (!(await attendre(page, () => document.querySelector("#feuilleSalle") === null)))
                bad.push("Échap ne ferme pas la feuille");
              else if (!(await attendre(page, focusRendu, OPENER, 1500)))
                bad.push(
                  `la feuille fermée, le focus est sur ${await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)}, ni sur « La salle » ni sur le jeu`,
                );
              await tap(page, OPENER);
              await attendre(page, () => document.querySelector("#feuilleSalle")?.open === true);
              await sleep(300);
            }
            // Le menu du jeu, depuis la feuille, puis retour à la feuille.
            // L'image 16:9 aussi (x360) : couchée, elle ne laisse aucune
            // bande lisible, et le menu la couvrait (relecture du
            // 24 novembre 2026).
            if (name === "gc" || name === "x360") {
              await tap(page, '[data-entree="menu"]');
              // Depuis le menu unique (24 novembre 2026), le menu n'est plus
              // un dialogue plein cadre : une section posée hors de l'image,
              // sous elle tenu droit, à côté couché (ADR D30 amendé).
              if (!(await attendre(page, () => document.querySelector("#menu") !== null)))
                bad.push("« Menu du jeu » n'ouvre pas le menu");
              else {
                await sleep(300);
                await page.screenshot({ path: join(OUT, `menu-${name}-${size}.png`) });
                if (await page.$("#feuilleSalle")) bad.push("la feuille reste ouverte sous le menu");
                const lu = await page.evaluate(() => {
                  const m = document.querySelector("#menu").getBoundingClientRect();
                  const t = document.querySelector("#screen canvas")?.getBoundingClientRect();
                  const s = document.querySelector("#closeMenu")?.getBoundingClientRect();
                  const w = t ? Math.min(m.right, t.right) - Math.max(m.left, t.left) : 0;
                  const h = t ? Math.min(m.bottom, t.bottom) - Math.max(m.top, t.top) : 0;
                  const zone = document.querySelector("[data-zone-jeu]");
                  return {
                    coupe: w > 0.5 && h > 0.5 ? Math.round(w * h) : 0,
                    cachee: zone ? getComputedStyle(zone).visibility === "hidden" : false,
                    lieu: document.querySelector("#menu").dataset.lieu,
                    sortie: s ? Math.round(s.height) : 0,
                    touch: getComputedStyle(document.querySelector("#menu")).touchAction,
                  };
                });
                // Rien sur une image qu'on voit : à côté d'elle, ou à la place
                // de l'écran quand aucune bande ne se lit, l'image cachée le
                // temps du menu (`placeDuMenu`, lieu « ecran »).
                if (lu.coupe > 0 && !lu.cachee) bad.push(`le menu couvre ${lu.coupe} px² de l'image visible`);
                if (lu.cachee && lu.lieu !== "ecran") bad.push(`l'image est cachée sous un menu posé ${lu.lieu}`);
                if (lu.sortie < 44) bad.push(`la sortie du menu fait ${lu.sortie} px de haut`);
                if (lu.touch === "none") bad.push("le menu bloque le défilement au doigt (touch-action: none)");
                await page.evaluate(() => document.querySelector("#closeMenu")?.click());
                await attendre(page, () => document.querySelector("#menu") === null);
              }
              await tap(page, OPENER);
              await attendre(page, () => document.querySelector("#feuilleSalle")?.open === true);
              await sleep(300);
            }
            // Toute la salle, dans la même feuille agrandie.
            await tap(page, '[data-entree="toute-la-salle"]');
            if (!(await attendre(page, (s) => document.querySelector(s)?.open === true, AGRANDIE)))
              bad.push("« Toute la salle » n'agrandit pas la feuille");
            else {
              await sleep(350);
              await page.screenshot({ path: join(OUT, `feuille-agrandie-${name}-${size}.png`) });
              const ouverts = await page.evaluate(() => document.querySelectorAll("dialog[open]").length);
              if (ouverts !== 1) bad.push(`${ouverts} dialogues ouverts, un seul attendu`);
              if (await page.$(".n3-pave")) bad.push("la manette à l'écran reste montée sous la feuille");
              const side = await page.evaluate(() => {
                const el = document.querySelector("#side");
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { left: r.left, right: r.right, scroll: el.scrollWidth, client: el.clientWidth };
              });
              if (!side) bad.push("la feuille agrandie n'a pas la colonne (#side)");
              else {
                if (side.left < -0.5 || side.right > width + 0.5)
                  bad.push(`la feuille sort de l'écran : ${Math.round(side.left)} à ${Math.round(side.right)}`);
                if (side.scroll > side.client + 1) bad.push(`la feuille défile en largeur : ${side.scroll} pour ${side.client}`);
                // Tenue droite sous 480 px, une bande de jeu à gauche n'est ni
                // l'image ni la feuille : elle prend toute la largeur.
                if (height > width && width <= 480 && side.left > 20.5)
                  bad.push(`la feuille laisse ${Math.round(side.left)} px à sa gauche, tenue droite`);
              }
              bad.push(...(await page.evaluate(petites, { racine: "#feuilleSalle", floor: FLOOR, exceptions: EXCEPTIONS_DU_TIROIR })));
              // « Rendre ma place » vit dans « Autres réglages » depuis le
              // 23 novembre 2026 : on le déplie.
              await page.evaluate(() => {
                const autres = document.querySelector("#autresReglages");
                if (autres) autres.open = true;
              });
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
              await page.screenshot({ path: join(OUT, `feuille-agrandie-bas-${name}-${size}.png`) });
              bad.push(
                ...dansLaZone("fermer, colonne défilée jusqu'en bas", await page.evaluate(boite, "#fermerFeuille"), zone, width, height),
              );
              await page.evaluate(() => {
                const aside = document.querySelector("#side");
                if (aside) aside.scrollTop = 0;
              });
              await sleep(120);
              bad.push(...(await page.evaluate(etat)));
              await tap(page, "#fermerFeuille");
              if (!(await attendre(page, () => document.querySelector("#feuilleSalle")?.open !== true)))
                bad.push("« Fermer » ne ferme pas la feuille");
              else if (!(await attendre(page, () => document.querySelector(".n3-pave") !== null)))
                bad.push("la manette ne revient pas quand la feuille se ferme");
              else if (!(await attendre(page, focusRendu, OPENER, 1500)))
                bad.push(
                  `la feuille fermée, le focus est sur ${await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)}, ni sur « La salle » ni sur le jeu`,
                );
              else bad.push(...(await page.evaluate(surLImage)));
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
        await attendre(page, () => document.querySelector("#feuilleSalle")?.open === true);
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
      // La pastille « L'image saute » paraît hors de l'image ; elle ouvre la
      // feuille sur la fiche et ses deux gestes (ADR D40).
      await page.waitForSelector('#pastilleEtat[data-etat="irreguliere"]', { timeout: 20000 });
      await tap(page, "#pastilleEtat");
      await page.waitForSelector("#rough", { timeout: 5000 });
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
  // qui n'aboutit pas), la salle entière reste joignable : « La salle » est
  // dans la barre, hors de l'écran.
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
        // Une salle au repos n'ouvre plus son menu d'elle-même depuis le
        // 23 novembre 2026 : l'écran éteint se montre tout de suite.
        await page.waitForSelector(game === null ? "#idle-room" : "#arrivee", { timeout: 20000 });
        await sleep(700);
        bad.push(...dansLaZone("« La salle »", await page.evaluate(boite, OPENER), zone, width, height));
        if (await page.$(".n3-pave")) bad.push("la manette reste montée sous l'écran qui couvre l'image");
        await tap(page, OPENER);
        if (!(await attendre(page, () => document.querySelector("#feuilleSalle")?.open === true)))
          bad.push("« La salle » n'ouvre pas la feuille");
        else {
          await sleep(300);
          await tap(page, '[data-entree="toute-la-salle"]');
          if (!(await attendre(page, (s) => document.querySelector(s)?.open === true, AGRANDIE)))
            bad.push("« Toute la salle » n'agrandit pas la feuille");
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
      say(bad.length === 0, `${what} ${width}x${height} : la salle entière reste joignable`, bad);
      await page.close();
    }
  }

  // L'arrivée d'une salle qui ne répond pas, au téléphone (chantier etats,
  // ADR D40) : le plein cadre tient sur l'écran noir, son titre, son fait et
  // « Réessayer » dans la fenêtre et hors des zones sûres, et « Réessayer »
  // reçoit un vrai appui. Le jumeau : la salle en partie n'a aucun plein
  // cadre visible.
  for (const [width, height] of part("arrivee-telephone")
    ? [
        [390, 844],
        [375, 667],
        [844, 390],
      ]
    : []) {
    for (const liaison of ["injoignable", "ok"]) {
      const what = `arrivée au téléphone ${width}x${height}, liaison ${liaison}`;
      const { page, errors, zone } = await ouvrir({ width, height, url: `${BASE}/r/1/?entrer=jouer&liaison=${liaison}` });
      const bad = [];
      try {
        const visible = () =>
          page.evaluate(() => {
            const a = document.querySelector("#arrivee");
            return a !== null && getComputedStyle(a).display !== "none" && a.getClientRects().length > 0;
          });
        if (liaison === "ok") {
          await page.waitForSelector("#screen", { timeout: 20000 });
          await sleep(1500);
          if (await visible()) bad.push("la salle en partie montre un plein cadre");
        } else {
          await page.waitForSelector("#arrivee #reessayer", { timeout: 20000 });
          await sleep(700);
          if (!(await visible())) bad.push("le plein cadre d'une arrivée sans réponse ne se voit pas");
          const lu = await page.evaluate(() => {
            const r = (sel) => {
              const el = document.querySelector(sel);
              if (!el) return null;
              const b = el.getBoundingClientRect();
              return [b.left, b.top, b.right, b.bottom];
            };
            return { cadre: r("#arrivee"), titre: r("#arrivee .n3-plein-titre"), fait: r("#arrivee .n3-plein-fait") };
          });
          if (lu.cadre === null || lu.titre === null || lu.fait === null)
            bad.push(`plein cadre incomplet : ${JSON.stringify(lu)}`);
          else
            for (const [nom, b] of [
              ["le titre", lu.titre],
              ["le fait", lu.fait],
            ]) {
              const [l, t, r, bas] = b;
              if (l < lu.cadre[0] - 0.5 || r > lu.cadre[2] + 0.5 || t < lu.cadre[1] - 0.5 || bas > lu.cadre[3] + 0.5)
                bad.push(`${nom} sort du plein cadre : ${b.map(Math.round)} dans ${lu.cadre.map(Math.round)}`);
              if (l < zone.left - 0.5 || r > width - zone.right + 0.5 || t < zone.top - 0.5 || bas > height - zone.bottom + 0.5)
                bad.push(`${nom} sort des zones sûres : ${b.map(Math.round)}`);
            }
          bad.push(...dansLaZone("« Réessayer »", await page.evaluate(boite, "#arrivee #reessayer"), zone, width, height));
          if (await page.$(".n3-pave")) bad.push("la manette reste montée sous le plein cadre");
          await page.screenshot({ path: join(OUT, `arrivee-telephone-${width}x${height}.png`) });
          await tap(page, "#arrivee #reessayer");
          await sleep(300);
        }
      } catch (error) {
        bad.push(`le parcours s'arrête : ${error.message}`);
      }
      bad.push(...errors.map((e) => `erreur de page : ${e}`));
      say(bad.length === 0, what, bad);
      await page.close();
    }
  }

  // La pastille d'état, au téléphone (chantier etats, ADR D40) : jamais sur
  // l'image peinte, jamais sur une touche de la manette ([data-touche]), ni
  // sur la tête d'Aïn ([data-hote="barre"], sa maison au téléphone, qu'elle
  // couvrait toute dans la barre à 375x667 le 24 novembre 2026), en aires
  // communes rendues en nombres, ni sur le nom de la salle dans la barre,
  // qui se lit entier (24 novembre 2026). Cinq états, neuf tailles, une image
  // 4:3 et deux en 16:9. Une taille où la salle n'a encore aucune place pour
  // elle est dite à part, en « non posée » : mesuré le 24 novembre 2026, le
  // téléphone tenu droit et court, sans barre ni bande, où « La salle » vit
  // dans la manette (reste du chantier, à décider avec la salle). Partout
  // ailleurs, son absence est un défaut : la mesure ne passe jamais à vide.
  const SANS_PLACE = new Set(["390x664 4:3", "375x548 4:3"]);
  for (const [width, height, pw, ph] of part("pastille")
    ? [
        [390, 844, 640, 480],
        [390, 664, 640, 480],
        [375, 548, 640, 480],
        [430, 932, 640, 480],
        [768, 1024, 640, 480],
        [375, 667, 640, 480],
        [844, 390, 640, 480],
        [667, 375, 640, 480],
        [932, 430, 640, 480],
        [844, 390, 1280, 720],
        [667, 375, 1280, 720],
      ]
    : []) {
    const taille = `${width}x${height} ${pw / ph > 1.5 ? "16:9" : "4:3"}`;
    const lus = [];
    const bad = [];
    for (const [etat, fermeture] of [
      ["irreguliere", 0],
      ["figee", 0],
      ["figee-fiche", 0],
      ["coupee", 0],
      ["ok", 5],
    ]) {
      const nom = fermeture ? `fermeture dans ${fermeture} min` : etat;
      const { page, errors } = await ouvrir({
        width,
        height,
        url: `${BASE}/r/1/?entrer=jouer&liaison=${etat}&fermeture=${fermeture}&pw=${pw}&ph=${ph}`,
      });
      try {
        await page.waitForSelector("#screen", { timeout: 20000 });
        await attendre(page, () => document.querySelector("#pastilleEtat") !== null, null, 3000);
        await sleep(300);
        const m = await page.evaluate(() => {
          const aire = (a, b) =>
            Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
            Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          const p = document.querySelector("#pastilleEtat");
          const toile = document.querySelector("#screen");
          if (!toile) return { erreur: "pas de toile" };
          const t = toile.getBoundingClientRect();
          if (!p || p.getClientRects().length === 0) return { posee: false, toile: t.width * t.height };
          const a = p.getBoundingClientRect();
          const centre = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2);
          const touches = [...document.querySelectorAll("[data-touche]")]
            .map((k) => k.getBoundingClientRect())
            .filter((k) => k.width > 0);
          const tetes = [...document.querySelectorAll('[data-hote="barre"]')]
            .map((h) => [h, h.getBoundingClientRect()])
            .filter(([, r]) => r.width > 0 && r.height > 0);
          // Le nom de la salle dans la barre, mesuré sur ses lettres (un
          // Range) : la pastille ne se pose jamais dessus, et il se lit
          // entier (décision du chef de chantier, 24 novembre 2026).
          const nom = document.querySelector("#barreSalle .n3-barre-salle");
          let surNom = 0;
          let nomCoupe = false;
          let nomCouvert = false;
          if (nom) {
            const plage = document.createRange();
            plage.selectNodeContents(nom);
            for (const r of plage.getClientRects()) {
              surNom += aire(a, r);
              const vu = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              if (vu === null || !nom.contains(vu)) nomCouvert = true;
            }
            nomCoupe = nom.scrollWidth > nom.clientWidth + 1;
          }
          return {
            surNom,
            nomCoupe,
            nomCouvert,
            nom: nom !== null,
            posee: true,
            toile: t.width * t.height,
            surImage: aire(a, t),
            surTouches: touches.reduce((somme, k) => somme + aire(a, k), 0),
            touches: touches.length,
            surTete: tetes.reduce((somme, [, r]) => somme + aire(a, r), 0),
            teteCouverte: tetes.some(([h, r]) => {
              const vu = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return vu === null || !h.contains(vu);
            }),
            tetes: tetes.length,
            recoit: centre !== null && p.contains(centre),
            etat: p.dataset.etat ?? null,
          };
        });
        if (m.erreur) bad.push(`${nom} : ${m.erreur}`);
        else if (m.toile <= 0) bad.push(`${nom} : la toile n'a pas d'aire, la mesure ne prouverait rien`);
        else if (!m.posee) {
          if (!SANS_PLACE.has(taille)) bad.push(`${nom} : aucune pastille posée`);
          else lus.push(`${nom} non posée`);
        } else {
          if (m.surImage > 0) bad.push(`${nom} : ${Math.round(m.surImage)} px² de pastille sur l'image`);
          if (m.surTouches > 0) bad.push(`${nom} : ${Math.round(m.surTouches)} px² de pastille sur les touches`);
          if (m.surTete > 0 || m.teteCouverte)
            bad.push(`${nom} : ${Math.round(m.surTete)} px² de pastille sur la tête d'Aïn${m.teteCouverte ? ", son centre couvert" : ""}`);
          if (!m.recoit) bad.push(`${nom} : la pastille ne reçoit pas le point en son centre`);
          if (m.surNom > 0 || m.nomCouvert)
            bad.push(`${nom} : ${Math.round(m.surNom)} px² de pastille sur le nom de la salle${m.nomCouvert ? ", ses lettres couvertes" : ""}`);
          if (m.nomCoupe) bad.push(`${nom} : le nom de la salle est coupé dans la barre`);
          lus.push(`${nom} posée (${m.touches} touches, ${m.tetes} tête${m.nom ? ", nom lu" : ""})`);
        }
      } catch (error) {
        bad.push(`${nom} : ${error.message}`);
      }
      bad.push(...errors.map((e) => `${nom} : erreur de page : ${e}`));
      await page.close();
    }
    say(bad.length === 0, `pastille hors de l'image et des touches ${taille} : ${lus.join(", ")}`, bad);
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

  // La préparation à plusieurs (chantier menus, P1, P2, P8, 24 novembre
  // 2026) : un bloc de la colonne, dans la feuille agrandie d'une salle
  // tenue en main. Il n'est plus un dialogue plein écran. Au téléphone comme
  // en paysage : la page ne défile pas en largeur, chaque bouton et chaque
  // choix fait 44 px au moins, et le geste principal se voit sans défiler
  // (la rangée des gestes colle au bas de la colonne).
  for (const [width, height] of part("touches")
    ? [
        [844, 390],
        [932, 430],
        [390, 844],
      ]
    : []) {
    for (const [nom, suffixe] of [
      ["preparation", ""],
      ["pro-preparation", "&pro=x360"],
    ]) {
      const { page, errors, zone } = await ouvrir({ width, height, url: `${BASE}/bindings-preview.html?preparation${suffixe}` });
      const bad = [];
      try {
        await page.waitForSelector("#preparation", { timeout: 20000 });
        await sleep(500);
        await page.screenshot({ path: join(OUT, `${nom}-${width}x${height}.png`) });
        if (await page.$("dialog[open]")) bad.push("un dialogue est ouvert pendant la préparation");
        bad.push(...(await page.evaluate(etat)));
        bad.push(...dansLaZone("#launchPrepared", await page.evaluate(boite, "#launchPrepared"), zone, width, height));
        const petits = await page.evaluate((floor) =>
          [...document.querySelectorAll("#preparation :is(button, label)")]
            .map((el) => [el, el.getBoundingClientRect()])
            .filter(([, r]) => r.width > 0 && Math.min(r.width, r.height) < floor - 0.5)
            .map(([el, r]) => `${el.id || el.textContent.trim().slice(0, 24)} mesure ${Math.round(r.width)}x${Math.round(r.height)} px`),
        FLOOR);
        bad.push(...petits);
        // Rien à mesurer ne prouve rien : un bloc sans gestes passerait.
        const gestes = await page.evaluate(() => document.querySelectorAll("#preparation button").length);
        if (gestes < 3) bad.push(`le bloc n'a que ${gestes} boutons`);
      } catch (error) {
        bad.push(`la préparation ne se montre pas : ${error.message}`);
      }
      bad.push(...errors.map((e) => `erreur de page : ${e}`));
      say(bad.length === 0, `préparation « ${nom} » ${width}x${height}`, bad);
      await page.close();
    }
  }

  // Le panneau « Touches et manettes » (chantier manettes, 24 novembre
  // 2026), seul sur la page d'aperçu (`bindings-preview.html?reglage`), en
  // trame Dolphin et Pro, sur ses trois onglets. Au téléphone et en paysage :
  // la page ne défile pas en largeur, aucune cible n'en recouvre une autre,
  // « Fermer » et l'onglet ouvert tiennent dans les zones sûres et reçoivent
  // leur appui, et chaque contrôle visible du panneau fait 44 px au moins.
  for (const [width, height] of part("touches")
    ? [
        [844, 390],
        [932, 430],
        [390, 844],
      ]
    : []) {
    for (const [trame, suffixe] of [
      ["dolphin", ""],
      ["pro", "&pro=x360"],
    ]) {
      for (const onglet of ["manette", "clavier", "profils"]) {
        const { page, errors, zone } = await ouvrir({
          width,
          height,
          url: `${BASE}/bindings-preview.html?reglage${suffixe}&onglet=${onglet}`,
        });
        const bad = [];
        try {
          await page.waitForSelector("#reglage", { timeout: 20000 });
          await sleep(500);
          await page.evaluate(() => window.scrollTo(0, 0));
          await sleep(100);
          await page.screenshot({ path: join(OUT, `reglage-${trame}-${onglet}-${width}x${height}.png`) });
          for (const s of ["#fermerReglage", `#onglet-${onglet}`])
            bad.push(...dansLaZone(s, await page.evaluate(boite, s), zone, width, height));
          bad.push(...(await page.evaluate(etat)));
          const petits = await page.evaluate((floor) => {
            const vus = [...document.querySelectorAll("#reglage :is(button, select, input, summary, [role=tab])")].filter(
              (el) => {
                if (el.closest("details:not([open])") && el.tagName !== "SUMMARY") return false;
                const s = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
              },
            );
            return vus
              .map((el) => [el, el.getBoundingClientRect()])
              .filter(([, r]) => Math.min(r.width, r.height) < floor - 0.5)
              .map(([el, r]) => `${el.id || el.getAttribute("aria-label") || el.textContent.trim().slice(0, 20) || el.tagName} mesure ${Math.round(r.width)}x${Math.round(r.height)} px`);
          }, FLOOR);
          bad.push(...petits);
          // Rien à mesurer ne prouve rien : un onglet vide passerait.
          const controles = await page.evaluate(() => document.querySelectorAll("#reglage button").length);
          if (controles < 3) bad.push(`le panneau n'a que ${controles} boutons`);
        } catch (error) {
          bad.push(`le panneau ne s'ouvre pas : ${error.message}`);
        }
        bad.push(...errors.map((e) => `erreur de page : ${e}`));
        say(bad.length === 0, `panneau « ${trame} », onglet ${onglet}, ${width}x${height}`, bad);
        await page.close();
      }
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
        // Les effets rétro au niveau « tout »: le script de l'en-tête doit les
        // avoir posés quand le corps commence, comme le thème (ADR D37).
        stockage: { "nel3ab:theme": choisi, "nel3ab:effets": '{"niveau":"tout","sons":false}' },
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
            window.__effets = {
              niveau: document.documentElement.dataset.effets ?? null,
              scintille: document.documentElement.classList.contains("fx-scintille"),
              titre: getComputedStyle(document.documentElement).getPropertyValue("--police-titre").trim(),
            };
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
        const effets = await page.evaluate(() => window.__effets);
        if (effets?.niveau !== "tout" || effets?.scintille !== true || !effets?.titre?.startsWith('"Pixelify Sans"'))
          bad.push(`effets rétro au début du corps : ${JSON.stringify(effets)}, niveau « tout » et Pixelify attendus`);
        const refus = await page.evaluate(() => window.__violations);
        if (refus.length) bad.push(`la politique du worker refuse : ${refus.join(" ; ")}`);
        await page.close();
      }
    }
    say(bad.length === 0, `la première image suit le thème et les effets choisis, sous la politique du worker (${BUILT.replace(REPO + "/", "")})`, bad);
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
      if (await page.$(OPENER)) bad.push("un « La salle » sur un grand écran à la souris");
      if (await page.$("#barreSalle")) bad.push("une barre de téléphone sur un grand écran à la souris");
      if (await page.evaluate(() => document.querySelector("#side")?.closest("dialog") !== null))
        bad.push("la colonne est dans une feuille sur un grand écran");
      bad.push(...(await page.evaluate(etat)));
    } catch (error) {
      bad.push(`la salle ne s'ouvre pas : ${error.message}`);
    }
    bad.push(...errors.map((e) => `erreur de page : ${e}`));
    say(bad.length === 0, "grand écran 1440x900 : la colonne reste à côté", bad);
    await page.close();
  }

  // 13. Un grand écran à la souris, la manette à l'écran réglée sur
  // « toujours » : son « La salle » déplie la colonne, sans feuille. Le
  // tiroir d'avant le 23 novembre démontait la manette et ne montrait rien.
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
      {
        await page.click(OPENER);
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

  // 14. Ctrl seule. Tenue en main (une tablette au clavier), sous le menu
  // puis sous la feuille à mi-hauteur : la feuille agrandie s'ouvre SEULE.
  // Deux dialogues modaux empilés rendaient le bouton « menu » sans effet.
  // M11 (chantier menus) : à 320, 375 et 390 px de large, au niveau « tout »
  // (texte en pixels, icônes au-dessus du mot), les quatre onglets du menu
  // tiennent sans défilement de côté ni mot coupé, et le menu laisse
  // défiler au doigt. Le jumeau force quatre onglets par rang : à 320 px,
  // un mot doit sortir de son onglet, sans quoi la mesure ne voit rien.
  if (part("menu-etroit")) {
    const lire = (page) =>
      page.evaluate(() => {
        const liste = document.querySelector("#menu [role=tablist]");
        const onglets = [...document.querySelectorAll("#menu [role=tab]")];
        return {
          niveau: document.documentElement.dataset.effets ?? null,
          police: onglets[0] ? getComputedStyle(onglets[0]).fontFamily : "",
          liste: liste ? { large: liste.scrollWidth, vue: liste.clientWidth } : null,
          coupes: onglets.filter((o) => o.scrollWidth > o.clientWidth + 1).map((o) => o.textContent.trim()),
          bas: onglets.map((o) => Math.round(o.getBoundingClientRect().height)),
          doigt: getComputedStyle(document.querySelector("#menu")).touchAction,
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
    const ouvrirLeMenu = async (page) => {
      await page.waitForSelector(OPENER, { timeout: 20000 });
      await sleep(600);
      await tap(page, OPENER);
      await attendre(page, () => document.querySelector("#feuilleSalle")?.open === true);
      await sleep(300);
      await tap(page, '[data-entree="menu"]');
      return attendre(page, () => document.querySelector("#menu [role=tab]") !== null);
    };
    for (const [width, height] of [
      [320, 568],
      [375, 667],
      [390, 844],
    ]) {
      const what = `menu à ${width}x${height}, effets tout : quatre onglets entiers, rien de côté`;
      const { page, errors } = await ouvrir({
        width,
        height,
        url: `${BASE}/r/1/?entrer=jouer`,
        stockage: effetsAuNiveau("tout"),
      });
      const bad = [];
      try {
        if (!(await ouvrirLeMenu(page))) bad.push("« Menu du jeu » n'ouvre pas le menu");
        else {
          await sleep(300);
          await page.screenshot({ path: join(OUT, `menu-tout-${width}x${height}.png`) });
          const lu = await lire(page);
          if (lu.niveau !== "tout" || !lu.police.startsWith('"Pixelify Sans"'))
            bad.push(`précondition : niveau ${lu.niveau}, police des onglets ${lu.police}`);
          if (!lu.liste) bad.push("le menu n'a pas de liste d'onglets");
          else if (lu.liste.large > lu.liste.vue + 1)
            bad.push(`les onglets défilent de côté (${lu.liste.large} px pour ${lu.liste.vue})`);
          if (lu.coupes.length > 0) bad.push(`mot coupé dans ${lu.coupes.join(", ")}`);
          if (lu.bas.some((h) => h < 44)) bad.push(`un onglet fait moins de 44 px de haut (${lu.bas.join(", ")})`);
          if (lu.doigt === "none") bad.push("le menu bloque le défilement au doigt (touch-action: none)");
          if (lu.page > 0) bad.push(`la page défile de côté de ${lu.page} px`);
          // Le jumeau, à 320 px seulement : quatre onglets par rang.
          if (width === 320) {
            await page.addStyleTag({
              content: ".n3-menu-onglets { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }",
            });
            await sleep(200);
            const casse = await lire(page);
            if (casse.coupes.length === 0 && casse.liste?.large <= casse.liste?.vue + 1)
              bad.push("jumeau : quatre onglets par rang à 320 px, et la mesure ne voit aucun mot coupé");
          }
        }
        if (errors.length > 0) bad.push(...errors.map((e) => `erreur de page : ${e}`));
      } finally {
        await page.close();
      }
      say(bad.length === 0, what, bad);
    }
  }

  // Ton étiquette en tête de la bande, menu ouvert (décision du chef de
  // chantier, 24 novembre 2026) : le cadre expose son rectangle
  // (`LieuEtiquette` « bande », `BANDE_BORD`) et le menu l'évite. Chaque
  // cas DÉCLARE que l'étiquette est dans la bande (le panneau n'y a que ses
  // lampes, zones sûres d'un iPhone comprises) : son absence est un défaut,
  // pas un cas sauté. Mesuré sur le texte même de l'étiquette (un Range :
  // sa boîte est plus étroite que ses lettres), qui doit recevoir le point
  // menu fermé, puis menu ouvert ; le menu ne doit couper aucun de ses
  // rectangles. Le jumeau : la même mesure, l'étiquette poussée sous le
  // menu, voit le recouvrement.
  if (part("menu-etiquette")) {
    const lireLEtiquette = (page) =>
      page.evaluate(() => {
        const e = document.querySelector("#etiquetteManette.n3-etiquette-bande");
        if (!e) return { posee: false };
        const plage = document.createRange();
        plage.selectNodeContents(e);
        const lettres = [...plage.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        const menu = document.querySelector("#menu");
        const m = menu ? menu.getBoundingClientRect() : null;
        const coupe = (a, b) =>
          Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
          Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        // Le pointeur rendu le temps du test : l'étiquette n'en prend pas.
        e.style.pointerEvents = "auto";
        for (const enfant of e.querySelectorAll("*")) enfant.style.pointerEvents = "auto";
        const lues = lettres.map((r) => {
          const vu = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return vu !== null && e.contains(vu) ? null : vu ? `${vu.tagName.toLowerCase()}#${vu.id}` : "rien";
        });
        e.style.pointerEvents = "";
        for (const enfant of e.querySelectorAll("*")) enfant.style.pointerEvents = "";
        return {
          posee: true,
          lettres: lettres.length,
          couvertes: lues.filter(Boolean),
          surMenu: m ? Math.round(lettres.reduce((s, r) => s + coupe(r, m), 0)) : 0,
          menu: m ? [m.left, m.top, m.width, m.height].map(Math.round) : null,
          texte: e.textContent.trim(),
        };
      });
    const ouvrirLeMenu = async (page) => {
      await page.waitForSelector(OPENER, { timeout: 20000 });
      await sleep(600);
      await tap(page, OPENER);
      await attendre(page, () => document.querySelector("#feuilleSalle")?.open === true);
      await sleep(300);
      await tap(page, '[data-entree="menu"]');
      return attendre(page, () => document.querySelector("#menu [role=tab]") !== null);
    };
    for (const [width, height, game, pw, ph] of [
      [667, 375, 0, 640, 480],
      [640, 360, 0, 640, 480],
      [568, 320, 0, 640, 480],
      [667, 375, 0, 1280, 720],
      [667, 375, 1, 640, 480],
      [667, 375, 1, 1280, 720],
    ]) {
      const what = `menu ouvert à ${width}x${height} ${game === 0 ? "GameCube" : "Xbox 360"} ${pw}x${ph} : ton étiquette en tête de la bande reste lisible`;
      const { page, errors } = await ouvrir({
        width,
        height,
        game,
        url: `${BASE}/r/1/?entrer=jouer&pw=${pw}&ph=${ph}`,
      });
      const bad = [];
      try {
        await page.waitForSelector("#screen", { timeout: 20000 });
        await attendre(page, () => document.querySelector("#etiquetteManette") !== null, null, 4000);
        const avant = await lireLEtiquette(page);
        if (!avant.posee) bad.push("pas d'étiquette en tête de la bande, alors que le panneau n'a que ses lampes");
        else if (avant.lettres === 0) bad.push("l'étiquette de la bande n'a aucune lettre à mesurer");
        else if (avant.couvertes.length) bad.push(`menu fermé, l'étiquette est déjà couverte par ${avant.couvertes.join(", ")}`);
        else if (!(await ouvrirLeMenu(page))) bad.push("« Menu du jeu » n'ouvre pas le menu");
        else {
          await sleep(400);
          await page.screenshot({ path: join(OUT, `menu-etiquette-${width}x${height}-${game}-${pw}.png`) });
          const ouvert = await lireLEtiquette(page);
          if (!ouvert.posee) bad.push("l'étiquette de la bande disparaît quand le menu s'ouvre");
          else {
            if (ouvert.menu === null) bad.push("pas de #menu ouvert à mesurer");
            if (ouvert.surMenu > 0) bad.push(`le menu ${ouvert.menu} couvre ${ouvert.surMenu} px² des lettres de l'étiquette`);
            if (ouvert.couvertes.length) bad.push(`menu ouvert, les lettres de l'étiquette rendent ${ouvert.couvertes.join(", ")}`);
            // Le jumeau, au premier cas : l'étiquette poussée sous le menu
            // doit être vue couverte.
            if (bad.length === 0 && width === 667 && game === 0 && pw === 640) {
              await page.evaluate(() => {
                const e = document.querySelector("#etiquetteManette.n3-etiquette-bande");
                const m = document.querySelector("#menu").getBoundingClientRect();
                const r = e.getBoundingClientRect();
                e.style.position = "relative";
                e.style.zIndex = "0";
                e.style.left = `${m.left + 10 - r.left}px`;
                e.style.top = `${m.top + 60 - r.top}px`;
              });
              const pousse = await lireLEtiquette(page);
              if (pousse.surMenu === 0 || pousse.couvertes.length === 0)
                bad.push(`jumeau : l'étiquette poussée sous le menu n'est pas vue couverte (${JSON.stringify(pousse)})`);
            }
          }
        }
        bad.push(...errors.map((e) => `erreur de page : ${e}`));
      } finally {
        await page.close();
      }
      say(bad.length === 0, what, bad);
    }
  }

  // Étroite à la souris : la colonne est sous l'image, sans feuille, et Ctrl
  // agrandit l'image puis la rend.
  if (part("ctrl")) {
    const ouverts = (page) =>
      page.evaluate(() =>
        // Le menu n'est plus un dialogue (D30 amendé) : il compte quand même.
        [...document.querySelectorAll("dialog[open], section#menu")]
          .map((d) => (d.dataset.hauteur ? `${d.id}:${d.dataset.hauteur}` : d.id))
          .join(", "),
      );
    const ctrl = async (page) => {
      await page.keyboard.down("Control");
      await page.keyboard.up("Control");
      await sleep(500);
    };
    {
      const { page, errors } = await ouvrir({ width: 768, height: 1024, url: `${BASE}/r/1/?entrer=jouer` });
      const bad = [];
      try {
        await page.waitForSelector("#laSalle", { timeout: 20000 });
        await sleep(700);
        await page.keyboard.press("Escape");
        if (!(await attendre(page, () => document.querySelector("#menu") !== null))) bad.push("Échap n'ouvre pas le menu");
        await sleep(400);
        await ctrl(page);
        const sousMenu = await ouverts(page);
        await page.screenshot({ path: join(OUT, "ctrl-sous-menu-768x1024.png") });
        if (sousMenu !== "feuilleSalle:agrandie")
          bad.push(`Ctrl sous le menu : « ${sousMenu} » ouvert, la feuille agrandie seule attendue`);
        // Le jumeau : Ctrl referme la feuille, et rien ne reste.
        await ctrl(page);
        if ((await ouverts(page)) !== "") bad.push(`Ctrl ne referme pas la feuille : « ${await ouverts(page)} »`);
        await tap(page, "#laSalle");
        await attendre(page, () => document.querySelector("#feuilleSalle")?.open === true);
        await sleep(300);
        await ctrl(page);
        // Ctrl sur la feuille à mi-hauteur la ferme : un seul geste pour
        // revenir au jeu.
        const sousFeuille = await ouverts(page);
        if (sousFeuille !== "") bad.push(`Ctrl sur la feuille à mi-hauteur : « ${sousFeuille} » reste ouvert`);
      } catch (error) {
        bad.push(`le parcours s'arrête : ${error.message}`);
      }
      bad.push(...errors.map((e) => `erreur de page : ${e}`));
      say(bad.length === 0, "tablette au clavier, Ctrl sous le menu : la feuille agrandie, seule", bad);
      await page.close();
    }
    {
      // La manette « selon l'appareil » : l'étape 13 a laissé « toujours »
      // dans le stockage du navigateur, et une manette voulue par-dessus
      // l'écran porte son propre « La salle ».
      const { page, errors } = await ouvrir({
        width: 820,
        height: 900,
        coarse: false,
        url: `${BASE}/r/1/?entrer=jouer`,
        stockage: { "nel3ab:touchpad": "auto", "nel3ab:bare": "0" },
      });
      const bad = [];
      try {
        await page.waitForSelector("#side", { timeout: 20000 });
        await sleep(700);
        const vu = () =>
          page.evaluate(() => {
            const side = document.querySelector("#side")?.getBoundingClientRect();
            const toile = document.querySelector("#screen")?.getBoundingClientRect();
            return {
              side: side ? { top: side.top, height: side.height } : null,
              toile: toile ? { bottom: toile.bottom } : null,
              dialogue: document.querySelector("#side")?.closest("dialog") !== null,
              salle: document.querySelector('[data-geste="feuille"]') !== null,
            };
          });
        const avant = await vu();
        await page.screenshot({ path: join(OUT, "etroite-820x900.png") });
        if (!avant.side) bad.push("étroite, la colonne n'est pas montée");
        else {
          if (avant.dialogue) bad.push("étroite, la colonne est dans un dialogue");
          if (avant.toile && avant.side.top < avant.toile.bottom - 0.5)
            bad.push(`étroite, la colonne commence à ${Math.round(avant.side.top)} px, au-dessus du bas de l'image (${Math.round(avant.toile.bottom)})`);
          if (avant.side.height < 239.5) bad.push(`étroite, la colonne ne garde que ${Math.round(avant.side.height)} px`);
        }
        if (avant.salle) bad.push("étroite, un bouton « La salle » alors que la colonne se voit");
        await ctrl(page);
        const agrandie = await vu();
        if (agrandie.side) bad.push("Ctrl n'agrandit pas l'image d'une fenêtre étroite");
        await ctrl(page);
        if (!(await vu()).side) bad.push("le second Ctrl ne rend pas la colonne");
        if ((await ouverts(page)) !== "") bad.push(`un dialogue s'ouvre : « ${await ouverts(page)} »`);
      } catch (error) {
        bad.push(`le parcours s'arrête : ${error.message}`);
      }
      bad.push(...errors.map((e) => `erreur de page : ${e}`));
      say(bad.length === 0, "étroite à la souris : la colonne sous l'image, Ctrl agrandit", bad);
      await page.close();
    }
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

  // 15 bis. Ce que la page « manette seule » dit à voix haute, sur un lien
  // lent dont la médiane bouge chaque seconde (relecture finale du
  // 25 novembre 2026). Ses régions vivantes : la ligne parlée et l'état de
  // la manette, pas plus ; et aucune ne change plus d'une fois en 5 s. La
  // phrase « Tes touches mettent N ms à arriver. » était une troisième
  // région, relue à chaque seconde. Le jumeau : la phrase se lit bien sur
  // la page, avec son chiffre qui bouge.
  if (part("manette-seule-parle")) {
    const what = "manette seule sur un lien lent : deux régions parlées, aucune relue chaque seconde";
    const { page, errors } = await ouvrir({
      width: 390,
      height: 844,
      url: `${BASE}/r/1/?entrer=jouer&latence=lente`,
      stockage: { "nel3ab:padonly": "oui" },
    });
    const bad = [];
    try {
      await page.waitForSelector(".n3-manette-seule-latence", { timeout: 20000 });
      await sleep(1000);
      await page.evaluate(() => {
        const regions = [...document.querySelectorAll("[aria-live]:not([aria-live=off]), [role=status], [role=alert], [role=log]")];
        window.__regions = regions.map((r) => ({
          nom: `${r.tagName.toLowerCase()}#${r.id}.${[...r.classList].join(".")}`,
          textes: [r.textContent.trim()],
        }));
        regions.forEach((r, i) =>
          new MutationObserver(() => {
            const t = r.textContent.trim();
            const lu = window.__regions[i].textes;
            if (lu.at(-1) !== t) lu.push(t);
          }).observe(r, { childList: true, subtree: true, characterData: true }),
        );
        window.__phrases = [document.querySelector(".n3-manette-seule-latence").textContent];
        new MutationObserver(() => {
          const t = document.querySelector(".n3-manette-seule-latence")?.textContent;
          if (t && window.__phrases.at(-1) !== t) window.__phrases.push(t);
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
      });
      await sleep(5000);
      const lu = await page.evaluate(() => ({ regions: window.__regions, phrases: window.__phrases }));
      console.log(`  ${JSON.stringify(lu)}`);
      // Le jumeau : le chiffre bouge bien sur la page, sinon rien n'est exercé.
      if (lu.phrases.length < 3 || !lu.phrases.every((p) => /mettent \d+ ms/.test(p)))
        bad.push(`la phrase de latence ne bouge pas sur la page : ${JSON.stringify(lu.phrases)}`);
      const attendues = ["#controller-status", "#ligneParlee"];
      const autres = lu.regions.filter((r) => !attendues.some((id) => r.nom.includes(id)));
      if (autres.length) bad.push(`régions parlées en plus : ${autres.map((r) => `${r.nom} « ${r.textes.at(-1)} »`).join(", ")}`);
      for (const id of attendues)
        if (!lu.regions.some((r) => r.nom.includes(id))) bad.push(`la région ${id} manque : la mesure ne voit pas la page`);
      for (const r of lu.regions)
        if (r.textes.length > 2) bad.push(`${r.nom} relue ${r.textes.length - 1} fois en 5 s : ${JSON.stringify(r.textes)}`);
    } catch (error) {
      bad.push(`le parcours s'arrête : ${error.message}`);
    }
    bad.push(...errors.map((e) => `erreur de page : ${e}`));
    say(bad.length === 0, what, bad);
    await page.close();
  }

  // 20. Un spectateur tenu en main (qui a choisi de regarder) : pas de
  // manette (il n'a rien à envoyer),
  // et « Prendre la place N » dans la bande, joignable sans ouvrir la feuille.
  // En travers, une GameCube : le panneau debout dans la bande gauche. Le
  // jumeau : une page qui tient une place n'a pas ce bouton dans la bande.
  for (const [width, height, place] of part("spectateur")
    ? [
        [390, 844, "aucune"],
        [844, 390, "aucune"],
        [390, 844, "1"],
      ]
    : []) {
    const what = `${place === "aucune" ? "spectateur" : "joueur"} ${width}x${height}`;
    const { page, errors, zone } = await ouvrir({
      width,
      height,
      url: `${BASE}/r/1/?entrer=jouer&place=${place}`,
      stockage: { "nel3ab:touchpad": "auto" },
    });
    const bad = [];
    try {
      await page.waitForSelector("#screen", { timeout: 20000 });
      await page.waitForSelector("#bande", { timeout: 8000 });
      await sleep(700);
      await page.screenshot({ path: join(OUT, `${what.replace(" ", "-")}.png`) });
      const vu = await page.evaluate(() => ({
        pave: document.querySelector(".n3-pave") !== null,
        dansLaBande: document.querySelector("#bande #takePad") !== null,
        debout: document.querySelector('#panneau[data-forme="debout"]') !== null,
      }));
      if (place === "aucune") {
        if (vu.pave) bad.push("un spectateur a une manette à l'écran");
        if (!vu.dansLaBande) bad.push("« Prendre la place » n'est pas dans la bande");
        else bad.push(...dansLaZone("« Prendre la place »", await page.evaluate(boite, "#bande #takePad"), zone, width, height));
        if (width > height && !vu.debout) bad.push("en travers, le panneau n'est pas debout dans la bande gauche");
        bad.push(...(await page.evaluate(etat)));
      } else {
        if (!vu.pave) bad.push("la page qui tient une place n'a pas sa manette");
        if (vu.dansLaBande) bad.push("« Prendre la place » dans la bande d'une page qui tient une place");
      }
    } catch (error) {
      bad.push(`le parcours s'arrête : ${error.message}`);
    }
    bad.push(...errors.map((e) => `erreur de page : ${e}`));
    say(bad.length === 0, what, bad);
    await page.close();
  }

  // 16. La demande de place et la reprise de la salle : ni sous « La salle »,
  // ni sous l'encoche.
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
      await page.waitForSelector(OPENER, { timeout: 20000 });
      if (!(await attendre(page, () => window.__salonConnecte === true, null, 6000))) bad.push("le faux salon ne se connecte pas");
      await sleep(400);
      // La demande vit dans la bande tenue droite, jamais sur l'image. En
      // travers, la bande manque : « La salle » dit « Bo · ta place » et
      // s'ouvre sur la feuille agrandie, où la carte attend.
      const montrer = async (titre) => {
        if (await attendre(page, () => document.querySelector("#demandeRecue") !== null, null, 2000)) return true;
        const libelle = await page.evaluate((s) => document.querySelector(s)?.getAttribute("aria-label") ?? "", OPENER);
        if (!libelle.includes("Bo")) bad.push(`${titre} : « La salle » ne la dit pas (« ${libelle} »)`);
        await page.click(OPENER);
        return attendre(page, () => document.querySelector("#feuilleSalle #demandeRecue") !== null, null, 3000);
      };
      await page.evaluate(() => window.__salon.emit("asked", { from: "Bo", port: 1 }));
      if (!(await montrer("la demande de place"))) bad.push("la demande de place ne se montre pas");
      else {
        await sleep(400);
        await page.screenshot({ path: join(OUT, `demande-${width}x${height}.png`) });
        const deux = await page.evaluate(() => {
          const box = (s) => {
            const r = document.querySelector(s)?.getBoundingClientRect();
            return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
          };
          return {
            demande: box("#demandeRecue"),
            plus: box('[data-geste="feuille"]'),
            image: box("#screen"),
            dansLaFeuille: document.querySelector("#demandeRecue")?.closest("#feuilleSalle") != null,
          };
        });
        const { demande, plus, image, dansLaFeuille } = deux;
        // La toile est `#screen` elle-même. Jusqu'au 23 novembre 2026, ce cas
        // cherchait « #screen canvas », ne trouvait rien, et la garde de
        // l'image ne pouvait jamais rougir : la précondition est dite.
        if (!image) bad.push("précondition : la toile du jeu est introuvable");
        const croise = (a, b) =>
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
        if (demande && plus && croise(demande, plus)) bad.push("« La salle » mord sur la demande de place");
        // Tenue droite, la carte est dans la bande et ne touche pas l'image.
        // En travers, elle est dans la feuille agrandie que le joueur a ouverte
        // par « La salle » : cette feuille, un dialogue, couvre le bord gauche
        // de l'image (mesuré le 23 novembre 2026), et sa place est celle du
        // cadre de la salle, pas de la carte.
        const ou = width > height ? "feuille" : "bande";
        if (dansLaFeuille !== (ou === "feuille")) bad.push(`la demande n'est pas dans la ${ou}`);
        if (ou === "bande" && demande && image && croise(demande, image)) bad.push("la demande de place touche l'image du jeu");
        if (demande && demande.top < zone.top - 0.5) bad.push(`la demande commence à ${Math.round(demande.top)} px, sous l'encoche`);
        bad.push(...(await page.evaluate(etat)));
        for (const s of ["#giveSeat", "#keepSeat"]) bad.push(...dansLaZone(s, await page.evaluate(boite, s), zone, width, height));
        await page.click("#keepSeat");
        await page.evaluate(() => document.querySelector("#fermerFeuille")?.click());
      }
      await page.evaluate(() =>
        window.__salon.emit("recovery", { id: "banc", port: 1, from: "Bo", to: "Ami", asking: false, remaining: 30, reason: null }),
      );
      if (!(await montrer("la reprise"))) bad.push("la reprise de la salle ne se montre pas");
      else {
        await sleep(300);
        await page.screenshot({ path: join(OUT, `reprise-${width}x${height}.png`) });
        if (!(await page.$("#keepRecovery"))) bad.push("la reprise reçue n'offre pas « Garder ma place »");
        const r = await page.evaluate(boite, "#demandeRecue");
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

  // 21. Les places sous l'image (chantier personnes, 23 novembre 2026) : la
  // rangée des places ne touche jamais la toile. À 1440x900, une image 4:3
  // laisse la hauteur du panneau, et la rangée est dessous ; à 1280x720, elle
  // ne la laisse pas, et la rangée passe en tête de colonne ; tenue en main,
  // elle est sous l'image, debout dans la bande gauche en travers, ou en
  // petit quand l'écran est court. Le jumeau : la rangée posée exprès sur
  // l'image est vue.
  for (const [rang, { width, height, coarse, touchpad, game, image, attendue }, niveau] of part("places-sous-image")
    ? [...PLACES_CAS.entries()].flatMap(([rang, cas]) => ["sobre", "conseille", "tout"].map((niveau) => [rang, cas, niveau]))
    : []) {
    const what = `places hors de l'image ${width}x${height}${game === 1 ? " 16:9" : ""}, effets ${niveau}`;
    const { page, errors } = await ouvrir({
      width,
      height,
      coarse,
      game,
      url: `${BASE}/r/1/?entrer=jouer&${image}`,
      stockage: { "nel3ab:touchpad": touchpad, ...effetsAuNiveau(niveau) },
    });
    const bad = [];
    try {
      await page.waitForSelector("#screen", { timeout: 20000 });
      if (!(await attendre(page, placesVisibles, null, 6000))) bad.push("précondition : la rangée des places n'est pas visible");
      else {
        await sleep(400);
        await page.screenshot({ path: join(OUT, `places-${width}x${height}-${attendue}-${niveau}.png`) });
        const vu = await page.evaluate(placesEtToile);
        if (vu.toile === null) bad.push("précondition : pas de toile");
        else if (croiseLaToile(vu.ports, vu.toile))
          bad.push(`la rangée des places touche l'image : ${cadreDe(vu.ports)} contre ${cadreDe(vu.toile)}`);
        if (vu.cibles === 0) bad.push("précondition : aucune place à toucher dans la rangée");
        bad.push(...vu.defauts);
        if (vu.rangee !== attendue) bad.push(`la rangée est « ${vu.rangee} », « ${attendue} » attendue (panneau « ${vu.panneau} »)`);
        if (attendue === "rangee" && vu.toile && vu.ports.top < vu.toile.bottom - 0.5)
          bad.push(`la rangée « sous l'image » commence à ${Math.round(vu.ports.top)} px, l'image finit à ${Math.round(vu.toile.bottom)}`);
        if (attendue === "deux-rangees" && !vu.colonne) bad.push("la rangée en tête de colonne n'est pas dans la colonne");
        // Trop étroite, la rangée en petit est un bouton qui ouvre la salle,
        // où chaque place se prend.
        const toutes = await page.evaluate(() => document.querySelector("#placesToutes")?.checkVisibility() === true);
        if (attendue === "petite" && !toutes) bad.push("la rangée en petit de 114 px n'est pas devenue un seul bouton");
        if (toutes) {
          await tap(page, "#placesToutes");
          if (!(await attendre(page, (s) => document.querySelector(s) !== null, AGRANDIE, 3000))) bad.push("« les places » n'ouvre pas la salle agrandie");
          else if (!(await page.evaluate(() => document.querySelector("#feuilleSalle #port3")?.checkVisibility() === true)))
            bad.push("la salle agrandie ne montre pas la place 3");
        }
        // Le jumeau, une fois : la même mesure voit une rangée posée sur l'image.
        if (rang === 0 && niveau === "conseille") {
          await page.evaluate(leurreDesPlaces);
          const leurre = await page.evaluate(placesEtToile);
          say(
            croiseLaToile(leurre.ports, leurre.toile),
            "jumeau : la garde voit la rangée des places posée sur l'image",
          );
        }
      }
    } catch (error) {
      bad.push(`le parcours s'arrête : ${error.message}`);
    }
    bad.push(...errors.map((e) => `erreur de page : ${e}`));
    say(bad.length === 0, what, bad);
    await page.close();
  }

  // 22. Une arrivée ne passe jamais sur l'image (chantier personnes) : Cam
  // s'assied à la place 3, et pendant les 2,2 s où « 3P prêt ! » saute sur la
  // place, à chaque image, sa boîte ne coupe pas la toile, et le centre et
  // les quatre coins de la toile rendent la toile (`elementFromPoint`). La
  // précondition : « prêt ! » se voit, sinon l'arrivée n'a pas eu lieu et la
  // garde ne prouve rien. Le jumeau : un « prêt ! » posé exprès sur l'image
  // est vu, aux deux mesures.
  for (const [rang, { width, height, coarse, touchpad, game, image, attendue }, niveau] of part("arrivee")
    ? [...PLACES_CAS.entries()].flatMap(([rang, cas]) => ["conseille", "tout"].map((niveau) => [rang, cas, niveau]))
    : []) {
    const what = `arrivée hors de l'image ${width}x${height}, rangée ${attendue}, effets ${niveau}`;
    const { page, errors } = await ouvrir({
      width,
      height,
      coarse,
      game,
      url: `${BASE}/r/1/?entrer=jouer&${image}`,
      salon: true,
      stockage: { "nel3ab:touchpad": touchpad, ...effetsAuNiveau(niveau) },
    });
    const bad = [];
    try {
      await page.waitForSelector("#screen", { timeout: 20000 });
      // Une page ouverte sur une salle où Ami et Bo sont déjà assis : personne
      // n'arrive. Suivie dès que la toile existe, jusqu'à 2,6 s après que la
      // rangée se montre : un « prêt ! » de chargement durerait 2,2 s.
      const auChargement = page.evaluate(suivreLArrivee, 6000);
      if (!(await attendre(page, () => window.__salonConnecte === true, null, 6000))) bad.push("précondition : le faux salon ne se connecte pas");
      if (!(await attendre(page, placesVisibles, null, 6000))) bad.push("précondition : la rangée des places n'est pas visible");
      const charge = await auChargement;
      if (charge.pretVu > 0) bad.push(`une page ouverte sur une salle pleine allume « prêt ! » ${charge.pretVu} fois : ${charge.prets.join(", ")}`);
      // Les trois phrases d'une arrivée (`ARRIVEES` de lib/mots) : avec un
      // nom, un retour, ou une place tenue dont le salon n'a pas encore dit
      // le nom.
      for (const dite of charge.dites)
        if (/prend la place|revient à la place|La place \d est prise/.test(dite))
          bad.push(`une page ouverte sur une salle pleine annonce : « ${dite} »`);
      const auRepos = await page.evaluate(suivreLArrivee, 100);
      if (auRepos.cache.length > 0) bad.push(`précondition : au repos, la toile ne rend pas ses points : ${auRepos.cache[0]}`);
      if (bad.length === 0) {
        // Le suivi tourne dans la page pendant que le salon annonce Cam.
        const enCours = page.evaluate(suivreLArrivee, SUIVI_MS);
        await sleep(50);
        await page.evaluate((salle) => window.__salon.emit("room", salle), AVEC_CAM);
        const suivi = await enCours;
        await page.screenshot({ path: join(OUT, `arrivee-${width}x${height}-${attendue}-${niveau}.png`) });
        if (suivi.pretVu === 0) bad.push("précondition : « 3P prêt ! » ne s'est jamais vu, l'arrivée n'a pas eu lieu");
        if (suivi.prets.some((qui) => qui !== "3P")) bad.push(`Cam arrive à la place 3, et « prêt ! » s'allume sur ${suivi.prets.join(", ")}`);
        // L'arrivée se dit, une fois, dans la ligne parlée : la précondition
        // que la garde du chargement lit bien ce qui se dit.
        if (!suivi.dites.some((dite) => dite.includes("Cam prend la place 3."))) bad.push(`l'arrivée de Cam ne se dit pas : ${JSON.stringify(suivi.dites)}`);
        if (suivi.images < SUIVI_MS / 50) bad.push(`${suivi.images} images en ${SUIVI_MS} ms : la page n'a pas été suivie à chaque image`);
        bad.push(...suivi.croise.slice(0, 3), ...suivi.cache.slice(0, 3));
        console.log(
          `        ${what} : ${suivi.images} images, « prêt ! » sur ${suivi.pretVu}, écart au pire ${Math.round(suivi.pireEcart)} ms`,
        );
        if (rang === 0 && niveau === "conseille") {
          // Les jumeaux, chacun pour sa mesure : un « prêt ! » posé sur
          // l'image (sa boîte), puis un calque au-dessus d'elle
          // (`elementFromPoint`, qui ne voit pas ce qui laisse passer les
          // clics, comme « prêt ! » lui-même).
          const pose = await page.evaluate(() => {
            const c = document.querySelector("#screen").getBoundingClientRect();
            const pret = document.createElement("span");
            pret.className = "rt-pret";
            pret.textContent = "leurre";
            Object.assign(pret.style, { position: "fixed", left: `${c.left + 10}px`, top: `${c.top + 10}px`, width: "40px", height: "20px" });
            document.body.append(pret);
            return pret.getBoundingClientRect().width > 0;
          });
          const boiteVue = await page.evaluate(suivreLArrivee, 120);
          say(pose && boiteVue.croise.length > 0, "jumeau : la garde voit un « prêt ! » posé sur l'image");
          await page.evaluate(() => {
            const c = document.querySelector("#screen").getBoundingClientRect();
            const calque = document.createElement("div");
            Object.assign(calque.style, {
              position: "fixed",
              left: `${c.left + c.width / 2 - 20}px`,
              top: `${c.top + c.height / 2 - 20}px`,
              width: "40px",
              height: "40px",
              zIndex: "2147483647",
            });
            document.body.append(calque);
          });
          const pointVu = await page.evaluate(suivreLArrivee, 120);
          say(pointVu.cache.length > 0, "jumeau : la garde voit un calque sur le centre de l'image");
        }
      }
    } catch (error) {
      bad.push(`le parcours s'arrête : ${error.message}`);
    }
    bad.push(...errors.map((e) => `erreur de page : ${e}`));
    say(bad.length === 0, what, bad);
    await page.close();
  }

  // 23. Le clic sur une place libre reste une tâche courte : rien ne se joue
  // dans le même tour que le clic (chantier personnes). Mesuré sur la page
  // CONSTRUITE, React de production, le processeur ralenti quatre fois : la
  // page de Vite fait tourner React en développement, plusieurs fois plus
  // lent, et ne dirait rien du joueur. Le jumeau : un écouteur qui tient le
  // processeur 120 ms sur une autre place est vu.
  if (part("clic-court")) {
    const built = readFileSync(BUILT, "utf8");
    const { page, errors } = await ouvrir({
      width: 1440,
      height: 900,
      coarse: false,
      url: `${BASE}/construite/r/1/?entrer=jouer`,
      built,
    });
    const bad = [];
    try {
      await page.waitForSelector('#port4[data-state="free"]', { timeout: 20000 });
      await page.waitForSelector('#port3[data-state="free"]', { timeout: 2000 });
      await sleep(800);
      const cdp = await page.createCDPSession();
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      // Le travail du clic : du premier écouteur (window, capture) au dernier
      // (window, bulle), donc le gestionnaire de React, son rendu et ses
      // effets synchrones, qui passent entre les deux. Et les tâches longues
      // (plus de 50 ms) qui commencent avec lui, s'il en déborde.
      await page.evaluate(() => {
        window.__clics = [];
        window.__longues = [];
        let debut = 0;
        window.addEventListener("click", () => (debut = performance.now()), { capture: true });
        window.addEventListener("click", () => window.__clics.push({ a: debut, ms: performance.now() - debut }));
        new PerformanceObserver((liste) =>
          window.__longues.push(...liste.getEntries().map((e) => ({ a: e.startTime, ms: e.duration }))),
        ).observe({ type: "longtask" });
      });
      const clic = async (selector, fois) => {
        await page.evaluate(() => {
          window.__clics = [];
          window.__longues = [];
        });
        for (let i = 0; i < fois; i += 1) {
          await page.click(selector);
          await sleep(500);
        }
        return page.evaluate(() => ({
          clics: window.__clics.map((c) => c.ms),
          longues: window.__longues
            .filter((t) => window.__clics.some((c) => t.a + t.ms >= c.a - 1 && t.a <= c.a + c.ms + 1))
            .map((t) => t.ms),
        }));
      };
      const vu = await clic("#port4", 5);
      if (vu.clics.length !== 5) bad.push(`précondition : ${vu.clics.length} clics sur 5 ont atteint la page`);
      const pire = Math.max(...vu.clics);
      if (pire >= 50) bad.push(`le clic sur la place 4 travaille ${Math.round(pire)} ms au pire, à CPU x4`);
      for (const ms of vu.longues) bad.push(`une tâche longue de ${Math.round(ms)} ms commence avec un clic sur la place 4`);
      console.log(
        `        clic sur une place libre à CPU x4, cinq fois : ${vu.clics.map((ms) => Math.round(ms)).join(", ")} ms, ${vu.longues.length} tâche longue`,
      );
      await page.evaluate(() =>
        document.querySelector("#port3").addEventListener(
          "click",
          () => {
            const fin = performance.now() + 120;
            while (performance.now() < fin);
          },
          { capture: true },
        ),
      );
      const jumeau = await clic("#port3", 1);
      say(
        jumeau.clics.length === 1 && jumeau.clics[0] >= 100 && jumeau.longues.some((ms) => ms >= 100),
        "jumeau : la garde voit un clic qui tient le processeur 120 ms",
      );
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    } catch (error) {
      bad.push(`le parcours s'arrête : ${error.message}`);
    }
    bad.push(...errors.map((e) => `erreur de page : ${e}`));
    say(bad.length === 0, "le clic sur une place libre reste sous 50 ms, processeur ralenti quatre fois", bad);
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
