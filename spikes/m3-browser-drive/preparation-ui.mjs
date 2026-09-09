/** Préparation et profils personnels dans le vrai configurateur, sur une page
 * isolée. Aucun serveur de jeu, aucune attribution réelle, aucun lancement.
 * Lancer Vite sur 5202, puis node preparation-ui.mjs.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer";
const base = new URL(process.env.CONFIGURATION_URL ?? "http://127.0.0.1:5202/bindings-preview.html");
assert.equal(base.pathname, "/bindings-preview.html");
base.search = "?preparation=1";
const output = "/tmp/nel3ab-preparation";
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({headless:true,args:["--no-sandbox"]});
try {
 const page = await browser.newPage();
 const errors = [];
 page.on("pageerror", e => { errors.push(String(e)); console.error(String(e)); });
 await page.setViewport({width:1440,height:1000});
 await page.goto(base.href);
 await page.waitForSelector('[data-padmap="dualshock"]');
  const sections = await page.$$eval("details.n3-diagnostics", nodes => nodes.map(node => ({title: node.querySelector("summary").textContent.trim(), open: node.open})));
  assert.equal(sections.length, 2);
  assert.match(sections[0].title, /^Toutes les correspondances/);
  assert.equal(sections[0].open, true);
  assert.match(sections[1].title, /^Diagnostic des boutons et des axes/);
  assert.equal(sections[1].open, false);
  await page.$eval("details.n3-diagnostics summary", node => node.click());
  assert.equal(await page.$eval("details.n3-diagnostics", node => node.open), false);
  await page.$eval("details.n3-diagnostics summary", node => node.click());

 const text = async label => page.locator(`::-p-aria(${label})`).click();
 assert.equal(await page.$eval('#launchPrepared', e=>e.disabled), true);
 await page.screenshot({path: `${output}/bureau.png`});
 await page.locator('.n3-preparation-saved summary').click();
 await page.type('[aria-label="Nom du nouveau profil de manette"]', 'Kart · DualSense');
 await text('Enregistrer un nouveau profil');
 await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('enregistré'));
 await page.select('[aria-label="Ma configuration pour ce jeu"]', '0');
 await text('Charger');
 await page.waitForFunction(()=>document.querySelector('[aria-label="Ma configuration pour ce jeu"]').value === '1');
 await page.reload();
 await page.waitForSelector('.n3-preparation-saved');
 await page.locator('.n3-preparation-saved summary').click();
 await page.select('[aria-label="Profil personnel de manette"]', 'Kart · DualSense');
 await text('Charger');
 await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('chargé'));
 await text('Je suis prêt');
 await page.waitForFunction(()=>document.querySelector('[aria-label="Ma configuration pour ce jeu"]').disabled);
 assert.equal(await page.$eval('#launchPrepared',e=>e.disabled),true);
 await page.evaluate(()=>window.previewReady());
 await page.waitForFunction(()=>!document.querySelector('#launchPrepared').disabled);
 await text('Lancer le jeu');
 assert.equal(await page.evaluate(()=>window.previewLaunched),true);
 await text('Modifier ma configuration');
 await text('Supprimer');
 assert.equal(await page.$$eval('[aria-label="Profil personnel de manette"] option',n=>n.length),2);
 await text('Confirmer la suppression');
 await page.waitForFunction(()=>document.querySelector('[aria-label="Profil personnel de manette"]').options.length === 1);
 for (const viewport of [{width:390,height:844},{width:844,height:390}]) {
  await page.setViewport(viewport);
  await page.reload();
  await page.waitForSelector('[data-padmap="dualshock"]');
  assert.equal(await page.$eval('#bindingsPanel', e => e.scrollWidth <= e.clientWidth + 2),true);
  await page.screenshot({path: `${output}/${viewport.width}.png`});
  await page.$eval('.n3-bindings-scroll', e => e.scrollTop = e.scrollHeight);
  await page.waitForFunction(()=>document.querySelector('.n3-bindings-scroll').scrollTop > 0);
  await page.$eval("#command", e => e.scrollIntoView({block:"center"}));
  const visible = await page.$eval('#command', e => {
    const box=e.getBoundingClientRect(); const area=e.closest('.n3-bindings-scroll').getBoundingClientRect();
    return box.top >= area.top && box.bottom <= area.bottom;
  });
  assert.ok(visible,'le choix de commande doit rester accessible en bas du défilement');
 }
 assert.deepEqual(errors,[]);
 console.log('OK · profils enregistrés/rechargés/supprimés, choix individuels, attente collective, défilement téléphone et paysage');
} finally { await browser.close(); }
