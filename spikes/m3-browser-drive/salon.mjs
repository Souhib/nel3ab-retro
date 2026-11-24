// La preuve du salon dans un vrai Chrome (`just salon-navigateur`).
//
// jsdom ne pose rien: les essais Python de l'accueil (`test_accueil.py`)
// exécutent sa vraie page, mais ne voient ni une cible trop petite, ni un
// bouton caché sous un autre, ni une page qui déborde au téléphone, ni Aïn
// peint dans son logo. Ce pilote les mesure sur les pages que les modules du
// salon assemblent, servies par un banc aux API simulées (`salon-banc.mjs`):
// aucun salon ne démarre, aucune salle ne s'ouvre (K40).
//
//   node salon.mjs [--port 5462] [--etape nom] [--pages pages.json]
//                  [--rouge-attendu etape,etape]
//
// `--rouge-attendu` est le contrôle négatif: chaque étape nommée doit échouer
// sur son DÉFAUT, et non sur une précondition; les autres sont sautées.
import { existsSync } from "node:fs";
import puppeteer from "puppeteer";
import { demarrerSalon } from "./salon-banc.mjs";

const args = process.argv.slice(2);
const option = (nom, defaut = null) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 ? args[i + 1] : defaut;
};
const PORT = Number(option("port", "5462"));
const SEULE = option("etape");
const ROUGE = option("rouge-attendu")?.split(",").filter(Boolean) ?? null;

class Defaut extends Error {}
class Precondition extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const defaut = (ok, message) => { if (!ok) throw new Defaut(message); };
const exiger = (ok, message) => { if (!ok) throw new Precondition(message); };

const PC = { width: 1440, height: 900 };
const TELEPHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const ETROIT = { width: 320, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

const banc = await demarrerSalon({ port: PORT, pages: option("pages") });
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });

// ── Les salles du banc ───────────────────────────────────────────────────
const siege = (port, nom) => ({ port, nom, tenu: nom !== null });
const salle = (numero, champs = {}) => ({
  numero, ouverte: false, redemarre: false, chemin: `/r/${numero}/`, jeu: null, cle: null,
  console: null, switch: false, gens: [], chef: null, sieges: [], regardent: [],
  ouverte_depuis: null, repond: null, fermee_pour: null, places: null, ...champs,
});
const ouverte = (numero, noms, champs = {}) => salle(numero, {
  ouverte: true, repond: true, ouverte_depuis: 3960,
  sieges: noms.map((nom, i) => siege(i + 1, nom)),
  places: noms.filter((n) => n === null).length,
  gens: noms.filter(Boolean), ...champs,
});
const VIDE = [salle(1), salle(2), salle(3)];
const RANGEE = [
  ouverte(1, ["Nour", "Bilel", "Jo", "Inès"], { jeu: "Mario Kart: Double Dash!!", console: "GameCube", chef: "Nour", regardent: ["Mémé"] }),
  ouverte(2, ["Sami", "Lou", null, null], { jeu: "Wii Sports", console: "Wii", chef: "Sami" }),
  salle(3),
];

/** Une page neuve sur le banc remis à zéro puis réglé. Toute requête hors du
 * banc est coupée: une page du salon ne dépend d'aucun service tiers. */
async function nouvelle(vue, { reglage = {}, schema = "dark", avant = null, chemin = "/" } = {}) {
  banc.reinitialiser();
  banc.regler(reglage);
  const page = await browser.newPage();
  await page.setViewport(vue);
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: schema }]);
  if (avant) await page.evaluateOnNewDocument(avant);
  await page.setRequestInterception(true);
  const hors = [];
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.protocol === "data:" || u.protocol === "blob:" || u.origin === banc.base) return req.continue();
    hors.push(req.url());
    return req.abort();
  });
  page.hors = hors;
  await page.goto(new URL(chemin, banc.url).href, { waitUntil: "domcontentloaded" });
  return page;
}

/** Attend que la rangée ou la mire soit dessinée. */
const dessinee = (page) =>
  page.waitForFunction(() => document.querySelector("#salles > *") !== null, { timeout: 8000 })
    .catch(() => { throw new Precondition("la rangée n'est jamais dessinée"); });

/** Les éléments visibles dont le fond est celui du bouton plein. Le jeton est
 * lu par une sonde: la régie le définit par des `var()` en chaîne. */
const pleinsVisibles = (page) => page.evaluate(() => {
  const sonde = document.createElement("i");
  sonde.style.background = "var(--bouton-plein-fond)";
  document.body.append(sonde);
  const plein = getComputedStyle(sonde).backgroundColor;
  sonde.remove();
  return [...document.querySelectorAll("main *")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).backgroundColor === plein
      && getComputedStyle(el).visibility !== "hidden";
  }).map((el) => el.id ? `#${el.id}` : el.getAttribute("href") ?? el.className);
});

/** Ce qui reçoit le point au centre d'un élément est-il cet élément ? Chaque
 * élément est amené à l'écran d'abord: `elementFromPoint` ne voit rien hors
 * de la fenêtre. */
const atteint = (page, selecteur) => page.$$eval(selecteur, (els) => els.filter((el) => {
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  if (r.width === 0) return false;
  const vu = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !(vu && (vu === el || el.contains(vu)));
}).map((el) => el.outerHTML.slice(0, 120)));

