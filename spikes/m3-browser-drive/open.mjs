// Opening the room, with a name already given.
//
// The page asks for a name before it starts anything, because a picture decoded
// behind a form is a picture nobody is watching. A test is not a person, so it
// writes the name where the page keeps it and skips the form entirely — through
// `evaluateOnNewDocument`, which runs BEFORE the page's own script, so the first
// render already has it.
//
// Every driver here goes through this. Fifteen copies of "type the name, press
// enter" would be fifteen places to fix the day the form changes.

/** A name each driver can be recognised by in a log. */
export const BENCH_NAME = "banc";

/** La salle contre laquelle ces pilotes tournent.
 *
 * Par variable d'environnement, avec la valeur locale par défaut. Le nom de
 * machine et l'adresse du propriétaire vivaient en dur dans dix fichiers, et ce
 * dépôt est public: un nom de tailnet n'ouvre rien, puisqu'il faut y être
 * invité, mais c'est un identifiant durable attaché à une personne, publié pour
 * toujours et pour rien.
 *
 *   NEL3AB_URL=https://<machine>.<tailnet>.ts.net:8443/ node touch.mjs
 *   NEL3AB_LOGIN=<adresse>  pour les deux pilotes qui vérifient l'identité
 */
export const ROOM_URL = process.env.NEL3AB_URL ?? "http://localhost:8110/";

/** L'adresse que le proxy est censé annoncer, pour les pilotes qui la vérifient. */
export const ROOM_LOGIN = process.env.NEL3AB_LOGIN ?? null;

export async function openRoom(browser, url = ROOM_URL, name = BENCH_NAME) {
  const page = await browser.newPage();
  await seedName(page, name);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
}

/** For a driver that makes its own page, or navigates it more than once. */
export async function seedName(page, name = BENCH_NAME) {
  await page.evaluateOnNewDocument((chosen) => {
    try {
      localStorage.setItem("nel3ab:name", chosen);
      // Et le drapeau qui dit « ceci n'est pas quelqu'un ».
      //
      // Le salon tient un journal des séances, et mes pilotes ouvrent la salle
      // des dizaines de fois par soirée en prenant de vraies places. Sans ce
      // drapeau ils y sont indiscernables d'un joueur, et une trace noyée dans
      // son propre bruit ne sert à rien le jour où il faut chercher.
      //
      // Ici plutôt que dans chaque pilote: tous passent par cette fonction, et
      // un drapeau qu'il faut penser à poser est un drapeau qu'on oublie.
      localStorage.setItem("nel3ab:banc", "1");
    } catch {
      // A context with storage refused still gets the form; the driver will say
      // so by finding no canvas rather than by hanging.
    }
  }, name);
}

/** Traverse l'écran de salle, comme une personne le fait.
 *
 * Rien ne démarre avant ce clic: ni décodeur, ni socket vidéo, ni manette. Un
 * pilote qui l'oublie mesure donc un écran d'attente et rapporte zéro image,
 * ce qui ressemble à une panne et n'en est pas une.
 *
 * Le bouton plutôt qu'un drapeau caché dans le stockage: un chemin d'essai qui
 * contourne l'écran ne prouve rien de l'écran.
 */
export async function enterRoom(page, timeout = 15000) {
  await page.waitForSelector("#enter", { timeout });
  await page.click("#enter");
  await page.waitForSelector("#screen", { timeout });
}

/** Mène un changement de jeu jusqu'au bout, préparation comprise.
 *
 * Presser une vignette de jeu n'allume plus rien. Depuis l'écran de
 * préparation, ça OUVRE une préparation: la page envoie
 * `["preparation",{"action":"begin","game":N,"save":S}]`, le salon la crée avec
 * `ready: false`, et plus rien ne bouge. Le jeu démarre quand chaque personne
 * s'est dite prête et que celle qui a commencé presse « Lancer le jeu ».
 *
 * Mesuré le 13 septembre 2026 contre la vraie salle: `#pickerConfirm` confirme
 * le choix, « Je suis prêt » marque la page, `#launchPrepared` s'active alors
 * (`allReady` vaut vrai dès qu'une page seule est prête), et le jeu part.
 *
 * ICI et pas recopié dans chaque pilote: trois d'entre eux s'arrêtaient au
 * panneau des sauvegardes et concluaient que le jeu n'avait pas démarré. Une
 * étape obligatoire écrite en trois endroits est une étape que l'un des trois
 * oubliera, ce qui est exactement ce qui s'est produit.
 *
 * `encore` sert aux jeux SANS sauvegarde, qui n'ouvrent pas de panneau et
 * partent sur une seconde pression. Cette branche n'a PAS été exercée: le seul
 * jeu essayé ce jour-là a des sauvegardes.
 */
export async function launchPrepared(page, encore = null, timeout = 20000) {
  const fin = Date.now() + timeout;
  let confirme = false;
  while (Date.now() < fin && !confirme) {
    confirme = await page.evaluate(() => {
      const node = document.getElementById("pickerConfirm");
      if (!node) return false;
      node.click();
      return true;
    });
    if (!confirme) await new Promise((r) => setTimeout(r, 200));
  }
  if (!confirme && encore) await encore();
  const presser = (label) =>
    page.evaluate((wanted) => {
      const node = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === wanted,
      );
      if (!node || node.disabled) return false;
      node.click();
      return true;
    }, label);
  await page.waitForFunction(() => document.getElementById("launchPrepared") !== null, { timeout });
  await presser("Je suis prêt");
  await page.waitForFunction(
    () => {
      const node = document.getElementById("launchPrepared");
      return node !== null && !node.disabled;
    },
    { timeout },
  );
  return presser("Lancer le jeu");
}

/** L'autre porte: entrer pour regarder, sans prendre de manette.
 *
 * Une porte distincte et pas un réglage à changer une fois dedans, parce que
 * c'est ce que la page fait: une session construite en joueur prendrait une
 * place le temps d'un aller-retour avant de la rendre.
 */
export async function watchRoom(page, timeout = 15000) {
  await page.waitForSelector("#watch", { timeout });
  await page.click("#watch");
  await page.waitForSelector("#screen", { timeout });
}

/** La place que cette page tient, ou `null`. Un nombre, pas une phrase.
 *
 * Plusieurs pilotes cherchaient « joueur 2 » dans le texte affiché. Reformuler
 * l'interface les cassait tous, sans qu'aucun comportement n'ait bougé.
 */
export const seatOf = (page) => page.evaluate(() => globalThis.nel3abTest.seat());

/** Cette page a-t-elle été délogée par quelqu'un d'autre ? */
export const displacedOn = (page) =>
  page.evaluate(() => document.getElementById("displaced") !== null);
