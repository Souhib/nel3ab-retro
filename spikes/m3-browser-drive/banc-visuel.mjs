// Le banc d'essai, regardé. Vite sert l'aperçu, aucune salle n'est touchée.
//
//   node banc-visuel.mjs SORTIE.png
//       démarre son propre Vite avec `vite.planche.config.ts`, la configuration
//       SANS relais vers les salles: la configuration par défaut relaie `/api`,
//       `/video` et `/input` vers les ports vivants, et un pilote d'aperçu n'a
//       rien à y faire, même s'il n'y envoie rien aujourd'hui;
//
//   node banc-visuel.mjs SORTIE.png http://127.0.0.1:54xx/
//       contre un Vite sans relais déjà lancé.
//
// Les DEUX réglages du système, sombre puis clair. Depuis le 22 novembre 2026
// la page suit `prefers-color-scheme`: un pilote qui ne regarde qu'un côté
// laisse l'autre sans garde. C'est exactement ce qui est arrivé: la touche
// appuyée prenait le signal du thème, et tombait à 1,57:1 sur la manette
// standard en régie de jour, sans qu'aucun passage ne le voie.
import { spawn } from "node:child_process";
import puppeteer from "puppeteer";

const out = process.argv[2] ?? "/tmp/banc-visuel.png";
const given = process.argv.find((arg) => /^https?:\/\//.test(arg));
let vite = null;
if (!given) {
  // Un groupe de processus à lui : `npx` lance Vite comme enfant, et tuer
  // `npx` seul laissait Vite écouter sur 5471 après la fin du banc, ce qui
  // faisait échouer le lancement suivant (vu le 23 novembre 2026).
  vite = spawn("npx", ["vite", "--config", "vite.planche.config.ts", "--port", "5471", "--strictPort"], {
    cwd: new URL("../../front/", import.meta.url).pathname,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Vite n'a pas démarré")), 25000);
    vite.stdout.on("data", (b) => { if (/Local:/.test(String(b))) { clearTimeout(timer); resolve(); } });
  });
}
const base = given ?? "http://127.0.0.1:5471/";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
let failed = 0;
for (const scheme of ["dark", "light"]) {
console.log(`\n== système ${scheme === "dark" ? "sombre" : "clair"} ==`);
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => { pageErrors.push(e.message); console.log(`[pageerror] ${e.message}`); });
await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: 2 });
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
await page.goto(new URL("bench-preview.html", base).href, { waitUntil: "networkidle0" });
await page.waitForSelector("#banc [data-part]");
await page.waitForSelector("#banc [data-bench]");
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 700));
const shot = scheme === "dark" ? out : out.replace(/(\.png)?$/, "-clair.png");
await (await page.$("#banc")).screenshot({ path: shot });
console.log(`écrit ${shot}`);

