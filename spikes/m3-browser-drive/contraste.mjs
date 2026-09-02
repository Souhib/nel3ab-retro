// Le contraste EFFECTIF de chaque texte à l'écran, mesuré dans le vrai rendu.
//
// Pas une lecture du code: l'opacité s'accumule sur les ancêtres, le fond vient
// du premier ancêtre qui en peint un, et les trois coques n'ont pas les mêmes
// couleurs. Seul le rendu connaît le résultat.
//
// Le défaut du 31 août 2026 est né exactement là: une palette correcte
// multipliée par des opacités choisies à l'oeil, et personne pour faire le
// produit. Ce pilote fait le produit.
import puppeteer from "puppeteer";
import { enterRoom } from "./open.mjs";

const url = process.env.NEL3AB_URL ?? "http://localhost:8100/";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const AUDIT = () => {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const parse = (css) => {
    const m = /rgba?\(([^)]+)\)/.exec(css);
    if (!m) return null;
    const p = m[1].split(",").map((v) => Number.parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
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

  const bad = [];
  for (const node of document.querySelectorAll("body *")) {
    const own = [...node.childNodes].some((k) => k.nodeType === 3 && k.textContent.trim().length > 1);
    if (!own) continue;
    const box = node.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const css = getComputedStyle(node);
    if (css.visibility === "hidden" || css.display === "none") continue;
    const size = Number.parseFloat(css.fontSize);
    const weight = Number.parseInt(css.fontWeight, 10) || 400;
    // Le seuil AA: 3:1 pour du gros texte, 4,5:1 sinon.
    const big = size >= 24 || (size >= 18.66 && weight >= 700);
    const want = big ? 3 : 4.5;
    const ink = parse(css.color);
    if (!ink) continue;
    const a = alpha(node) * ink.a;
    if (a < 0.02) continue;
    const got = ratio(over({ ...ink, a }, backdrop(node)), backdrop(node));
    if (got < want) {
      bad.push({
        texte: node.textContent.trim().slice(0, 42),
        px: Math.round(size),
        got: Number(got.toFixed(2)),
        want,
        alpha: Number(a.toFixed(2)),
        disabled: node.disabled === true || node.closest("[disabled]") !== null,
      });
    }
  }
  return bad;
};

const screens = [];
for (const shell of ["ps3", "wii", "switch"]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((s) => {
    localStorage.setItem("nel3ab:name", "banc");
    localStorage.setItem("nel3ab:banc", "1");
    localStorage.setItem("nel3ab:shell", s);
  }, shell);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await enterRoom(page);
  await wait(3500);
  await page.evaluate(() => document.querySelector("#openMenu")?.click());
  await wait(900);
  screens.push([`${shell} · menu jeux`, await page.evaluate(AUDIT)]);
  await page.keyboard.press("ArrowRight"); await wait(250);
  await page.keyboard.press("ArrowRight"); await wait(600);
  screens.push([`${shell} · menu réglages`, await page.evaluate(AUDIT)]);
  await page.evaluate(() => document.querySelector("#item-bindings")?.click());
  await wait(900);
  screens.push([`${shell} · touches`, await page.evaluate(AUDIT)]);
  await page.close();
}
await browser.close();

let total = 0;
for (const [where, bad] of screens) {
  const real = bad.filter((b) => !b.disabled);
  total += real.length;
  console.log(`\n  == ${where} == ${real.length === 0 ? "rien à signaler" : `${real.length} sous le seuil`}`);
  for (const b of real.slice(0, 8)) {
    console.log(`     ${String(b.got).padStart(5)}:1 (veut ${b.want})  ${b.px}px  α${b.alpha}  « ${b.texte} »`);
  }
  const skipped = bad.length - real.length;
  if (skipped > 0) console.log(`     (${skipped} commande(s) désactivée(s), que WCAG exempte)`);
}
console.log(`\n  ${total === 0 ? "PASS — tout le texte tient son seuil" : `FAIL — ${total} textes sous le seuil`}`);
process.exit(total === 0 ? 0 : 1);