// ── Les étapes ───────────────────────────────────────────────────────────
const ETAPES = {
  async entete() {
    const page = await nouvelle(TELEPHONE, {
      reglage: { salles: RANGEE, moi: { login: "nour@exemple", name: "Nour", display: "Nour" }, droits: { peut_importer: true } },
    });
    await page.waitForFunction(() => !document.getElementById("lien-depot").hidden, { timeout: 5000 })
      .catch(() => { throw new Defaut("« Déposer un jeu » reste caché à qui peut déposer"); });
    const liens = await page.$$eval(".pages a", (as) => as.filter((a) => a.getBoundingClientRect().width > 0)
      .map((a) => ({ mot: a.textContent.trim(), haut: a.getBoundingClientRect().height, courant: a.getAttribute("aria-current") })));
    defaut(liens.map((l) => l.mot).join("|") === "Les salles|Ton carnet|Déposer un jeu", `liens de l'en-tête: ${JSON.stringify(liens)}`);
    defaut(liens.every((l) => l.haut >= 44), `un lien de l'en-tête fait moins de 44 px: ${JSON.stringify(liens)}`);
    defaut(liens[0].courant === "page", "« Les salles » ne porte pas aria-current");
    const caches = await atteint(page, ".pages a");
    defaut(caches.length === 0, `un lien de l'en-tête ne reçoit pas le point: ${caches}`);
    const moi = await page.$eval("#moi", (e) => e.textContent);
    defaut(moi === "Nour" && !moi.includes("@"), `« Tu es » dit ${moi}`);
    await page.close();
    // Le jumeau: sans identité ni droit, ni carnet, ni dépôt, ni « Changer ton nom ».
    const anonyme = await nouvelle(TELEPHONE, { reglage: { salles: RANGEE } });
    await dessinee(anonyme);
    await sleep(300);
    const vus = await anonyme.$$eval(".entete a", (as) => as.filter((a) => a.getBoundingClientRect().width > 0).map((a) => a.textContent.trim()));
    defaut(JSON.stringify(vus.filter((m) => m)) === JSON.stringify(["Les salles"]), `sans identité, l'en-tête montre ${vus}`);
    await anonyme.close();
    // Le même en-tête au dépôt et au carnet: recopié, il avait dérivé (le
    // dépôt n'avait ni « Tu es » ni de quoi montrer « Ton carnet »).
    for (const [chemin, courant] of [["/importer", "Déposer un jeu"], ["/profil", "Ton carnet"]]) {
      const autre = await nouvelle(TELEPHONE, {
        chemin,
        reglage: { salles: RANGEE, moi: { login: "nour@exemple", name: "Nour", display: "Nour" }, droits: { peut_importer: true } },
      });
      await autre.waitForFunction(() => document.getElementById("moi")?.textContent === "Nour", { timeout: 5000 })
        .catch(() => { throw new Defaut(`${chemin} ne dit pas « Tu es Nour »`); });
      await autre.waitForFunction(() => !document.getElementById("lien-carnet").hidden && !document.getElementById("lien-depot").hidden, { timeout: 5000 })
        .catch(() => { throw new Defaut(`${chemin} ne montre pas les trois pages à Nour`); });
      const ici = await autre.$$eval(".pages a", (as) => as.filter((a) => a.getBoundingClientRect().height >= 44)
        .map((a) => ({ mot: a.textContent.trim(), courant: a.getAttribute("aria-current") })));
      defaut(ici.length === 3 && ici.filter((l) => l.courant === "page").map((l) => l.mot).join() === courant,
        `${chemin}: liens de l'en-tête ${JSON.stringify(ici)}`);
      const perdus = await atteint(autre, ".pages a, #changer-ton-nom");
      defaut(perdus.length === 0, `${chemin}: un lien de l'en-tête ne reçoit pas le point: ${perdus}`);
      await autre.close();
    }
    // Le jumeau: sans droit, le dépôt garde SON lien (la page dit elle-même
    // qu'on ne peut pas déposer), et le carnet reste caché sans identité.
    const sansDroit = await nouvelle(TELEPHONE, { chemin: "/importer", reglage: { salles: RANGEE } });
    await sansDroit.waitForFunction(() => document.querySelector(".entete") !== null, { timeout: 5000 });
    await sleep(500);
    const restent = await sansDroit.$$eval(".pages a", (as) => as.filter((a) => a.getBoundingClientRect().width > 0).map((a) => a.textContent.trim()));
    defaut(restent.join("|") === "Les salles|Déposer un jeu", `sans droit, le dépôt montre ${restent}`);
    await sansDroit.close();
  },

  async "ain-logo"() {
    const page = await nouvelle(PC, { reglage: { salles: VIDE } });
    await dessinee(page);
    const maison = await page.evaluate(() => {
      const hote = document.querySelector('[data-hote="logo"]');
      const toile = hote?.querySelector("canvas.rt-mascotte");
      const logo = hote?.querySelector("svg.rt-logo");
      return {
        toile: toile ? toile.getBoundingClientRect().width : 0,
        logo: logo ? getComputedStyle(logo).display : "absent",
        a: typeof window.nel3abAin?.scene, s: typeof window.nel3abSalon?.surStart,
      };
    });
    defaut(maison.a === "function" && maison.s === "function", `le paquet du salon n'est pas chargé: ${JSON.stringify(maison)}`);
    defaut(maison.toile >= 114, `Aïn n'est pas peint dans le logo: ${JSON.stringify(maison)}`);
    defaut(maison.logo === "none", `le logo statique reste visible sous Aïn: ${maison.logo}`);
    defaut(page.hors.length === 0, `requêtes hors du banc: ${page.hors}`);
    await page.close();
  },

  async "mire-vide"() {
    const page = await nouvelle(PC, { reglage: { salles: VIDE } });
    await dessinee(page);
    const mire = await page.evaluate(() => {
      const vide = document.querySelector(".vide");
      return vide && {
        fond: getComputedStyle(vide).backgroundImage,
        titre: document.querySelector(".vide-titre").innerText,
        haut: vide.getBoundingClientRect().height,
      };
    });
    defaut(mire !== null, "pas de mire à zéro salle");
    defaut(mire.fond.includes("linear-gradient"), `la mire n'a pas ses barres: ${mire.fond}`);
    defaut(mire.titre === "HORS ANTENNE", `titre de la mire: ${mire.titre}`);
    const pleins = await pleinsVisibles(page);
    defaut(JSON.stringify(pleins) === '["#ouvrir"]', `à zéro salle, les pleins sont ${pleins}`);
    defaut((await atteint(page, "#ouvrir")).length === 0, "« Ouvrir une salle » ne reçoit pas le point");
    const start = await page.$eval("#start", (e) => e.getBoundingClientRect().height > 0 && e.innerText);
    defaut(start === "APPUIE SUR START", `Appuie sur Start: ${start}`);
    await page.close();
  },

  async "un-seul-plein"() {
    for (const schema of ["dark", "light"]) {
      const page = await nouvelle(PC, { reglage: { salles: RANGEE }, schema });
      await dessinee(page);
      const pleins = await pleinsVisibles(page);
      defaut(JSON.stringify(pleins) === '["/r/2/?entrer=jouer&place=3"]', `pleins (${schema}): ${pleins}`);
      const accroche = await page.$eval("#accroche", (e) => e.textContent);
      defaut(accroche === "Joue en salle 2 : deux places t'attendent.", `accroche: ${accroche}`);
      await page.close();
    }
  },

  async places() {
    const page = await nouvelle(TELEPHONE, { reglage: { salles: RANGEE } });
    await dessinee(page);
    const liens = await page.$$eval("a.start", (as) => as.map((a) => a.getAttribute("href")));
    defaut(JSON.stringify(liens) === JSON.stringify(["/r/2/?entrer=jouer&place=3", "/r/2/?entrer=jouer&place=4"]), `places libres: ${liens}`);
    const caches = await atteint(page, ".start, .regarder, [data-ouvrir]");
    defaut(caches.length === 0, `une place ou un bouton ne reçoit pas le point: ${caches}`);
    await page.close();
  },

  async "cibles-44"() {
    for (const vue of [TELEPHONE, PC]) {
      const page = await nouvelle(vue, { reglage: { salles: RANGEE, moi: { login: "x", name: "Nour", display: "Nour" }, droits: { peut_importer: true } } });
      await dessinee(page);
      await sleep(300);
      const petits = await page.$$eval("main a, main button, .rt-reglage label", (els) => els.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.height < 44;
      }).map((el) => `${el.textContent.trim().slice(0, 30)} ${el.getBoundingClientRect().height.toFixed(0)} px`));
      defaut(petits.length === 0, `cibles de moins de 44 px à ${vue.width} px: ${petits}`);
      await page.close();
    }
  },

  async "sans-defilement-320"() {
    for (const salles of [RANGEE, VIDE]) {
      const page = await nouvelle(ETROIT, { reglage: { salles } });
      await dessinee(page);
      await sleep(300);
      const large = await page.evaluate(() => document.scrollingElement.scrollWidth);
      defaut(large <= 320, `la page déborde à 320 px: ${large} px (${salles === VIDE ? "mire" : "rangée"})`);
      await page.close();
    }
  },

  async "reveil-coupe"() {
    const page = await nouvelle(PC, {
      reglage: {
        salles: VIDE,
        post: { statut: 201, corps: { ...salle(1), ouverte: true }, delai: 800 },
        apres: [ouverte(1, [null, null, null, null]), salle(2), salle(3)],
      },
    });
    await dessinee(page);
    const debut = Date.now();
    await page.click("#ouvrir");
    const scene = await page.evaluate(() => document.querySelector('[data-hote="logo"] .rt-mascotte')?.dataset.scene ?? null);
    await page.waitForFunction(() => document.querySelector('article.salle[data-salle="1"]') !== null, { timeout: 4000 })
      .catch(() => { throw new Defaut("la salle ouverte n'arrive pas dans la rangée"); });
    const delai = Date.now() - debut;
    defaut(delai < 1800, `la rangée arrive ${delai} ms après le clic, pour un POST de 800 ms`);
    defaut(JSON.stringify(banc.envois) === "[null]", `POST envoyés: ${JSON.stringify(banc.envois)}`);
    const etat = await page.evaluate(() => ({
      adresse: location.pathname, accroche: document.getElementById("accroche").textContent,
      plein: document.querySelector("a.start[data-plein]")?.getAttribute("href") ?? null,
    }));
    defaut(etat.adresse === "/", `la page est partie vers ${etat.adresse}`);
    defaut(etat.accroche === "La salle 1 est ouverte : prends la place 1.", `accroche: ${etat.accroche}`);
    defaut(etat.plein === "/r/1/?entrer=jouer&place=1", `plein: ${etat.plein}`);
    exiger(scene !== undefined, "lecture de la scène");
    await page.close();
  },

  async "liste-figee"() {
    // Le sondage à 400 ms au lieu de 5 s: le même code, deux tours plus tôt.
    const accelere = () => {
      const vrai = window.setInterval.bind(window);
      window.setInterval = (f, ms, ...r) => vrai(f, ms === 5000 ? 400 : ms, ...r);
    };
    const page = await nouvelle(PC, { reglage: { salles: RANGEE }, avant: accelere });
    await dessinee(page);
    banc.regler({ statut: 502 });
    await page.waitForFunction(() => document.getElementById("accroche").textContent.startsWith("La liste date de"), { timeout: 5000 })
      .catch(() => { throw new Defaut("deux relevés manqués et l'accroche ne le dit pas"); });
    const pleins = await pleinsVisibles(page);
    defaut(JSON.stringify(pleins) === '["#recharger"]', `liste figée, pleins: ${pleins}`);
    banc.regler({ statut: 200 });
    await page.waitForFunction(() => !document.getElementById("accroche").textContent.startsWith("La liste date de"), { timeout: 5000 })
      .catch(() => { throw new Defaut("la liste revenue reste figée"); });
    await page.close();
  },
};

