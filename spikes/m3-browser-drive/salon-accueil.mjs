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
  // Une salle qui redémarre garde sa borne (audit P10, 24 novembre 2026).
  const ouvertes = attendu.filter(salle => salle.ouverte || salle.redemarre);

  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(SALON, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.querySelectorAll("article.salle, .vide").length > 0,
    { timeout: 15_000 },
  );

  // Une borne par salle: quatre START, dont les places libres sont des liens
  // `?entrer=jouer&place=K`, et « Regarder » (ADR D41, 24 novembre 2026).
  const cartes = await page.$$eval("article.salle", elements =>
    elements.map(element => ({
      texte: element.innerText,
      href: `/r/${element.dataset.salle}/`,
      places: [...element.querySelectorAll("a.start")].map(a => a.getAttribute("href")),
      etat: element.dataset.etat,
    })));

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
      assert.match(carte.texte, new RegExp(`Salle ${salle.numero}`, "i"),
        "la carte ne nomme pas sa salle");
      if (carte.etat !== "ouverte") {
        assert.deepEqual(carte.places, [], `une salle ${carte.etat} propose une place`);
        continue;
      }
      // Le jeu EN TOUTES LETTRES: une pastille de couleur ne se lit ni de loin
      // ni pour qui distingue mal les couleurs.
      if (salle.jeu) {
        assert.ok(carte.texte.includes(salle.jeu),
          `la carte ne dit pas le jeu en cours: ${carte.texte}`);
      }

      // Deux champs qui ont le DROIT de ne rien valoir, et dont le rien ne
      // doit rien écrire. Une carte qui annonce « 4 MANETTES LIBRES » sur une
      // salle dont le worker s'est tu y envoie du monde pour rien; une qui
      // annonce « DEPUIS 0 MIN » fait passer une absence pour une mesure. Les
      // deux branches sont vérifiées, sinon la moitié muette ne prouve rien.
      if (salle.ouverte_depuis == null) {
        assert.doesNotMatch(carte.texte, /ouverte depuis/i,
          `la carte invente une ancienneté que le salon ne donne pas: ${carte.texte}`);
      } else {
        assert.match(carte.texte, /ouverte depuis (?:moins d'une minute|\d+ min|\d+ h \d\d)/i,
          `la carte ne dit pas depuis quand la salle tourne: ${carte.texte}`);
      }
      for (const lien of carte.places) {
        assert.match(lien, new RegExp(`^${salle.chemin}\\?entrer=jouer&place=[1-4]$`),
          `une place ne mène pas dans la salle: ${lien}`);
      }
      if (salle.sieges == null && salle.places !== 4) {
        assert.deepEqual(carte.places, [], `la carte invente des places libres: ${carte.texte}`);
      }
    }
  }

  // Ouvrir: le bouton du panneau à zéro salle, sinon un par emplacement éteint.
  const ouvrir = await page.$$eval("[data-ouvrir]", elements => elements.length);
  const panneau = await page.$eval("#ouvrir", element => !element.hidden);
  if (ouvertes.length === 0) assert.ok(panneau, "rien ne tourne et « Ouvrir une salle » est caché");
  else assert.equal(ouvrir, attendu.length - ouvertes.length,
    "chaque emplacement éteint doit proposer de s'ouvrir, et lui seul");

  // Le retour d'une salle fermée. Le proxy y renvoie avec la raison dans
  // l'adresse, parce qu'une salle qui se ferme comme prévu ne doit pas se
  // présenter comme une panne de serveur.
  const revenu = await browser.newPage();
  await revenu.goto(new URL("?salle=fermee", SALON).toString(), {
    waitUntil: "domcontentloaded",
  });
  await revenu.waitForFunction(
    () => {
      const bandeau = document.getElementById("retour");
      return bandeau !== null && !bandeau.hidden;
    },
    { timeout: 15_000 },
  );
  const dit = await revenu.$eval("#retour", element => element.innerText);
  assert.match(dit, /fermée faute d'activité/, `le bandeau dit: ${dit}`);
  // L'adresse est nettoyée tout de suite: recharger ne doit pas reproduire une
  // nouvelle vieille de dix minutes.
  assert.equal(await revenu.evaluate(() => location.search), "",
    "l'adresse garde la raison, donc le message reviendra à chaque rechargement");
  await revenu.click("#retour");
  await revenu.waitForFunction(() => document.getElementById("retour").hidden,
    { timeout: 5_000 });

  // Le jumeau: sans cette raison dans l'adresse, aucun bandeau ne doit
  // apparaître, sinon il finirait par être ignoré comme un décor.
  const normal = await browser.newPage();
  await normal.goto(SALON, { waitUntil: "domcontentloaded" });
  assert.ok(await normal.$eval("#retour", element => element.hidden),
    "le bandeau de retour s'affiche alors que personne ne revient d'une fermeture");

  const ancienne = ouvertes.filter(s => s.ouverte_depuis != null).length;
  const comptees = ouvertes.filter(s => s.places != null).length;
  console.log(`${ancienne}/${ouvertes.length} salle(s) disent depuis quand elles tournent, `
    + `${comptees}/${ouvertes.length} disent leurs places libres`);
  console.log(`l'accueil montre ${cartes.length} salle(s) ouverte(s) sur ${attendu.length} `
    + `emplacements, le bouton dit « ${bouton.texte} », et le retour d'une salle `
    + "fermée s'annonce puis se ferme d'un clic");
} finally {
  await browser?.close();
}
