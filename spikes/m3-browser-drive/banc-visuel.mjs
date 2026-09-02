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
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: 2 });
await page.goto("http://localhost:5201/bench-preview.html", { waitUntil: "networkidle0" });
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
// donc 3:1 chez WCAG. Le trait était le liseré d'une pièce remplie, où il
// n'avait rien à porter; devenu le dessin lui-même, il doit se voir.
const thin = await page.evaluate(() => {
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
  const ground = getComputedStyle(document.body).backgroundColor;
  const out = [];
  for (const svg of document.querySelectorAll("svg[data-padmap]")) {
    for (const cls of ["n3-shell", "n3-gate"]) {
      const el = svg.querySelector(`.${cls}`);
      if (!el) continue;
      const got = ratio(getComputedStyle(el).stroke, ground);
      if (got < 3) out.push({ map: svg.dataset.padmap, what: cls, got: got.toFixed(2) });
    }
    const part = svg.querySelector('g[data-part] circle:not(.n3-gate), g[data-part] rect');
    if (part) {
      const got = ratio(getComputedStyle(part).stroke, ground);
      if (got < 3) out.push({ map: svg.dataset.padmap, what: "pièce", got: got.toFixed(2) });
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
process.exit(0); // Vite garde la boucle en vie, et ce script a fini.