// ── Le carnet ────────────────────────────────────────────────────────────
const partie = (id, debut, champs = {}) => ({
  id, salle: 1, titre: "Mario Kart: Double Dash!!", console: { code: "gc", label: "GameCube" },
  debut, fin: null, secondes: 4360, complete: true, en_cours: false, sauvegarde: "mienne",
  lance_par: null, avec: [{ nom: "Ben", place: 2 }], regardaient: ["Dora"], ...champs,
});
const CARNET = {
  moi: { login: "bilel@exemple", name: "Bilel", display: "Bilel" },
  carnet: {
    profil: { pseudo: "Bilel", depuis: "2026-08-14T18:00:00+00:00", jeux: 4, parties: 23, secondes: 61320, inconnues: 0, sauvegardes: 1, dernier: null },
    sauvegardes: [],
    // Lu par l'ancien carnet (l'étagère), pour que le contrôle rouge l'ouvre.
    jeux: [],
    parties: { parties: [
      partie("b".repeat(16), "2026-11-21T20:00:00+00:00", { titre: "The Legend of Zelda: The Wind Waker, édition très longue" }),
      partie("a".repeat(16), "2026-11-14T20:00:00+00:00", { sauvegarde: "du_lanceur", lance_par: "Sami" }),
    ], suivant: null },
  },
};

