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
