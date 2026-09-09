/** Le configurateur réel, sans socket ni écriture dans la salle.
 * Lancer Vite sur 5202 puis `node configuration-ui.mjs`. Une manette est simulée
 * dans la page de prévisualisation. Les captures vont dans /tmp. Toute panne
 * sort en code non nul; ce pilote ne doit jamais viser le worker en service.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer";
const base = new URL(process.env.CONFIGURATION_URL ?? "http://127.0.0.1:5202/bindings-preview.html");
assert.equal(base.pathname, "/bindings-preview.html");
const output = process.env.CONFIGURATION_SHOTS ?? "/tmp/nel3ab-configuration";
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));
  const press = (index, value) => page.evaluate((at, level) => Object.assign(window.previewPad.buttons[at], { pressed: !!level, value: level }), index, value);
  const shot = async (name) => {
    // Les cases Wii entrent avec un délai. Leur rectangle existe avant leur
    // peinture : attendre la fin des animations d'entrée, sans attendre les
    // pulsations de sélection qui sont perpétuelles.
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})));
    });
    return page.screenshot({ path: `${output}/${name}.png` });
  };
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(base.href);
  await page.waitForSelector("#bindingsPanel");
  assert.equal(await page.$("#reading"), null, "un jeu GameCube ne propose aucun appareil Wii");
  assert.equal(await page.$eval("#bindingsPanel", node => node.textContent.includes("en salle")), false);
  await page.goto(`${base.href}?console=wii`);
  await page.waitForSelector("#reading");
  assert.equal(await page.$eval(".n3-reading-choice", node => node.textContent.includes("en salle")), true);
  await page.waitForSelector('[data-padmap="dualshock"]');
  const sections = await page.$$eval("details.n3-diagnostics", nodes => nodes.map(node => ({title: node.querySelector("summary").textContent.trim(), open: node.open})));
  assert.equal(sections.length, 2);
  assert.equal(await page.$eval(".n3-mapping-list", e => getComputedStyle(e).gridTemplateColumns.split(" ").length), 1);
  assert.match(sections[0].title, /^Toutes les correspondances/);
  assert.equal(sections[0].open, true);
  assert.match(sections[1].title, /^Diagnostic des boutons et des axes/);
  assert.equal(sections[1].open, false);
  await page.$eval("details.n3-diagnostics summary", node => node.click());
  assert.equal(await page.$eval("details.n3-diagnostics", node => node.open), false);
  await page.$eval("details.n3-diagnostics summary", node => node.click());

  assert.equal(await page.$eval("#bindingsPanel", (node) => node.open), true);
  // Le texte est mesuré sur la couleur effective de son bouton. Le canvas
  // convertit aussi color(srgb ...) en nombres 8 bits.
  const contrast = await page.evaluate(() => {
    const context = document.createElement("canvas").getContext("2d");
    const luminance = (color) => {
      context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      const [r, g, b] = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => {
        const v = value / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratios = [];
    for (const theme of ["instrument-sombre", "instrument-clair", "phosphore", "ambre", "indigo", "famicom", "gameboy"]) {
      document.documentElement.dataset.theme = theme;
      for (const piece of document.querySelectorAll("[data-part]")) {
        const cap = piece.querySelector(".n3-cap");
        for (const lit of ["non", "oui"]) {
          piece.dataset.lit = lit;
          for (const text of piece.querySelectorAll("text, .n3-glyph")) {
            const a = luminance(getComputedStyle(cap).fill);
            const glyph = text.classList.contains("n3-glyph");
            const b = luminance(getComputedStyle(text)[glyph ? "stroke" : "fill"]);
            ratios.push({ theme, part: piece.dataset.part, lit, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), need: glyph ? 3 : 4.5 });
          }
        }
        piece.dataset.lit = "non";
      }
    }
    document.documentElement.dataset.theme = "instrument-sombre";
    return ratios;
  });
  assert.ok(contrast.length > 100, "la mesure doit lire les vrais boutons");
  assert.deepEqual(contrast.filter((one) => !Number.isFinite(one.ratio) || one.ratio < one.need), []);
  console.log(`Contraste des inscriptions: minimum ${Math.min(...contrast.map((one) => one.ratio)).toFixed(2)}:1, sept thèmes, deux états`);
  await shot("bureau");
  await page.click('[data-part="B"][role="button"]');
  assert.equal(await page.$eval("#command", (node) => node.value), "B");
  await page.select("#command", "A");
  await page.click("#pad-A");
  await page.waitForSelector(".n3-inline-capture");
  await press(1, 1);
  await page.waitForFunction(() => document.querySelector('[data-part="A"]')?.dataset.lit === "oui");
  assert.equal(await page.$eval('[data-part="b1"]', (node) => node.dataset.lit), "oui");
  assert.equal(await page.$eval('[data-part="b0"]', (node) => node.dataset.lit), "non");
  await press(1, 0);
  await page.select("#reading", "0");
  assert.equal(await page.$eval(".n3-reading-choice", node => node.textContent.includes("aperçu")), true);
  await page.click("#view-table");
  await page.waitForSelector('[data-padmap="wiimote"]');
  await page.click("#key-x-negative");
  await page.keyboard.press("v");
  await page.waitForFunction(() => document.querySelector("#key-x-negative")?.textContent.includes("V"));
  // Les quatre directions se capturent depuis les vrais boutons, y compris
  // celles que l'ancien tableau ne proposait pas (gauche et bas).
  for (const [id, code, transform] of [
    ["x-negative", "ArrowLeft", /^translate\(-[\d.]+ 0.00\)$/],
    ["x", "ArrowRight", /^translate\([\d.]+ 0.00\)$/],
    ["y", "ArrowUp", /^translate\(0.00 -[\d.]+\)$/],
    ["y-negative", "ArrowDown", /^translate\(0.00 [\d.]+\)$/],
  ]) {
    await page.click(`#key-${id}`);
    await page.keyboard.press(code);
    await page.waitForFunction(() => !document.querySelector('[data-capturing="true"]'));
    await page.click(".n3-keyboard-test");
    await page.keyboard.down(code);
    await page.waitForFunction((code) => document.querySelector(`[data-code="${code}"]`)?.dataset.lit === "oui", {}, code);
    assert.match(await page.$eval('[data-stick="x"] .n3-stick-body', node => node.getAttribute("transform")), transform);
    assert.equal(await page.$eval('[data-part="D_LEFT"]', node => node.dataset.lit), "non");
    await page.keyboard.up(code);
    await page.waitForFunction(() => !document.querySelector('[data-lit="oui"]'));
  }
  await shot("clavier-bureau");
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.waitForSelector("#view-table");
  await page.click("#view-table");
  await page.waitForSelector(".n3-keyboard-test");
  await shot("clavier-telephone");
  assert.equal(await page.$eval(".n3-bindings-content", node => node.scrollWidth <= node.clientWidth + 1), true);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.click("#view-profiles");
  await page.type("#profileName", "Mon clavier");
  await page.click("#newKeys");
  await page.waitForFunction(() => document.querySelector("#keyProfile")?.value === "Mon clavier");
  await page.type("#profileName", "Mon clavier");
  assert.equal(await page.$eval("#newKeys", (node) => node.disabled), true);
  await page.click("#view-schema");
  for (const value of ["1", "2", "0"]) { await page.select("#reading", value); await shot(`lecture-${value}`); }
  await page.evaluate(() => document.documentElement.dataset.theme = "instrument-clair");
  await shot("clair");
  await page.evaluate(() => document.documentElement.dataset.theme = "instrument-sombre");
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await shot("telephone");
  assert.equal(await page.$eval(".n3-bindings-content", (node) => node.scrollWidth <= node.clientWidth + 1), true);
  await page.locator("#learnPad").click();
  await page.locator('::-p-text(Commencer)').click();
  await page.waitForSelector("progress");
  await shot("apprentissage-telephone");
  await press(0, 1);
  await page.waitForFunction(() => document.querySelector("progress")?.value === 1);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("progress"));
  assert.equal(await page.$eval("#bindingsPanel", (node) => node.open), true);
  await press(0, 0);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#bindingsPanel"));
  await page.goto(`${base.href}?pad=unknown`);
  await page.waitForSelector("#resetPad:not([disabled])");
  await page.click("#resetPad");
  assert.equal(await page.$("progress"), null);
  await page.locator('::-p-text(Commencer)').click();
  await page.waitForSelector("progress");
  assert.equal(await page.$eval("#bindingsPanel", (node) => node.open), true);
  await shot("adaptateur");
  for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
    await page.setViewport(viewport);
    await page.goto(`${base.href}?shell=wii`);
    await page.waitForSelector('#item-0[data-selected="true"]');
    await page.mouse.move(0, 0);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowUp");
    await page.waitForSelector('#item-1[data-selected="true"]');
    for (let at = 0; at < 3; at++) await page.keyboard.press("ArrowDown");
    await page.waitForSelector('#item-13[data-selected="true"]');
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => {
      const node = document.querySelector('#item-13[data-selected="true"]');
      const area = node?.parentElement.parentElement;
      if (!area || area.scrollTop <= 0) return false;
      const box = node.getBoundingClientRect();
      const visible = area.getBoundingClientRect();
      return box.top >= visible.top - 8 && box.bottom <= visible.bottom + 8;
    });
    await shot(`wii-${viewport.width}`);
    for (let at = 0; at < 3; at++) await page.keyboard.press("ArrowUp");
    await page.waitForFunction(() => {
      const node = document.querySelector('#item-1[data-selected="true"]');
      if (!node) return false;
      const area = node.parentElement.parentElement.getBoundingClientRect();
      return node.getBoundingClientRect().top >= area.top - 8;
    });
  }
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${base.href}?shell=switch`);
  await page.waitForSelector("#item-13");
  assert.equal(await page.$$eval('[id^="item-"]', (nodes) => nodes.length), 14);
  assert.equal(await page.$$eval('[id^="item-"]', (nodes) => nodes.every((node, at) => node.textContent.includes(`Réglage ${at + 1}`))), true);
  await shot("switch-reglages");
  assert.deepEqual(errors, []);
  console.log(`OK · capture, clavier, profils, apprentissage, annulation, téléphone, menus Wii et Switch · ${output}`);
} finally { await browser.close(); }