ETAPES["changer-nom"] = async () => {
  const page = await nouvelle(PC, { reglage: CARNET, chemin: "/profil" });
  await page.waitForFunction(() => document.querySelector("#parties tr, #parties li") !== null, { timeout: 5000 })
    .catch(() => { throw new Precondition("le carnet ne s'ouvre pas sur le banc"); });
  defaut(await page.$("#changer-nom") !== null, "le carnet n'a pas de « Changer ton nom »");
  await page.click("#changer-nom");
  const ouverte = await page.evaluate(() => ({
    modale: document.getElementById("nom").matches(":modal"),
    focus: document.activeElement?.id,
    valeur: document.getElementById("nom-champ").value,
  }));
  defaut(ouverte.modale, "« Changer ton nom » n'ouvre pas une boîte modale");
  defaut(ouverte.focus === "nom-champ" && ouverte.valeur === "Bilel", `focus ${ouverte.focus}, champ « ${ouverte.valeur} »`);
  await page.evaluate(() => { document.getElementById("nom-champ").value = ""; });
  await page.type("#nom-champ", "Zoé");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.getElementById("nom").open, { timeout: 3000 })
    .catch(() => { throw new Defaut("la boîte reste ouverte après « Garder ce nom »"); });
  const apres = await page.evaluate(() => ({
    etiquette: document.getElementById("etiquette").textContent, focus: document.activeElement?.id,
  }));
  defaut(JSON.stringify(banc.envois) === JSON.stringify([{ me: { name: "Zoé" } }]), `PUT /api/me: ${JSON.stringify(banc.envois)}`);
  defaut(apres.etiquette === "Zoé", `étiquette après: ${apres.etiquette}`);
  defaut(apres.focus === "changer-nom", `le focus ne revient pas au bouton: ${apres.focus}`);
  // L'en-tête commun dit le nouveau nom, et son lien ouvre la même boîte sur
  // place: aucune navigation, le focus revient au lien.
  await page.waitForFunction(() => document.getElementById("moi").textContent === "Zoé", { timeout: 2000 })
    .catch(() => { throw new Defaut("l'en-tête dit encore l'ancien nom"); });
  const adresse = page.url();
  await page.click("#changer-ton-nom");
  const parLeHaut = await page.evaluate(() => ({ modale: document.getElementById("nom").matches(":modal"), focus: document.activeElement?.id }));
  defaut(parLeHaut.modale && parLeHaut.focus === "nom-champ", `le lien de l'en-tête n'ouvre pas la boîte: ${JSON.stringify(parLeHaut)}`);
  await page.click("#nom-annuler");
  const retour = await page.evaluate(() => document.activeElement?.id);
  defaut(page.url() === adresse && retour === "changer-ton-nom", `après Annuler: ${page.url()}, focus ${retour}`);
  await page.close();
};

ETAPES["carnet-320"] = async () => {
  const page = await nouvelle(ETROIT, { reglage: CARNET, chemin: "/profil" });
  await page.waitForFunction(() => document.querySelector("#parties tr.partie") !== null, { timeout: 5000 })
    .catch(() => { throw new Precondition("le carnet ne s'ouvre pas sur le banc"); });
  await sleep(300);
  const large = await page.evaluate(() => document.scrollingElement.scrollWidth);
  defaut(large <= 320, `le carnet déborde à 320 px: ${large} px`);
  const petits = await page.$$eval("main a, main button", (els) => els.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.height < 44;
  }).map((el) => `${el.textContent.trim().slice(0, 30)} ${el.getBoundingClientRect().height.toFixed(0)} px`));
  defaut(petits.length === 0, `cibles de moins de 44 px dans le carnet: ${petits}`);
  await page.close();
};

