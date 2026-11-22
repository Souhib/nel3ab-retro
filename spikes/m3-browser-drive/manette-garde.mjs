// La garde de la manette tactile : chaque touche reçoit son appui, et aucun
// geste de page ne se tient à moins de 12 px d'une touche de jeu.
//
// Pourquoi elle existe. Le 22 novembre 2026, l'audit mobile a tapé au centre de
// R sur un iPhone tenu droit : la manette a disparu, parce que « cacher » était
// posé sur R. Le haut de Y tombait aussi sur « cacher » en paysage, et la rangée
// d'outils de la manette Switch mordait sur L et sur le clic du stick. Aucun
// essai ne l'avait vu : jsdom ne pose rien, et le pilote `touch.mjs` ne
// comparait que huit boîtes entre elles, sans les gestes de page.
//
// Ce qu'elle vérifie, pour quatre salles (GameCube en 4:3 et en 16:9, Switch,
// Xbox 360) et sept tailles d'écran :
//
//   1. le centre et un point à 3 px de chacun des quatre bords de chaque
//      touche, et de chaque geste de page, reçoivent cet élément
//      (`elementFromPoint`) ;
//   2. un vrai appui de doigt au centre de chaque touche simple arrive au pavé
//      sous le nom de cette touche, et ne déclenche aucun geste de page ;
//   3. aucun geste de page n'est à moins de 12 px d'une touche de jeu ;
//   4. chaque cible fait au moins 44 px de côté, tient dans l'écran, et son
//      inscription tient dans la cible ;
//   5. en paysage, quand chaque groupe tient dans sa bande noire, aucune
//      touche ne mord sur l'image.
//
// Elle sert la page par Vite, avec une configuration écrite ici et SANS relais
// vers la salle : rien ne part vers les ports vivants, et toute requête hors de
// ce serveur est refusée par le navigateur. Le cache de Vite va dans un dossier
// temporaire, pas dans le `node_modules` partagé.
//
//   node manette-garde.mjs [dossier des captures]
//
// Port 5437 par défaut, ou MANETTE_GARDE_PORT. Sort en erreur au premier
// constat rouge, après avoir tout parcouru.
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const HERE = import.meta.dirname;
const REPO = resolve(HERE, "..", "..");
const FRONT = join(REPO, "front");
const PORT = Number(process.env.MANETTE_GARDE_PORT ?? 5437);
const OUT = resolve(process.argv[2] ?? join(tmpdir(), "manette-garde"));
const ENTRY = join(HERE, "manette-garde.entry.tsx");

// La règle elle-même. Douze pixels : la marge que l'audit du 22 novembre 2026
// demande entre un geste de page et une touche de jeu. Quarante-quatre : le
// plancher usuel d'une cible tactile (WCAG 2.5.5, Apple HIG).
const CLEARANCE = 12;
const FLOOR = 44;
// À 3 px du bord et pas sur le bord : un point SUR le bord appartient autant au
// voisin collé qu'à la touche, et la question est de savoir ce que reçoit un
// doigt qui vise le bord de la touche.
const INSET = 3;

const SIZES = [
  [375, 667],
  [390, 844],
  [430, 932],
  [844, 390],
  [932, 430],
  [768, 1024],
  [1024, 768],
];
const ROOMS = [
  { name: "gc-43", pad: "gc", pw: 640, ph: 480 },
  { name: "gc-169", pad: "gc", pw: 854, ph: 480 },
  { name: "switch", pad: "switch", pw: 1280, ph: 720 },
  { name: "x360", pad: "x360", pw: 1280, ph: 720 },
];

// Les touches de jeu et les gestes de page. Les marques `data-touche` et
// `data-geste` sont celles du pavé depuis le 22 novembre 2026 ; les autres
// sélecteurs sont ceux d'avant, gardés pour rejouer la garde sur l'ancien code
// et la voir échouer. Les retirer rendrait cette preuve impossible à refaire.
const GAME = [
  "[data-touche]",
  "#touchpad button[id^='touch-']",
  "#touchStick",
  ".n3-switch-touch-side button",
  ".n3-switch-touch-well",
].join(", ");
const PAGE = ["[data-geste]", "#wakeSound", "#showColumn", "#hideTouch", ".n3-switch-touch-tools button"].join(
  ", ",
);

// Vite, ses deux greffons, résolus depuis `front` : ce dossier-ci n'a que
// puppeteer.
const fromFront = createRequire(join(FRONT, "package.json"));
const load = async (name) => (await import(pathToFileURL(fromFront.resolve(name)).href)).default;
const { createServer } = await import(pathToFileURL(fromFront.resolve("vite")).href);
const react = await load("@vitejs/plugin-react");
const tailwind = await load("@tailwindcss/vite");

const PAGE_HTML = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Garde de la manette tactile</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/@fs${ENTRY}"></script>
  </body>
