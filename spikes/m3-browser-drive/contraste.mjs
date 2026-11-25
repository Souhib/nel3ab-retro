// Le contraste EFFECTIF de chaque texte à l'écran, mesuré dans le vrai rendu.
//
// Pas une lecture du code: l'opacité s'accumule sur les ancêtres, le fond vient
// du premier ancêtre qui en peint un, et les trois coques n'ont pas les mêmes
// couleurs. Seul le rendu connaît le résultat.
//
// Le défaut du 31 août 2026 est né exactement là: une palette correcte
// multipliée par des opacités choisies à l'oeil, et personne pour faire le
// produit. Ce pilote fait le produit.
//
// Deux façons de le lancer:
//
//   node contraste.mjs http://localhost:8110/
//       contre une salle qui tourne: la page compilée dans le worker;
//
//   node contraste.mjs http://127.0.0.1:54xx/ --simule
//       contre un Vite SANS relais (`vite.planche.config.ts`, ou une
//       configuration jetable sans `proxy`), API simulées par interception:
//       les sources de l'arbre de travail, sans toucher aucune salle vivante.
//       Toute requête qui sort de cette origine est coupée.
//
// Trois trous bouchés le 22 novembre 2026 (audit d'accessibilité, A11Y-05):
//
// 1. Les couleurs étaient lues par `/rgba?\(/`. Tailwind 4 écrit `text-indigo/70`
//    en `oklab(… / 0.7)`, que ce motif ne lit pas: le pilote passait au texte
//    suivant (`continue`). Les titres de section de la colonne, à 2,86:1, ne
//    pouvaient donc pas le faire échouer. Toute couleur passe maintenant par une
//    toile de 1 sur 1, qui rend des octets quel que soit l'espace de couleur.
//
// 2. Un texte n'était mesuré que si UN de ses nœuds texte faisait plus d'un
//    caractère. React écrit `P{seat.port}` en DEUX nœuds, « P » et « 3 »: les
//    libellés de place, les plus regardés de la page, n'étaient jamais mesurés.
//    On mesure la somme des nœuds texte directs.
//
// 3. Un `<text>` SVG se peint par `fill`, pas par `color`: le libellé d'une prise
//    était mesuré dans une couleur qu'il ne porte pas. Et il se pose souvent sur
//    une forme du même dessin: son fond est cherché sous lui, parmi les formes.
//
// Ce que l'audit général ne voit pas: un bouton posé PAR-DESSUS l'image du jeu.
// Le fond est cherché chez les ancêtres, et l'image est une sœur: un tel bouton
// est mesuré contre le fond de la page. `.regie-nuit` existe pour ces
// boutons-là, et `surImage` mesure « montrer (Ctrl) » à part, sur lui-même.
import puppeteer from "puppeteer";
import { enterRoom } from "./open.mjs";

// L'adresse en ARGUMENT d'abord: la recette en passait une que le script ne
// lisait pas, et le défaut se voyait d'autant moins que la valeur par défaut
// pointait sur 8100 — un port qui n'existe plus depuis que les salles ont pris
// leurs propres ports (8110, 8120, 8130).
const url = process.argv.find((arg) => /^https?:\/\//.test(arg)) ?? process.env.NEL3AB_URL ?? "http://localhost:8110/";
const simule = process.argv.includes("--simule");
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Une salle inventée: deux places prises, deux libres, trois consoles. */
const ROMS = [
  { name: "Mario Kart Wii", maker: "Nintendo", about: "Course", art: false, console: "wii" },
  { name: "Super Smash Bros. Melee", maker: "HAL", about: null, art: false, console: "gc" },
  { name: "Zelda Tears of the Kingdom", maker: "Nintendo", about: null, art: false, console: "switch" },
];
const SALLE = {
  name: "salle 1",
  game: { index: 0, key: "0.iso", ...ROMS[0] },
  library: ROMS.map((g, index) => ({ index, key: `${index}.iso`, ...g })),
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
};

/** L'API simulée. Rien ne sort de l'origine servie: ni salle, ni salon. */
async function simuler(page) {
  const origine = new URL(url).origin;
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.protocol === "data:") return req.continue();
    if (u.origin !== origine) return req.abort();
    const p = u.pathname;
    const json = (body, status = 200) =>
      req.respond({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/room") return json(SALLE);
    if (p.startsWith("/api/")) return json({}, 404);
    if (p === "/roms") return json({ current: 0, roms: ROMS });
    if (p === "/formats") return json({ half: true });
    if (/^\/(socket\.io|video|sound|input|mic|clip|art)/.test(p)) return req.abort();
    return req.continue();
  });
}

