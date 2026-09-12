/** La page d'accueil montre-t-elle VRAIMENT ce qu'on croit ?
 *
 * Elle se construit dans le navigateur, à partir de `/api/salles`: lire son
 * source ne prouve donc rien de ce qu'elle affiche. Ce pilote la charge pour de
 * bon et regarde le rendu.
 *
 * Contre le salon EN DIRECT, sans passer par le proxy: ce qu'on vérifie ici est
 * la page, pas le routage, et le proxy a ses propres pilotes.
 */
import assert from "node:assert/strict";
import puppeteer from "puppeteer";

const SALON = process.argv[2] ?? "http://127.0.0.1:8200/";
let browser;
try {
  const attendu = await fetch(new URL("api/salles", SALON)).then(r => r.json());
  const ouvertes = attendu.filter(salle => salle.ouverte);

  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(SALON, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.querySelectorAll("a.salle, .vide").length > 0,
    { timeout: 15_000 },
  );

  const cartes = await page.$$eval("a.salle", elements =>
    elements.map(element => ({ texte: element.innerText, href: element.getAttribute("href") })));

  assert.equal(cartes.length, ouvertes.length,
    `la page montre ${cartes.length} salles, le salon en déclare ${ouvertes.length} ouvertes`);

  if (ouvertes.length === 0) {
    // Un écran vide se lit comme une panne: il doit dire ce qui se passe.
    const vide = await page.$eval(".vide", element => element.innerText);
    assert.match(vide, /Aucune salle ouverte/, "l'écran vide ne dit rien");
  } else {
    for (const salle of ouvertes) {
      const carte = cartes.find(c => c.href === salle.chemin);
      assert.ok(carte, `aucune carte ne mène à ${salle.chemin}`);
      assert.match(carte.texte, new RegExp(`salle ${salle.numero}`),
        "la carte ne nomme pas sa salle");
      // Le jeu EN TOUTES LETTRES: une pastille de couleur ne se lit ni de loin
      // ni pour qui distingue mal les couleurs.
      if (salle.jeu) {
        assert.ok(carte.texte.includes(salle.jeu),
          `la carte ne dit pas le jeu en cours: ${carte.texte}`);
      }
    }
  }

  const bouton = await page.$eval("#ouvrir", element => ({
    texte: element.innerText, eteint: element.disabled,
  }));
  assert.equal(bouton.eteint, ouvertes.length === attendu.length,
    "le bouton d'ouverture ne reflète pas les places restantes");

  console.log(`l'accueil montre ${cartes.length} salle(s) ouverte(s) sur ${attendu.length} `
    + `emplacements, et le bouton dit « ${bouton.texte} »`);
} finally {
  await browser?.close();
}
