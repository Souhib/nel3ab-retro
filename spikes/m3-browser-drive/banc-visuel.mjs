// Le banc d'essai, regardé. Vite sert l'aperçu, aucune salle n'est touchée.
import { spawn } from "node:child_process";
import puppeteer from "puppeteer";

const out = process.argv[2] ?? "/tmp/banc-visuel.png";
const vite = spawn("npx", ["vite", "--port", "5201", "--strictPort"], {
  cwd: new URL("../../front/", import.meta.url).pathname,
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Vite n'a pas démarré")), 25000);
  vite.stdout.on("data", (b) => { if (/Local:/.test(String(b))) { clearTimeout(timer); resolve(); } });
});
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => { pageErrors.push(e.message); console.log(`[pageerror] ${e.message}`); });
await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: 2 });
await page.goto("http://localhost:5201/bench-preview.html", { waitUntil: "networkidle0" });
await page.waitForSelector("#banc [data-part]");
await page.waitForSelector("#banc [data-bench]");
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 700));
await (await page.$("#banc")).screenshot({ path: out });
console.log(`écrit ${out}`);

// Le contraste, MESURÉ ici et pas ailleurs: le balayage des sept thèmes tape le
// worker en vie, donc la page compilée dans son binaire. Il ne voit pas un écran
// qui n'a pas encore été déployé, et croire qu'il l'a vu est le piège exact que
// ce projet a déjà payé une fois.
const bad = await page.evaluate(() => {
  const lum = (c) => {
    const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const ground = getComputedStyle(document.getElementById("banc")).backgroundColor;
  const out = [];
  for (const el of document.querySelectorAll("#banc *")) {
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!text) continue;
    const s = getComputedStyle(el);
    const size = Number.parseFloat(s.fontSize);
    // WCAG: 3:1 pour le grand texte (>=18.66px gras, ou >=24px), 4.5:1 sinon.
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(s.color, ground);
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
  for (const svg of document.querySelectorAll("svg[data-padmap]")) {
    const shell = svg.querySelector(".n3-shell");
    const got = ratio(getComputedStyle(shell).stroke, ground);
    if (!(got >= 3)) out.push({ map: svg.dataset.padmap, what: "silhouette", got: got.toFixed(2) });
    // Le milieu du dégradé de la coque, là où la plupart des touches sont posées.
    const style = getComputedStyle(svg);
    const [top, bottom] = ["--pad-shell-top", "--pad-shell-bottom"].map((name) => rgb(style.getPropertyValue(name)));
    const middle = `rgb(${top.map((v, i) => Math.round((v + bottom[i]) / 2)).join(",")})`;
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
      if (!(lit >= 3)) out.push({ map: svg.dataset.padmap, what: `${part.dataset.part} appuyée`, got: lit.toFixed(2) });
    }
  }
  return out;
});
if (thin.length) {
  console.log(`  RATÉ — ${thin.length} trait(s) sous 3:1`);
  for (const s of thin) console.log(`    ${s.map} · ${s.what}  ${s.got}:1 < 3:1`);
} else {
  console.log("  ok — tous les traits des schémas tiennent 3:1");
}

if (bad.length) {
  console.log(`  RATÉ — ${bad.length} texte(s) sous leur seuil`);
  for (const b of bad) console.log(`    « ${b.text} » ${b.size}px  ${b.got}:1 < ${b.need}:1`);
} else {
  console.log("  ok — tout le texte du banc tient son seuil");
}
await browser.close();
vite.kill("SIGTERM");
process.exit(bad.length || thin.length || pageErrors.length ? 1 : 0); // Un écart de contraste doit faire échouer la recette.