const AUDIT = () => {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  // Toute couleur CSS (rgb, oklab, color-mix, color(srgb …)) passe par une toile.
  const toile = document.createElement("canvas");
  toile.width = toile.height = 1;
  const pinceau = toile.getContext("2d", { willReadFrequently: true });
  const memo = new Map();
  const parse = (css) => {
    if (!css || css === "transparent" || css === "none") return null;
    // Une valeur que la toile refuse (un `url(#dégradé)`) la laisserait sur le
    // noir posé juste avant, et un dégradé passerait pour un aplat noir.
    if (!CSS.supports("color", css)) return null;
    if (memo.has(css)) return memo.get(css);
    pinceau.clearRect(0, 0, 1, 1);
    pinceau.fillStyle = "#000";
    pinceau.fillStyle = css;
    pinceau.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = pinceau.getImageData(0, 0, 1, 1).data;
    const out = a === 0 ? null : { r, g, b, a: a / 255 };
    memo.set(css, out);
    return out;
  };
  const lum = (c) => 0.2126 * lin(c.r / 255) + 0.7152 * lin(c.g / 255) + 0.0722 * lin(c.b / 255);
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  // Le fond effectif: on empile ce que peignent les ancêtres jusqu'à l'opaque.
  const backdrop = (node) => {
    let stack = [];
    for (let n = node; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a >= 0.999) break;
      }
    }
    let out = { r: 255, g: 255, b: 255, a: 1 };
    for (const c of stack.reverse()) out = over(c, out);
    return out;
  };
  // L'opacité cumulée des ancêtres.
  const alpha = (node) => {
    let a = 1;
    for (let n = node; n; n = n.parentElement) a *= Number.parseFloat(getComputedStyle(n).opacity);
    return a;
  };
  // Un texte SVG est souvent posé sur une FORME du même dessin (la lettre d'un
  // bouton sur son capuchon), que la recherche par ancêtres ne voit pas: elle
  // mesurait « L2 », blanc sur une gâchette noire, contre le fond clair de la
  // page. On cherche la dernière forme opaque peinte AVANT le texte sous son
  // centre, par `isPointInFill`, qui ne dépend pas de `pointer-events`.
  const shapeUnder = (text) => {
    const svg = text.ownerSVGElement;
    if (!svg) return null;
    const box = text.getBoundingClientRect();
    const centre = new DOMPoint(box.left + box.width / 2, box.top + box.height / 2);
    const shapes = [...svg.querySelectorAll("path, rect, circle, ellipse, polygon")];
    for (let i = shapes.length - 1; i >= 0; i -= 1) {
      const shape = shapes[i];
      // Une forme qui vient APRÈS le texte est peinte par-dessus: hors jeu.
      if (shape.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_PRECEDING) continue;
      const css = getComputedStyle(shape);
      if (css.display === "none" || css.visibility === "hidden") continue;
      const fill = parse(css.fill);
      if (!fill) continue;
      const a = fill.a * Number.parseFloat(css.fillOpacity) * alpha(shape);
      if (a < 0.999) continue;
      const ctm = shape.getScreenCTM();
      if (!ctm) continue;
      const local = centre.matrixTransform(ctm.inverse());
      const point = svg.createSVGPoint();
      point.x = local.x;
      point.y = local.y;
      if (shape.isPointInFill(point)) return { ...fill, a: 1 };
    }
    return null;
  };

  const bad = [];
  let measured = 0;
  for (const node of document.querySelectorAll("body *")) {
    // La SOMME des nœuds texte directs: « P » et « 3 » font « P3 ».
    const own = [...node.childNodes]
      .filter((k) => k.nodeType === 3)
      .map((k) => k.textContent)
      .join("")
      .trim();
    if (own.length < 2) continue;
    const box = node.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const css = getComputedStyle(node);
    if (css.visibility === "hidden" || css.display === "none") continue;
    const size = Number.parseFloat(css.fontSize);
    const weight = Number.parseInt(css.fontWeight, 10) || 400;
    // Le seuil AA: 3:1 pour du gros texte, 4,5:1 sinon.
    const big = size >= 24 || (size >= 18.66 && weight >= 700);
    const want = big ? 3 : 4.5;
    // Un texte SVG se peint par `fill`.
    const ink = parse(node instanceof SVGElement ? css.fill : css.color);
    if (!ink) continue;
    const a = alpha(node) * ink.a;
    if (a < 0.02) continue;
    measured += 1;
    const back = (node instanceof SVGElement ? shapeUnder(node) : null) ?? backdrop(node);
    const got = ratio(over({ ...ink, a }, back), back);
    if (got < want) {
      bad.push({
        texte: own.slice(0, 42),
        px: Math.round(size),
        got: Number(got.toFixed(2)),
        want,
        alpha: Number(a.toFixed(2)),
        disabled: node.disabled === true || node.closest("[disabled]") !== null,
      });
    }
  }
  return { measured, bad };
};