ETAPES.depot = async () => {
  const reglage = {
    droits: { peut_importer: true, administrateur: true },
    catalogue: { scanned_ms: 0, room: 1, games: [
      { key: "Zelda: Wind Waker.iso", name: "The Legend of Zelda: The Wind Waker", console: "gc", art: false },
      { key: "mk.iso", name: "Mario Kart Wii", console: "wii", art: false },
    ] },
  };
  for (const vue of [ETROIT, PC]) {
    const page = await nouvelle(vue, { reglage, chemin: "/importer" });
    await page.waitForFunction(() => !document.getElementById("jaquettes").hidden, { timeout: 5000 })
      .catch(() => { throw new Defaut("la rangée des jaquettes ne s'ouvre pas à l'administrateur"); });
    const mesure = await page.evaluate(() => ({
      large: document.scrollingElement.scrollWidth,
      petits: [...document.querySelectorAll("#jaquettes label, #jaquettes button, .entete a")]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height < 44; })
        .map((el) => el.textContent.trim().slice(0, 30)),
      courant: document.querySelector('.pages a[aria-current="page"]')?.textContent,
    }));
    defaut(mesure.large <= vue.width, `le dépôt déborde à ${vue.width} px: ${mesure.large} px`);
    defaut(mesure.petits.length === 0, `cibles de moins de 44 px au dépôt: ${mesure.petits}`);
    defaut(mesure.courant === "Déposer un jeu", `page courante: ${mesure.courant}`);
    if (vue === PC) {
      const entree = await page.$("#jeux .jeu input[type=file]");
      const fichier = new URL("../../front/public/favicon.png", import.meta.url).pathname;
      await entree.uploadFile(existsSync(fichier) ? fichier : process.argv[1]);
      await page.waitForFunction(() => document.querySelector("#jeux .jeu-dit")?.textContent !== "", { timeout: 3000 })
        .catch(() => { throw new Defaut("déposer une image ne dit rien"); });
      const dit = await page.$eval("#jeux .jeu-dit", (e) => e.textContent);
      defaut(dit === "Image gardée.", `après le dépôt: ${dit}`);
      defaut(banc.envois.length === 1 && banc.envois[0].art === "Zelda: Wind Waker.iso" && banc.envois[0].methode === "PUT"
        && banc.envois[0].octets > 0, `PUT de l'image: ${JSON.stringify(banc.envois)}`);
    }
    await page.close();
  }
};

/** La zone de dépôt (plan salon, salon-importer#4) : « Choisir des fichiers »
 * est le seul plein au repos, sans les quatre carrés de couleur de joueur, et
 * un glisser au-dessus dit ce qui arrivera au lâcher. Le jumeau : il sort, et
 * la zone reprend sa phrase. */
ETAPES["depot-zone"] = async () => {
  const page = await nouvelle(PC, { reglage: { droits: { peut_importer: true } }, chemin: "/importer" });
  await page.waitForFunction(() => document.getElementById("depot") !== null && document.getElementById("refus").hidden, { timeout: 5000 })
    .catch(() => { throw new Precondition("la page de dépôt ne s'ouvre pas sur le banc"); });
  await sleep(300);
  const pleins = await pleinsVisibles(page);
  defaut(pleins.length === 1 && pleins[0] === "depot-choisir", `pleins au repos du dépôt: ${pleins}`);
  const couleurs = await page.evaluate(() => [...document.querySelectorAll("#depot *")]
    .filter((el) => /--joueur-/.test(el.getAttribute("style") ?? "")).length);
  defaut(couleurs === 0, `${couleurs} carrés de couleur de joueur dans la zone`);
  const mot = () => page.$eval("#depot [data-ancre=depot-mot]", (e) => e.textContent.trim());
  await page.evaluate(() => {
    const zone = document.getElementById("depot");
    zone.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
  });
  const survole = await mot();
  defaut(survole === "Lâche-les : ils se rangent dès qu'ils sont lus.", `au survol, la zone dit « ${survole} »`);
  await page.evaluate(() => {
    const zone = document.getElementById("depot");
    zone.dispatchEvent(new DragEvent("dragleave", { bubbles: true, cancelable: true, relatedTarget: document.body }));
  });
  const repos = await mot();
  defaut(repos === "Pose tes fichiers ici, ou", `après le glisser, la zone dit « ${repos} »`);
  await page.close();
};

/** Qui peut déposer (plan salon, salon-importer#7) : une étiquette tapée par
 * personne, sans couleur de joueur, une phrase, et « Retirer le droit » qui
 * passe la personne dans « Ne peuvent pas » avec « Donner le droit ». */
ETAPES.trousseau = async () => {
  const personne = (login, champs) => ({ login, nom: "", pseudo: null, sources: ["tailnet"], appareils: 1,
    en_ligne: false, partage: false, droit: "aucun", ...champs });
  const page = await nouvelle(PC, {
    chemin: "/importer",
    reglage: {
      droits: { peut_importer: true, administrateur: true },
      importeurs: { tailnet: true, registre_lisible: true, personnes: [
        personne("souhib@exemple", { pseudo: "Souhib", droit: "administrateur" }),
        personne("vince@exemple", { pseudo: "Vince", sources: ["tailnet", "salon"], droit: "nomme" }),
        personne("alice@exemple", { nom: "Alice A", en_ligne: true }),
      ] },
    },
  });
  await page.waitForFunction(() => !document.getElementById("cles").hidden, { timeout: 5000 })
    .catch(() => { throw new Precondition("le trousseau ne s'ouvre pas à l'administrateur"); });
  const lignes = () => page.evaluate(() => Object.fromEntries(["avec-cle", "sans-cle"].map((id) => [id,
    [...document.querySelectorAll(`#${id} .personne`)].map((li) => ({
      nom: li.querySelector(".etiquette")?.textContent ?? null,
      phrase: li.querySelector("[data-ici=phrase]")?.textContent ?? "",
      bouton: li.querySelector("button:not([hidden])")?.textContent ?? null,
      liseré: li.querySelector(".etiquette") ? getComputedStyle(li.querySelector(".etiquette")).borderLeftColor : null,
      style: li.getAttribute("style") ?? "",
    }))])));
  const avant = await lignes();
  const trait = await page.evaluate(() => {
    const sonde = document.createElement("i");
    sonde.style.color = "var(--trait)";
    document.body.append(sonde);
    const c = getComputedStyle(sonde).color;
    sonde.remove();
    return c;
  });
  const toutes = [...avant["avec-cle"], ...avant["sans-cle"]];
  defaut(toutes.map((l) => l.nom).join("|") === "Souhib|Vince|Alice A", `étiquettes du trousseau: ${JSON.stringify(toutes)}`);
  defaut(toutes.every((l) => l.liseré === trait && !l.style.includes("joueur")), `une couleur de joueur au trousseau: ${JSON.stringify(toutes)}`);
  defaut(toutes.every((l) => !/TAILNET|DÉJÀ VENU|EN LIGNE/.test(l.phrase) && l.phrase.endsWith(".")), `phrases: ${JSON.stringify(toutes)}`);
  const vince = avant["avec-cle"].find((l) => l.nom === "Vince");
  defaut(vince?.bouton === "Retirer le droit", `le bouton de Vince: ${vince?.bouton}`);
  await page.click('#avec-cle button[aria-label^="Retirer le droit à Vince"]');
  await page.waitForFunction(() => [...document.querySelectorAll("#sans-cle .etiquette")].some((e) => e.textContent === "Vince"), { timeout: 3000 })
    .catch(() => { throw new Defaut("Vince ne passe pas dans « Ne peuvent pas »"); });
  const apres = await lignes();
  const vinceApres = apres["sans-cle"].find((l) => l.nom === "Vince");
  defaut(vinceApres?.bouton === "Donner le droit", `après le retrait, le bouton de Vince: ${vinceApres?.bouton}`);
  const titres = await page.$$eval("#cles h3", (hs) => hs.map((h) => h.textContent));
  defaut(titres.join("|") === "Peuvent déposer|Ne peuvent pas", `colonnes: ${titres}`);
  defaut(JSON.stringify(banc.envois) === JSON.stringify([{ importeur: "vince@exemple", methode: "DELETE" }]), `envois: ${JSON.stringify(banc.envois)}`);
  await page.close();
};

