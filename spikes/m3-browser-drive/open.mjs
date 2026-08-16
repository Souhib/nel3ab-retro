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

export async function openRoom(browser, url = "http://localhost:8100/", name = BENCH_NAME) {
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