/** Une page neuve, réglée avant le premier script. */
async function ouvrir(storage, scheme = "dark") {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
  await page.evaluateOnNewDocument((s) => {
    localStorage.setItem("nel3ab:name", "banc");
    localStorage.setItem("nel3ab:banc", "1");
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, storage);
  if (simule) await simuler(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await enterRoom(page);
  await wait(3500);
  return page;
}

/** Exige l'écran qu'on s'apprête à mesurer, au lieu de le supposer.
 *
 * Jusqu'au 22 novembre 2026, les coques Wii et Switch mesuraient trois fois
 * le même écran sous trois noms (61, 61, 61 textes). Deux flèches à droite
 * changent de rayon dans la croix de la PS3, mais avancent d'une case dans la
 * grille de la Wii et dans la rangée de la Switch; `#item-bindings` n'existait
 * donc pas, et le clic sur un élément absent ne faisait rien, en silence. */
async function exiger(page, selector, what) {
  if ((await page.$(selector)) === null) {
    throw new Error(`${what}: « ${selector} » absent, l'écran mesuré n'est pas celui qu'on croit`);
  }
}

/** Le menu, ouvert sur un rayon choisi par son bouton, qui existe dans les trois
 * coques (`#ray-<id>`): le clavier ne parcourt pas les trois formes pareil. */
async function rayon(page, id, what) {
  if ((await page.$("#ray-jeux")) === null) {
    await page.evaluate(() => document.querySelector("#openMenu")?.click());
    await wait(900);
  }
  await exiger(page, "#ray-jeux", `${what} (menu)`);
  // Le clic de l'élément lui-même, pas un clic aux coordonnées: dans la croix
  // de la PS3, les rayons glissent et se chevauchent pendant l'animation.
  await page.evaluate((sel) => document.querySelector(sel)?.click(), `#ray-${id}`);
  await wait(700);
  await exiger(page, `#ray-${id}[data-selected="true"]`, what);
}

/** Le panneau des touches, ouvert depuis les réglages: le configurateur, ou les
 * réglages Switch pour un jeu Switch. */
async function touches(page, what) {
  await exiger(page, "#item-bindings", `${what} (entrée du menu)`);
  await page.evaluate(() => document.querySelector("#item-bindings")?.click());
  await wait(900);
  // Le panneau de la colonne depuis le 24 novembre 2026 : les dialogues
  // `.n3-bindings` et `.n3-switch-setup` sont retirés.
  await exiger(page, "#reglage", what);
}

const screens = [];
for (const shell of ["ps3", "wii", "switch"]) {
  const page = await ouvrir({ "nel3ab:shell": shell });
  screens.push([`${shell} · colonne`, await page.evaluate(AUDIT)]);
  await rayon(page, "jeux", `${shell} · menu jeux`);
  screens.push([`${shell} · menu jeux`, await page.evaluate(AUDIT)]);
  await rayon(page, "reglages", `${shell} · menu réglages`);
  screens.push([`${shell} · menu réglages`, await page.evaluate(AUDIT)]);
  // « touches et manettes » vit sous « manettes » depuis le 22 novembre 2026.
  await rayon(page, "manettes", `${shell} · menu manettes`);
  screens.push([`${shell} · menu manettes`, await page.evaluate(AUDIT)]);
  await touches(page, `${shell} · touches`);
  screens.push([`${shell} · touches`, await page.evaluate(AUDIT)]);
  await page.close();
}
// Les deux régies, et le SÉLECTEUR, que rien ne regardait.
//
// Quatre passages et pas deux: le thème « comme l'appareil » sous un système
// sombre puis clair, et chaque choix explicite CONTRE le système. Un choix qui
// ne l'emporterait pas sur le système passerait sinon inaperçu, puisqu'il
// donnerait les mêmes couleurs que l'automatique.
//
// Sur la coque PS3 seule, et c'est délibéré: les coques Wii et Switch peignent
// des couleurs de console EN DUR et ne bougent pas d'un thème à l'autre.
const REGIES = [
  ["auto", "dark"],
  ["auto", "light"],
  ["nuit", "light"],
  ["jour", "dark"],
];
/** Ce qui flotte PAR-DESSUS l'image noire garde la régie de nuit.
 *
 * L'audit ne le voit pas (le fond est cherché chez les ancêtres, et l'image est
 * une sœur), si bien que retirer `.regie-nuit` ne faisait rien échouer: en
 * régie de jour, « montrer (Ctrl) » devenait une plaque blanche sur le noir.
 * Mesuré ici sur le bouton lui-même, colonne repliée par Ctrl. */
async function surImage(page, nom) {
  const jour = await page.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number);
    return r + g + b > 600;
  });
  await page.keyboard.press("Control");
  await wait(500);
  await exiger(page, "#unbare", `${nom} · colonne repliée`);
  const mesure = await page.evaluate(AUDIT_BOUTON, "#unbare");
  await page.keyboard.press("Control");
  await wait(300);
  return { jour, ...mesure };
}