</html>`;

const cache = mkdtempSync(join(tmpdir(), "manette-garde-vite-"));
const server = await createServer({
  configFile: false,
  root: FRONT,
  cacheDir: cache,
  logLevel: "warn",
  plugins: [
    react(),
    tailwind(),
    {
      name: "manette-garde-page",
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/manette-garde.html")) return next();
          const html = await vite.transformIndexHtml(req.url, PAGE_HTML);
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(html);
        });
      },
    },
  ],
  // Aucun `proxy` : c'est toute la différence avec `npm run dev`.
  server: { host: "127.0.0.1", port: PORT, strictPort: true, hmr: false, fs: { allow: [REPO] } },
});
await server.listen();
const BASE = `http://127.0.0.1:${PORT}`;

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const failures = [];
const report = [];

/** Ce qui se mesure dans la page, pour une salle à une taille. */
function inspect({ GAME, PAGE, CLEARANCE, FLOOR, INSET }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const label = (el) =>
    el?.dataset?.touche ??
    el?.dataset?.geste ??
    (el?.id || el?.getAttribute?.("aria-label") || el?.textContent?.trim() || el?.tagName);
  const games = [...document.querySelectorAll(GAME)];
  const pages = [...document.querySelectorAll(PAGE)];
  const box = (el) => el.getBoundingClientRect();
  const owner = (hit) => [...games, ...pages].find((one) => one === hit || one.contains(hit)) ?? hit;
  const bad = [];
  for (const el of [...games, ...pages]) {
    const r = box(el);
    if (Math.min(r.width, r.height) < FLOOR - 0.5)
      bad.push(`${label(el)} mesure ${Math.round(r.width)}x${Math.round(r.height)} px`);
    if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5)
      bad.push(`${label(el)} sort de l'écran`);
    // Une inscription qui sort de sa touche: « CACHER » touchait les bords de
    // sa pastille de 72 px. Mesurée sur le texte lui-même: un bouton ne dit
    // pas son débordement par `scrollWidth`, et un texte qui passe à la ligne
    // déborde en hauteur, pas en largeur.
    if (el.tagName === "BUTTON" && el.textContent.trim()) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const t = range.getBoundingClientRect();
      if (t.left < r.left + 1 || t.right > r.right - 1 || t.top < r.top + 1 || t.bottom > r.bottom - 1)
        bad.push(`${label(el)} : l'inscription sort de la touche (${Math.round(t.width)}x${Math.round(t.height)} px)`);
    }
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const points = {
      centre: [cx, cy],
      haut: [cx, r.top + INSET],
      bas: [cx, r.bottom - INSET],
      gauche: [r.left + INSET, cy],
      droite: [r.right - INSET, cy],
    };
    for (const [where, [x, y]] of Object.entries(points)) {
      const got = owner(document.elementFromPoint(x, y));
      if (got !== el) bad.push(`${label(el)} (${where}) reçoit ${label(got)}`);
    }
  }
  for (const page of pages) {
    const p = box(page);
    for (const game of games) {
      const g = box(game);
      const dx = Math.max(0, g.left - p.right, p.left - g.right);
      const dy = Math.max(0, g.top - p.bottom, p.top - g.bottom);
      const gap = Math.hypot(dx, dy);
      if (gap < CLEARANCE) bad.push(`${label(page)} est à ${gap.toFixed(1)} px de ${label(game)}`);
    }
  }
  const screen = document.getElementById("screen")?.getBoundingClientRect();
  const onPicture = [];
  let covered = 0;
  if (screen) {
    for (const game of games) {
      const g = box(game);
      const w = Math.max(0, Math.min(g.right, screen.right) - Math.max(g.left, screen.left));
      const h = Math.max(0, Math.min(g.bottom, screen.bottom) - Math.max(g.top, screen.top));
      if (w * h > 0) onPicture.push(label(game));
      covered += w * h;
    }
  }
  return {
    games: games.map(label),
    pages: pages.map(label),
    bad,
    onPicture,
    covered: Math.round(covered),
    bar: screen ? Math.round(screen.left) : null,
    widest: Math.round(Math.max(0, ...games.map((el) => box(el).width))),
    simple: games
      .filter((el) => !el.matches("#touchStick, .n3-switch-touch-well, [data-touche='croix'], [data-touche^='stick']"))
      .map((el) => {
        const r = box(el);
        // Le nom de trame de la touche : sa marque, ou son identifiant
        // `touch-X` sur l'ancien pavé GameCube. L'ancien pavé Switch ne le
        // portait nulle part ; on vérifie alors qu'UNE touche est tenue.
        const frame = el.dataset.touche ?? (el.id.startsWith("touch-") ? el.id.slice(6) : null);
        return { name: label(el), frame, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }),
  };
}

/** Un vrai doigt sur une touche simple: arrive-t-elle au pavé, et elle seule ? */
async function tap(page, key) {
  await page.touchscreen.touchStart(key.x, key.y);
  await new Promise((r) => setTimeout(r, 40));
  const during = await page.evaluate(() => ({
    pressed: window.__garde.pressed(),
    gestures: window.__garde.gestures.length,
  }));
  await page.touchscreen.touchEnd();
  await new Promise((r) => setTimeout(r, 20));
  const after = await page.evaluate(() => ({
    pressed: window.__garde.pressed(),
    gestures: window.__garde.gestures.length,
    mounted: document.querySelector("[data-touche], #touchpad, .n3-switch-touch") !== null,
  }));
  return { during, after };
}