/** Le niveau d'effets de l'appareil, posé avant le script de la page. */
const niveau = (n) => `localStorage.setItem("nel3ab:effets", ${JSON.stringify(JSON.stringify({ niveau: n, sons: false }))})`;
const scene = (page) => page.evaluate(() =>
  document.querySelector('header [data-hote="logo"] .rt-mascotte')?.dataset.scene ?? null);

/** La boucle d'attention à zéro salle (24 novembre 2026) : Aïn joue
 * « attente » à 2,5 s. Le jumeau : une salle ouverte, ou un clic avant
 * 2,5 s, et rien ne joue. */
ETAPES.attention = async () => {
  const page = await nouvelle(PC, { reglage: { salles: VIDE } });
  await dessinee(page);
  const vues = new Set();
  for (let t = 0; t < 40 && !vues.has("attente"); t += 1) { vues.add(await scene(page)); await sleep(100); }
  defaut(vues.has("attente"), `à zéro salle, aucune « attente » en 4 s: ${[...vues]}`);
  await page.close();
  for (const [nom, reglage, geste] of [["salle ouverte", { salles: RANGEE }, false], ["clic", { salles: VIDE }, true]]) {
    const jumeau = await nouvelle(PC, { reglage });
    await dessinee(jumeau);
    if (geste) await jumeau.mouse.click(5, 5);
    const vus = new Set();
    for (let t = 0; t < 40; t += 1) { vus.add(await scene(jumeau)); await sleep(100); }
    exiger(!vus.has("attente"), `${nom} : « attente » a joué quand même: ${[...vus]}`);
    await jumeau.close();
  }
};

/** « cycle » au niveau « tout » : les barres de la mire glissent, au plus un
 * pas par seconde (K14). Le jumeau : en « conseillé », la mire ne bouge pas. */
ETAPES.cycle = async () => {
  // La mire est le bloc `.vide` de la rangée ; c'est la classe `rt-mire` du
  // socle qui lui donne ses barres et leur glissement.
  const lire = (page) => page.evaluate(() => {
    const mire = document.querySelector("#salles .vide");
    return mire ? { position: getComputedStyle(mire).backgroundPosition, animations: mire.getAnimations().length } : null;
  });
  const page = await nouvelle(PC, { reglage: { salles: VIDE }, avant: niveau("tout") });
  await dessinee(page);
  const releves = [];
  const debut = Date.now();
  while (Date.now() - debut < 5000) { releves.push({ t: Date.now() - debut, ...(await lire(page)) }); await sleep(50); }
  exiger(releves[0].position !== undefined, "pas de bloc vide à zéro salle");
  const pas = releves.filter((r, i) => i > 0 && r.position !== releves[i - 1].position).map((r) => r.t);
  defaut(pas.length >= 3, `la mire ne glisse pas en « tout » : ${pas.length} pas en 5 s`);
  const serres = pas.filter((t, i) => i > 0 && t - pas[i - 1] < 900);
  defaut(serres.length === 0, `plus d'un pas par seconde : ${pas.join(", ")} ms`);
  await page.close();
  const jumeau = await nouvelle(PC, { reglage: { salles: VIDE }, avant: niveau("conseille") });
  await dessinee(jumeau);
  const calme = await lire(jumeau);
  defaut(calme.animations === 0, `en « conseillé », la mire a ${calme.animations} animation(s)`);
  await jumeau.close();
};

/** « start » : Appuie sur Start clignote une fois par seconde sans jamais
 * s'éteindre (35 %). Le jumeau : en mouvement réduit, le texte reste, sans
 * clignoter. */
ETAPES.clignotement = async () => {
  const lire = (page) => page.evaluate(() => {
    const s = document.getElementById("start");
    const a = s?.getAnimations()[0];
    return s && {
      visible: s.getBoundingClientRect().height > 0,
      duree: a?.effect?.getComputedTiming().duration ?? null,
      opacites: null,
    };
  });
  const page = await nouvelle(PC, { reglage: { salles: VIDE } });
  await dessinee(page);
  const vu = await lire(page);
  defaut(vu?.visible, "« Appuie sur Start » ne se voit pas à zéro salle");
  defaut(vu.duree === 1000, `le clignotement dure ${vu.duree} ms, 1000 attendues`);
  const opacites = [];
  for (let i = 0; i < 30; i += 1) {
    opacites.push(await page.$eval("#start", (e) => Number(getComputedStyle(e).opacity)));
    await sleep(70);
  }
  defaut(Math.min(...opacites) >= 0.3, `le texte s'éteint : opacité ${Math.min(...opacites)}`);
  defaut(Math.max(...opacites) === 1 && Math.min(...opacites) < 1, `il ne clignote pas : ${[...new Set(opacites)]}`);
  await page.close();
  const jumeau = await nouvelle(PC, { reglage: { salles: VIDE } });
  await jumeau.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await dessinee(jumeau);
  const calme = await lire(jumeau);
  defaut(calme.visible && calme.duree === null, `en mouvement réduit : ${JSON.stringify(calme)}`);
  await jumeau.close();
};

