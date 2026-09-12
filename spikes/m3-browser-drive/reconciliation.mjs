/** La liste du salon est-elle MISE À JOUR, ou refaite à chaque tour ?
 *
 * Elle se reconstruisait entièrement toutes les cinq secondes: chaque carte
 * était remplacée par un noeud neuf, donc l'animation d'apparition repartait et
 * le focus du clavier retombait sur le corps de la page. Lire le source ne le
 * prouve pas; il faut regarder si le NOEUD survit à deux tours de sondage.
 *
 * Le témoin est un `dataset` que la page ne réécrit jamais: il survit si et
 * seulement si la carte n'a pas été refaite.
 */
import assert from "node:assert/strict";
import puppeteer from "puppeteer";

const SALON = process.argv[2] ?? "http://127.0.0.1:8200/";
const dors = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, ouverte;
try {
  const reponse = await fetch(new URL("api/salles", SALON), { method: "POST" });
  assert.ok(reponse.ok, `le salon refuse d'ouvrir une salle: ${reponse.status}`);
  ouverte = await reponse.json();
  console.log(`salle ${ouverte.numero} ouverte pour l'essai`);

  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(SALON, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("a.salle") !== null, { timeout: 15_000 });

  // La cascade: le CSS lit `--rang`, que personne ne posait.
  const rang = await page.$eval("a.salle", (e) => e.style.getPropertyValue("--rang"));
  assert.notEqual(rang, "", "la carte n'a pas de `--rang`: la cascade est morte");

  await page.$eval("a.salle", (e) => { e.dataset.temoin = "pose"; });
  // Deux tours de sondage pleins (la page relit toutes les cinq secondes).
  await dors(11_500);

  const apres = await page.$eval("a.salle", (e) => e.dataset.temoin ?? "perdu");
  assert.equal(apres, "pose",
    "la carte a été REFAITE entre deux tours: le témoin a disparu");
  console.log(`la carte a survécu à deux tours de sondage (--rang = ${rang})`);

  // Le jumeau: réconcilier ne veut pas dire garder pour toujours. Une salle
  // fermée doit voir sa carte partir, sinon la page mentirait dans l'autre sens.
  await fetch(new URL(`api/salles/${ouverte.numero}`, SALON), { method: "DELETE" });
  ouverte = null;
  await page.waitForFunction(() => document.querySelector("a.salle") === null, { timeout: 20_000 });
  console.log("et elle disparaît quand la salle se ferme");
} finally {
  if (ouverte) await fetch(new URL(`api/salles/${ouverte.numero}`, SALON), { method: "DELETE" }).catch(() => {});
  await browser?.close();
}