// Le contraste, MESURÉ ici et pas ailleurs: `browser-contraste` tape le worker
// en vie, donc la page compilée dans son binaire. Il ne voit pas un écran qui
// n'a pas encore été déployé, et croire qu'il l'a vu est le piège exact que ce
// projet a déjà payé une fois.
//
// Les couleurs passent par une toile, comme plus bas: lire les trois premiers
// nombres d'une couleur prenait `oklab(0.6 0.04 -0.16 / 0.7)` pour du noir
// (le même trou que `contraste.mjs` avant le 22 novembre 2026).
const bad = await page.evaluate(() => {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgba = (color) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000";
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const lum = ({ r, g, b }) => {
    const [lr, lg, lb] = [r, g, b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const ground = rgba(getComputedStyle(document.getElementById("banc")).backgroundColor);
  const out = [];
  for (const el of document.querySelectorAll("#banc *")) {
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!text) continue;
    // Les lettres des manettes sont posées sur leurs capuchons, pas sur la
    // carte: `contraste.mjs` et `configuration-ui.mjs` les mesurent contre la
    // forme peinte sous elles. Ici on ne mesure que le texte du banc.
    if (el.closest("svg")) continue;
    const s = getComputedStyle(el);
    const size = Number.parseFloat(s.fontSize);
    // WCAG: 3:1 pour le grand texte (>=18.66px gras, ou >=24px), 4.5:1 sinon.
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const ink = rgba(s.color);
    // L'encre posée sur le fond selon son alpha: c'est ce que l'oeil reçoit.
    const seen = {
      r: ink.r * ink.a + ground.r * (1 - ink.a),
      g: ink.g * ink.a + ground.g * (1 - ink.a),
      b: ink.b * ink.a + ground.b * (1 - ink.a),
    };
    const got = ratio(seen, ground);
    if (got < need) out.push({ text: el.textContent.trim().slice(0, 24), size, got: got.toFixed(2), need });
  }
  return out;
});
// Et le TRAIT des schémas: un contour est un élément d'interface non textuel,
// donc 3:1 chez WCAG. Depuis le 21 novembre 2026 les manettes sont dessinées
// en volume, avec leurs vraies couleurs: une touche noire sur une coque noire
// est ce que la vraie manette montre, et ce n'est plus mesuré. Deux choses
// restent indispensables et le sont: la SILHOUETTE de la manette contre la
// page, et une touche APPUYÉE contre son logement (ou contre la page, pour une
// gâchette qui dépasse derrière la coque).
const thin = await page.evaluate(() => {
  // Toute couleur CSS ramenée à ses trois octets par un canevas: `color-mix`
  // rend `color(srgb 0.6 …)`, que lire les trois premiers nombres prendrait
  // pour du presque noir.
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgb = (color) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000";
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const lum = (color) => {
    const [r, g, b] = rgb(color).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const ground = getComputedStyle(document.body).backgroundColor;
  const out = [];
  // Sans place (la planche, un spectateur), puis à chacune des quatre places :
  // depuis le 23 novembre 2026, l'appui prend la couleur de la place.
  for (const place of [null, "1", "2", "3", "4"])
  for (const svg of document.querySelectorAll("svg[data-padmap]")) {
    if (place === null) delete svg.dataset.place;
    else svg.dataset.place = place;
    const shell = svg.querySelector(".n3-shell");
    const got = ratio(getComputedStyle(shell).stroke, ground);
    if (!(got >= 3)) out.push({ map: svg.dataset.padmap, what: "silhouette", got: got.toFixed(2) });
    // L'aplat de la coque, là où la plupart des touches sont posées. Il était
    // le milieu d'un dégradé jusqu'au 23 novembre 2026 ; c'est maintenant la
    // couleur même de la coque (aplats du thème rétro).
    const style = getComputedStyle(svg);
    const middle = getComputedStyle(shell).fill;
    for (const part of svg.querySelectorAll("[data-part]")) {
      part.setAttribute("data-lit", "oui");
      const capStyle = getComputedStyle(part.querySelector(".n3-cap"));
      const cap = capStyle.fill;
      // L'aplat OU l'anneau d'appui: l'un des deux doit trancher sur le fond.
      const both = (behind) => Math.max(ratio(cap, behind), ratio(capStyle.stroke, behind));
      // Une touche appuyée doit se détacher de son logement OU de la coque
      // autour: sur une manette blanche, le logement n'est qu'un fin liseré
      // gris et c'est la coque qui fait le fond. Une gâchette derrière la
      // coque se détache sur la page.
      // Une branche de croix n'a pas de logement à elle: son fond est la base
      // de la croix, de la couleur des touches.
      const well = part.querySelector(".n3-well, .n3-gate");
      const lit = part.dataset.under
        ? both(ground)
        : part.dataset.flush
          ? both(style.getPropertyValue("--pad-cap"))
          : Math.max(well ? both(getComputedStyle(well).fill) : 0, both(middle));
      part.setAttribute("data-lit", "non");
      if (!(lit >= 3))
        out.push({
          map: svg.dataset.padmap,
          what: `${part.dataset.part} appuyée${place ? `, place ${place}` : ""}`,
          got: lit.toFixed(2),
        });
    }
  }
  return out;
});
// Des chiffres qui ne gigotent pas. Le banc réécrit ses valeurs à la cadence
// de l'écran: si « 1 » est plus étroit que « 0 », toute la ligne tremble. Le
// 22 novembre 2026, les sous-ensembles Anybody n'avaient pas la fonction
// `tnum`, et `tabular-nums` ne faisait plus rien: « -0.11111 » mesurait 53,50 px
// et « -0.88888 » 56,28 px. Mesuré sur chaque valeur vivante, pas sur une.
const jitter = await page.evaluate(() => {
  const out = [];
  const values = [...document.querySelectorAll("#banc .n3-value")];
  for (const el of values) {
    const was = el.textContent;
    const widths = ["-0.00000", "-0.11111", "-0.88888", "100"].map((text) => {
      el.textContent = text;
      return el.getBoundingClientRect().width;
    });
    el.textContent = was;
    const [zero, one, eight] = widths;
    if (Math.max(zero, one, eight) - Math.min(zero, one, eight) > 0.5) {
      out.push({ widths: widths.slice(0, 3).map((w) => w.toFixed(2)), font: getComputedStyle(el).fontFamily.slice(0, 40) });
    }
  }
  return { count: values.length, out };
});
// La précondition d'abord: aucune valeur trouvée rendrait un vert vide.
if (jitter.count === 0) {
  console.log("  RATÉ: aucune valeur `.n3-value` dans le banc: l'écran n'est pas celui qu'on croit");
  failed += 1;
} else if (jitter.out.length) {
  console.log(`  RATÉ: ${jitter.out.length} valeur(s) sur ${jitter.count} changent de largeur avec leurs chiffres`);
  for (const j of jitter.out.slice(0, 4)) console.log(`    ${j.widths.join(" / ")} px  (${j.font})`);
  failed += jitter.out.length;
} else {
  console.log(`  ok: les ${jitter.count} valeurs gardent leur largeur, quels que soient leurs chiffres`);
}

if (thin.length) {
  console.log(`  RATÉ — ${thin.length} trait(s) sous 3:1`);
  for (const s of thin) console.log(`    ${s.map} · ${s.what}  ${s.got}:1 < 3:1`);
} else {
  console.log("  ok — tous les traits des schémas tiennent 3:1");
}

if (bad.length) {
  console.log(`  RATÉ — ${bad.length} texte(s) sous leur seuil`);
  for (const b of bad.slice(0, 12)) console.log(`    « ${b.text} » ${b.size}px  ${b.got}:1 < ${b.need}:1`);
} else {
  console.log("  ok — tout le texte du banc tient son seuil");
}
failed += bad.length + thin.length + pageErrors.length;
await page.close();
}
await browser.close();
if (vite) process.kill(-vite.pid, "SIGTERM");
process.exit(failed ? 1 : 0); // Un écart de contraste doit faire échouer la recette.