/** « pointeur » au niveau « tout » : la flèche en pixels sur la page et ses
 * boutons. Le jumeau : en « conseillé », la flèche du système. */
ETAPES.pointeur = async () => {
  const lire = (page) => page.evaluate(() => ({
    corps: getComputedStyle(document.body).cursor,
    bouton: getComputedStyle(document.getElementById("ouvrir")).cursor,
  }));
  const page = await nouvelle(PC, { reglage: { salles: VIDE }, avant: niveau("tout") });
  await dessinee(page);
  const vu = await lire(page);
  defaut(vu.corps.startsWith('url("data:'), `en « tout », le pointeur est ${vu.corps.slice(0, 40)}`);
  defaut(vu.bouton.startsWith('url("data:'), `sur « Ouvrir une salle », ${vu.bouton.slice(0, 40)}`);
  await page.close();
  const jumeau = await nouvelle(PC, { reglage: { salles: VIDE }, avant: niveau("conseille") });
  await dessinee(jumeau);
  const calme = await lire(jumeau);
  defaut(!calme.corps.startsWith("url("), `en « conseillé », le pointeur est ${calme.corps.slice(0, 40)}`);
  await jumeau.close();
};

const catalogue = (n) => ({ scanned_ms: 0, room: 1, games: Array.from({ length: n }, (_, i) => ({
  key: `jeu-${i}.iso`, name: `Jeu numéro ${i} au titre assez long`, console: i % 3 === 0 ? "switch" : "gc", art: false,
})) });

/** La rangée de jeux du dépôt (plan salon, salon-importer#0) : à 375 et
 * 390 px, avec 8 puis 30 jeux, chaque jeu a son élément et reçoit le point
 * une fois amené dans la rangée, et la page ne défile pas en largeur. La
 * pile des envois pas encore rangés finit la rangée. */
ETAPES.rayon = async () => {
  for (const vue of [{ ...TELEPHONE, width: 375 }, TELEPHONE]) {
    for (const n of [8, 30]) {
      const page = await nouvelle(vue, {
        reglage: { droits: { peut_importer: true }, catalogue: catalogue(n), imports: [{ id: "a", etat: "envoi", nom: "x.iso", taille: 100, decalage: 27, elements: [] }] },
        chemin: "/importer",
      });
      await page.waitForFunction(() => document.querySelectorAll("#rayon-jeux .rayon-jeu").length > 0, { timeout: 5000 })
        .catch(() => { throw new Defaut(`${vue.width} px, ${n} jeux : la rangée ne se montre pas`); });
      // Chaque jeu amené au milieu de la rangée, une image plus tard (la
      // rangée s'aimante à ses jeux), puis touché en son centre.
      const manques = [];
      for (let i = 0; i < n; i += 1) {
        await page.$eval(`#rayon-jeux .rayon-jeu:nth-of-type(${i + 1})`, (li) => li.scrollIntoView({ block: "center", inline: "center" }))
          .catch(() => {});
        await sleep(60);
        const touche = await page.evaluate((i) => {
          const li = document.querySelectorAll("#rayon-jeux .rayon-jeu")[i];
          if (!li) return false;
          const r = li.getBoundingClientRect();
          const ici = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return Boolean(ici && li.contains(ici));
        }, i);
        if (!touche) manques.push(`jeu-${i}.iso`);
      }
      const vu = await page.evaluate(() => {
        const rangee = document.getElementById("rayon-jeux");
        const jeux = [...rangee.querySelectorAll(".rayon-jeu")];
        return {
          cles: jeux.map((li) => li.dataset.cle),
          large: document.scrollingElement.scrollWidth,
          defile: rangee.scrollWidth > rangee.clientWidth,
          pile: document.querySelector("#pile .pile-dit")?.textContent ?? null,
        };
      });
      const attendues = Array.from({ length: n }, (_, i) => `jeu-${i}.iso`);
      defaut(JSON.stringify(vu.cles) === JSON.stringify(attendues), `${vue.width} px, ${n} jeux : ${vu.cles.length} éléments`);
      defaut(manques.length === 0, `${vue.width} px : jeux hors d'atteinte ${manques}`);
      defaut(vu.large <= vue.width, `${vue.width} px, ${n} jeux : la page défile en largeur (${vu.large} px)`);
      exiger(vu.defile, `${vue.width} px, ${n} jeux : la rangée ne défile pas, l'étape ne prouve rien`);
      defaut(vu.pile === "Sur la pile : 1 envoi pas encore rangé.", `la pile dit « ${vu.pile} »`);
      await page.close();
    }
  }
};

/** La scène « depot » trouve son décor au dépôt : demandée complète, elle
 * joue complète, sans repli. Le jumeau : sans catalogue, pas de place libre,
 * et la scène le dit dans `data-refus`. */
