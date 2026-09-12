/** Des images des écrans d'une salle, pour les regarder plutôt que les décrire. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import puppeteer from "puppeteer";
import { seedName } from "./open.mjs";

const [url, dossier] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });

  // 1. L'écran d'accueil, avant d'avoir donné un nom.
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("Qui joue"), { timeout: 20_000 });
  await page.screenshot({ path: join(dossier, "1-qui-joue.png") });

  // 2. Le salon de la salle, une fois le nom donné.
  const nomme = await browser.newPage();
  await nomme.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await seedName(nomme);
  await nomme.goto(url, { waitUntil: "domcontentloaded" });
  await nomme.waitForFunction(() => document.body.innerText.includes("entrer et jouer"), { timeout: 20_000 });
  await nomme.screenshot({ path: join(dossier, "2-salon.png") });

  // 3. La salle, une fois entré: barre latérale et écran.
  const entre = await nomme.evaluateHandle(() =>
    [...document.querySelectorAll("button, a, [role=button]")]
      .find(e => e.innerText.toLowerCase().includes("entrer et jouer")));
  await entre.asElement().click();
  await new Promise(done => setTimeout(done, 2_500));
  await nomme.screenshot({ path: join(dossier, "3-dans-la-salle.png") });

  // 4. Le menu des jeux.
  //
  // Échap n'OUVRE le menu que s'il est fermé. Dans une salle au repos il est
  // déjà ouvert tout seul, et Échap le refermerait: la coque le lit comme
  // « retour ». Ce piège a produit une capture nommée « touches » qui montrait
  // l'écran au repos, sans que rien ne signale l'erreur.
  const menuOuvert = () => nomme.evaluate(() => document.getElementById("menu") !== null);
  if (!(await menuOuvert())) {
    await nomme.keyboard.press("Escape");
    await new Promise((done) => setTimeout(done, 1_500));
  }
  if (!(await menuOuvert())) throw new Error("le menu ne s'ouvre pas: rien à capturer");
  await nomme.screenshot({ path: join(dossier, "4-menu.png") });

  // 5. Le panneau des touches. C'est une boîte de hauteur FIXE dont le contenu
  //    ne défile pas hors préparation: ce qui y grossit trop se coupe sans
  //    prévenir, et aucun essai ne le dirait. Il faut donc le regarder.
  await nomme.evaluate(() => document.querySelector("#ray-reglages")?.click());
  await new Promise((done) => setTimeout(done, 500));
  await nomme.evaluate(() => document.querySelector("#item-bindings")?.click());
  await new Promise((done) => setTimeout(done, 1_200));
  // On VÉRIFIE qu'on regarde bien le panneau avant de le prendre en photo.
  if ((await nomme.$("#bindingsPanel")) === null)
    throw new Error("le panneau des touches ne s'est pas ouvert: la photo montrerait autre chose");
  await nomme.screenshot({ path: join(dossier, "5-touches.png") });

  console.log("captures écrites dans", dossier);
} finally {
  await browser.close();
}