const AUDIT_BOUTON = (selector) => {
  const toile = document.createElement("canvas");
  toile.width = toile.height = 1;
  const pinceau = toile.getContext("2d", { willReadFrequently: true });
  const rgb = (css) => {
    pinceau.clearRect(0, 0, 1, 1);
    pinceau.fillStyle = "#000";
    pinceau.fillStyle = css;
    pinceau.fillRect(0, 0, 1, 1);
    return [...pinceau.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = ([r, g, b]) => 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
  const el = document.querySelector(selector);
  const css = getComputedStyle(el);
  const fond = lum(rgb(css.backgroundColor));
  const encre = lum(rgb(css.color));
  const [hi, lo] = [fond, encre].sort((x, y) => y - x);
  return { fond: Number(fond.toFixed(3)), rapport: Number(((hi + 0.05) / (lo + 0.05)).toFixed(2)) };
};

const flottants = [];
for (const [theme, scheme] of REGIES) {
  const page = await ouvrir({ "nel3ab:shell": "ps3", "nel3ab:theme": theme }, scheme);
  const nom = `${theme} (système ${scheme === "dark" ? "sombre" : "clair"})`;
  screens.push([`colonne · ${nom}`, await page.evaluate(AUDIT)]);
  flottants.push([nom, await surImage(page, nom)]);
  await rayon(page, "reglages", `ps3 · réglages · ${nom}`);
  screens.push([`ps3 · réglages · ${nom}`, await page.evaluate(AUDIT)]);
  // Le sélecteur, ouvert sur l'entrée des thèmes.
  await page.evaluate(() => document.querySelector("#item-theme")?.click());
  await wait(700);
  // On VÉRIFIE qu'il est ouvert avant de mesurer.
  //
  // Sans ça, un clic qui rate laisse la page sur le menu des réglages, et
  // l'audit rend « rien à signaler » pour un écran qu'il n'a jamais vu: un
  // essai qui passe sans rien éprouver, ce qui est pire que pas d'essai.
  if ((await page.$("#pickerCancel")) === null) {
    throw new Error(
      `le sélecteur ne s'est pas ouvert (${nom}): l'écran mesuré n'est pas celui qu'on croit`,
    );
  }
  screens.push([`ps3 · sélecteur · ${nom}`, await page.evaluate(AUDIT)]);
  await page.close();
  // Le panneau des touches dans chaque régie: les manettes y sont des objets
  // aux couleurs fixes, et leurs inscriptions doivent se lire sur la page claire
  // comme sur la sombre.
  const panneau = await ouvrir({ "nel3ab:shell": "ps3", "nel3ab:theme": theme }, scheme);
  await rayon(panneau, "manettes", `ps3 · touches · ${nom}`);
  await touches(panneau, `ps3 · touches · ${nom}`);
  screens.push([`ps3 · touches · ${nom}`, await panneau.evaluate(AUDIT)]);
  await panneau.close();
}
await browser.close();

// Les commandes posées sur l'image: sombres dans les quatre régies, et lisibles.
// La précondition d'abord: au moins un passage doit avoir peint le jour, sinon
// « sombre » ne prouverait rien.
if (!flottants.some(([, f]) => f.jour)) throw new Error("aucun passage en régie de jour: le garde de l'image ne prouve rien");
let flottantsFaux = 0;
console.log("\n  == sur l'image (« montrer (Ctrl) », colonne repliée) ==");
for (const [nom, f] of flottants) {
  const ok = f.fond < 0.05 && f.rapport >= 4.5;
  if (!ok) flottantsFaux += 1;
  console.log(`     ${ok ? "ok  " : "RATÉ"} ${nom}: luminance du fond ${f.fond}, texte ${f.rapport}:1${f.jour ? " (page en jour)" : ""}`);
}

let total = 0;
for (const [where, { measured, bad }] of screens) {
  // La même précondition que le sélecteur: un écran où rien n'a été mesuré
  // n'est pas un écran propre, c'est un écran qu'on n'a pas vu.
  if (measured === 0) throw new Error(`${where}: aucun texte mesuré, l'écran n'est pas celui qu'on croit`);
  const real = bad.filter((b) => !b.disabled);
  total += real.length;
  console.log(`\n  == ${where} == ${measured} textes, ${real.length === 0 ? "rien à signaler" : `${real.length} sous le seuil`}`);
  for (const b of real.slice(0, 8)) {
    console.log(`     ${String(b.got).padStart(5)}:1 (veut ${b.want})  ${b.px}px  α${b.alpha}  « ${b.texte} »`);
  }
  const skipped = bad.length - real.length;
  if (skipped > 0) console.log(`     (${skipped} commande(s) désactivée(s), que WCAG exempte)`);
}
const echecs = total + flottantsFaux;
console.log(
  `\n  ${echecs === 0 ? "PASS — tout le texte tient son seuil" : `FAIL — ${total} textes sous le seuil, ${flottantsFaux} commande(s) claire(s) sur l'image`}`,
);
process.exit(echecs === 0 ? 0 : 1);