ETAPES["depot-scene"] = async () => {
  const jouer = (page) => page.evaluate(() => {
    globalThis.nel3abAin.scene("depot", { version: "complete" });
    const toile = document.querySelector('header [data-hote="logo"] .rt-mascotte');
    return { version: toile?.dataset.version ?? null, refus: toile?.dataset.refus ?? null };
  });
  const page = await nouvelle(PC, { reglage: { droits: { peut_importer: true }, catalogue: catalogue(8) }, chemin: "/importer" });
  await page.waitForFunction(() => document.querySelector('[data-ancre="place-libre"]') !== null, { timeout: 5000 })
    .catch(() => { throw new Defaut("pas de place libre dans la rangée du dépôt"); });
  await sleep(300);
  const vu = await jouer(page);
  defaut(vu.version === "complete" && vu.refus === "", `« depot » replié : ${JSON.stringify(vu)}`);
  await page.close();
  const jumeau = await nouvelle(PC, { reglage: { droits: { peut_importer: true } }, chemin: "/importer" });
  await jumeau.waitForFunction(() => !document.getElementById("rayon").hidden, { timeout: 5000 })
    .catch(() => { throw new Precondition("la rangée ne dit rien sans catalogue"); });
  const sans = await jouer(jumeau);
  exiger(sans.version !== "complete" && /place-libre/.test(sans.refus ?? ""), `sans catalogue : ${JSON.stringify(sans)}`);
  await jumeau.close();
};

/** Un jeu rangé pendant la visite (plan salon, salon-importer#8) : un envoi
 * en vérification au chargement passe à rangé ; Aïn joue « depot », et la
 * boîte du jeu quitte le haut de la pile pour sa place dans la rangée, en
 * 900 ms et par `transform` seul. Les jumeaux : en mouvement réduit elle
 * apparaît en 150 ms par `opacity` ; un envoi déjà rangé au chargement ne
 * joue rien et rien ne glisse. */
ETAPES["depot-glisse"] = async () => {
  const envoi = (etat, champs = {}) => ({ id: "e1", etat, nom: "zelda.iso", taille: 100, decalage: 100, elements: [], ...champs });
  const range = envoi("termine", { elements: [{ etat: "range", console: "gc", console_libelle: "GameCube", libelle: "Rangé",
    titre: "Zelda", destination: "GameCube", message: "", nom: "zelda.iso", preuve: "", format: "iso" }] });
  const avant = catalogue(3);
  const apres = { ...avant, games: [...avant.games, { key: "zelda.iso", name: "Zelda", console: "gc", art: false }] };
  const glissement = (page, delai) => page.waitForFunction(() => {
    const a = document.querySelector('.rayon-jeu[data-cle="zelda.iso"]')?.getAnimations()[0];
    if (!a) return null;
    const images = a.effect.getKeyframes();
    const bouge = new Set(images.flatMap((k) => Object.keys(k).filter((c) => !["offset", "computedOffset", "easing", "composite"].includes(c))));
    return { duree: a.effect.getTiming().duration, bouge: [...bouge].join(), depart: images[0].transform ?? null };
  }, { timeout: delai, polling: 50 }).then((h) => h.jsonValue()).catch(() => null);
  const joue = (page, delai) => page.waitForFunction(() =>
    document.querySelector('header [data-hote="logo"] .rt-mascotte')?.dataset.scene === "depot", { timeout: delai, polling: 50 })
    .then(() => true).catch(() => false);
  const ouvrir = (imports, suivis, mouvement = "no-preference") => nouvelle(PC, {
    chemin: "/importer",
    avant: niveau("conseille"),
    // Déjà rangé, le jeu est dans la bibliothèque dès le chargement : sa
    // boîte est là, et rien ne doit la faire glisser.
    reglage: { droits: { peut_importer: true }, catalogue: suivis ? avant : apres, catalogueApres: suivis ? apres : null, imports, suivis: suivis ?? {} },
  }).then(async (page) => {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: mouvement }]);
    return page;
  });

  const page = await ouvrir([envoi("verification")], { e1: [envoi("verification"), range] });
  const [scene, vu] = await Promise.all([joue(page, 6000), glissement(page, 8000)]);
  defaut(scene, "Aïn ne joue pas « depot » quand le jeu se range sous les yeux");
  defaut(vu !== null, "la boîte du jeu rangé n'arrive pas dans la rangée en glissant");
  defaut(vu.duree === 900 && vu.bouge === "transform" && vu.depart !== "none", `glissement : ${JSON.stringify(vu)}`);
  await page.close();

  const reduite = await ouvrir([envoi("verification")], { e1: [envoi("verification"), range] }, "reduce");
  const doux = await glissement(reduite, 8000);
  defaut(doux !== null && doux.duree === 150 && doux.bouge === "opacity", `en mouvement réduit : ${JSON.stringify(doux)}`);
  await reduite.close();

  const deja = await ouvrir([range], null);
  await deja.waitForFunction(() => document.querySelector('.rayon-jeu[data-cle="zelda.iso"]') !== null, { timeout: 5000 })
    .catch(() => { throw new Precondition("le jeu déjà rangé n'est pas dans la rangée"); });
  const [sceneDeja, vuDeja] = await Promise.all([joue(deja, 3000), glissement(deja, 3000)]);
  defaut(!sceneDeja && vuDeja === null, `un envoi déjà rangé joue encore : scène ${sceneDeja}, ${JSON.stringify(vuDeja)}`);
  await deja.close();
};

// ── Le déroulé ───────────────────────────────────────────────────────────
const noms = SEULE ? [SEULE] : ROUGE ?? Object.keys(ETAPES);
let echecs = 0;
for (const nom of noms) {
  const etape = ETAPES[nom];
  if (!etape) throw new Error(`étape inconnue: ${nom}`);
  try {
    await etape();
    if (ROUGE) { echecs += 1; console.log(`  VERT INATTENDU ${nom}: l'étape passe sur la page qui devait la faire échouer`); }
    else console.log(`  ok ${nom}`);
  } catch (erreur) {
    if (ROUGE && erreur instanceof Defaut) console.log(`  rouge attendu ${nom}: ${erreur.message}`);
    else { echecs += 1; console.log(`  ${erreur instanceof Precondition ? "PRÉCONDITION" : "RATÉ"} ${nom}: ${erreur.message}`); }
  }
}
await browser.close();
await banc.fermer();
console.log(echecs === 0 ? "\n  PASS" : `\n  FAIL: ${echecs} étape(s)`);
process.exit(echecs === 0 ? 0 : 1);