try {
  // Le jumeau négatif de la mesure elle-même : un geste posé exprès sur une
  // touche doit être vu. Sans ce contrôle, une garde qui ne trouverait jamais
  // rien passerait pour une manette sans défaut.
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/manette-garde.html?pad=gc&pw=640&ph=480`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("body[data-garde-pret]", { timeout: 20000 });
    await page.evaluate((GAME) => {
      const r = document.querySelector(GAME).getBoundingClientRect();
      const decoy = document.createElement("button");
      decoy.id = "garde-leurre";
      decoy.dataset.geste = "leurre";
      Object.assign(decoy.style, {
        position: "fixed",
        left: `${r.left + r.width / 2 - 24}px`,
        top: `${r.top + r.height / 2 - 24}px`,
        width: "48px",
        height: "48px",
        zIndex: "99",
      });
      document.body.append(decoy);
    }, GAME);
    const flagged = (await page.evaluate(inspect, { GAME, PAGE, CLEARANCE, FLOOR, INSET })).bad;
    await page.evaluate(() => document.getElementById("garde-leurre")?.remove());
    const seen = flagged.some((line) => line.includes("leurre"));
    console.log(`${seen ? "ok  " : "RATÉ"}  la garde voit un geste posé exprès sur une touche`);
    if (!seen) failures.push("jumeau négatif: le leurre n'a pas été vu");
    await page.close();
  }

  for (const room of ROOMS) {
    for (const [width, height] of SIZES) {
      const name = `${room.name}-${width}x${height}`;
      const page = await browser.newPage();
      await page.setViewport({ width, height, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        if (new URL(request.url()).origin !== BASE) request.abort();
        else request.continue();
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${BASE}/manette-garde.html?pad=${room.pad}&pw=${room.pw}&ph=${room.ph}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector("body[data-garde-pret]", { timeout: 20000 });
      await page.screenshot({ path: join(OUT, `${name}.png`) });
      const seen = await page.evaluate(inspect, { GAME, PAGE, CLEARANCE, FLOOR, INSET });
      const bad = [...seen.bad, ...errors.map((e) => `erreur de page: ${e}`)];
      // Les préconditions, affirmées et non supposées : une page qui n'aurait
      // monté aucune touche passerait sinon toutes les vérifications.
      // Dix pièces GameCube (L, Z, R, START, A, B, X, Y, la croix, le stick)
      // et quinze Pro (douze touches, la croix, deux sticks). L'ancien pavé en
      // avait plus, sa croix comptant pour quatre.
      const minimum = room.pad === "gc" ? 10 : 15;
      if (seen.games.length < minimum) bad.push(`${seen.games.length} touches trouvées, ${minimum} attendues au moins`);
      if (seen.pages.length !== 3) bad.push(`${seen.pages.length} gestes de page trouvés, 3 attendus`);
      // Dans le noir quand le noir suffit : en paysage, si la bande est plus
      // large que le plus large des groupes (plus 6 px de chaque côté).
      const landscape = width > height;
      if (landscape && seen.bar !== null && seen.bar >= seen.widest + 12 && seen.onPicture.length)
        bad.push(`bande de ${seen.bar} px, et pourtant sur l'image: ${seen.onPicture.join(", ")}`);
      for (const key of seen.simple) {
        const { during, after } = await tap(page, key);
        const wanted = key.frame ?? key.name;
        if (!after.mounted) {
          bad.push(`appuyer sur ${wanted} a fait disparaître la manette`);
          break;
        }
        if (during.gestures > 0 || after.gestures > 0) bad.push(`appuyer sur ${wanted} déclenche un geste de page`);
        const right = key.frame === null ? during.pressed.length === 1 : during.pressed.includes(key.frame);
        if (!right) bad.push(`appuyer sur ${wanted} donne [${during.pressed.join(" ")}]`);
        if (after.pressed.length) bad.push(`après ${wanted}, il reste [${after.pressed.join(" ")}]`);
        await page.evaluate(() => {
          window.__garde.gestures.length = 0;
        });
      }
      const line = `${bad.length ? "RATÉ" : "ok  "}  ${name.padEnd(20)} ${String(seen.games.length).padStart(2)} touches, bande ${String(seen.bar).padStart(3)} px, ${String(seen.covered).padStart(6)} px² sur l'image`;
      console.log(line);
      for (const one of bad) console.log(`        ${one}`);
      report.push({ name, ...seen, bad });
      if (bad.length) failures.push(name);
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
  rmSync(cache, { recursive: true, force: true });
}

console.log(`captures dans ${OUT}`);
if (failures.length) {
  console.log(`RATÉ  ${failures.length} cas : ${failures.join(", ")}`);
  process.exit(1);
}
console.log("ok    toutes les touches reçoivent leur appui, et les gestes de page restent à distance");
