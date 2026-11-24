// Le focus, le clavier et les menus de la salle, prouvés dans un vrai
// navigateur contre le banc simulé (`etats-banc.mjs`). Lancé par
// `just focus-navigateur`.
//
// Pourquoi ce pilote existe. L'audit d'accessibilité du 22 novembre 2026 a
// mesuré, à la main, quatre défauts que jsdom ne peut pas voir parce qu'ils
// demandent un vrai focus et une vraie activation des boutons:
//   - Entrée sur un bouton de la colonne n'activait rien: la boucle d'entrée la
//     prenait comme START du jeu (A11Y-01);
//   - dans le menu, Entrée sur « Échap reprend la partie » ouvrait le dossier
//     GameCube sous le curseur (A11Y-02);
//   - le menu ne prenait pas le focus, et Tab passait par douze boutons cachés
//     dessous (A11Y-04);
//   - au clavier, le menu parlait de « A choisit », et sur un téléphone la moitié
//     des rubriques sortait de l'écran (T02, M12).
// Chaque étape en rejoue un, avec son jumeau: une correction qui couperait le
// clavier du jeu passerait sinon pour un progrès.
//
// La relecture adverse du même jour a trouvé que trois mutants du CÂBLAGE de
// la page passaient les quatorze premières étapes: pas de focus à l'entrée,
// zone hors de la tabulation, garde des avis retirée. Elle a aussi mesuré des
// défauts que ces étapes ne regardaient pas: une liste écrasée sur une
// tablette, des libellés coupés à 320 px, la sortie de la Switch hors de
// l'écran, un avis posé sur la sortie du menu, un anneau permanent sur l'image,
// le clavier perdu après un clic sur la colonne, la carte des touches qui
// parlait GameCube à la Wiimote. Les étapes `entree-sans-clic`, `tab-retour`,
// `surcouche`, `tablette`, `coques-telephone`, `anneau`, `clic-colonne`,
// `avis-haut`, `carte-wii` et `connexion-telephone` en viennent, et
// `just focus-navigateur-rouge` exige qu'elles rougissent sur la page relue.
//
// Chaque échec dit s'il porte sur le DÉFAUT nommé ou sur une PRÉCONDITION, comme
// `etats.mjs`: une page d'avant qui tombe sur une précondition ne prouve pas que
// l'étape sait rougir.
//
//   node focus.mjs --page <index.html> --flux <flux.h264> [--port 5481]
//        [--etapes a,b] [--captures dossier] [--rouge-attendu a,b]
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import puppeteer from "puppeteer";
import { demarrerBanc } from "./etats-banc.mjs";

const args = process.argv.slice(2);
const option = (nom, defaut = null) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 ? args[i + 1] : defaut;
};
const PAGE = option("page");
const FLUX = option("flux");
if (!PAGE || !FLUX) throw new Error("usage: focus.mjs --page <index.html> --flux <flux.h264>");
const PORT = Number(option("port", "5481"));
const CAPTURES = option("captures");
const ROUGE = option("rouge-attendu")?.split(",").filter(Boolean) ?? null;
if (CAPTURES) mkdirSync(CAPTURES, { recursive: true });

class Defaut extends Error {}
class Precondition extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PC = { width: 1440, height: 900 };
const TELEPHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const TRAVERS = { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const TABLETTE = { width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const PETIT = { width: 320, height: 568, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const MOYEN = { width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };
/** Les quatre rubriques du menu, par leur identifiant (`ray-…`). */
const RUBRIQUES = ["jeux", "manettes", "salle", "reglages"];
const START_DOLPHIN = 1 << 7;
const PLUS_SWITCH = 1 << 9;

const banc = await demarrerBanc({ port: PORT, page: PAGE, flux: FLUX });
const empreinte = createHash("sha256").update(readFileSync(PAGE)).digest("hex");
const servie = createHash("sha256")
  .update(Buffer.from(await (await fetch(banc.url, { headers: { "accept-encoding": "identity" } })).arrayBuffer()))
  .digest("hex");
if (servie !== empreinte) throw new Error(`la page servie (${servie}) n'est pas ${PAGE} (${empreinte})`);
console.log(JSON.stringify({ page: PAGE, sha256: empreinte }));

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});

async function capture(page, nom) {
  if (!CAPTURES) return;
  const vue = page.viewport();
  await page.screenshot({ path: `${CAPTURES}/${vue.width}x${vue.height}-${nom}.png` });
}

/** Une manette standard simulée, pour la page qui doit parler « A » et « B ». */
function manetteSimulee() {
  const boutons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const pad = {
    id: "Manette du banc (STANDARD GAMEPAD Vendor: 045e Product: 0b13)",
    index: 0,
    connected: true,
    mapping: "standard",
    axes: [0, 0, 0, 0],
    buttons: boutons,
    timestamp: 0,
    vibrationActuator: null,
  };
  Object.defineProperty(navigator, "getGamepads", { value: () => [pad, null, null, null] });
}

// La vue des touches s'ouvre d'elle-même à la première visite au clavier
// et prend la place des rangs de la colonne (chantier salle, étape 6). Les
// étapes qui ne parlent pas de cette visite partent d'une vue déjà lue;
// `premiere-visite`, `touches-cochees` et `carte-wii` (focus.mjs) l'exercent.
async function nouvelle(
  vue,
  {
    console: jeu = "gc",
    format = "dolphin",
    manette = false,
    vierge = true,
    stockage = {},
    appareil = null,
    premiere = false,
  } = {},
) {
  banc.reinitialiser();
  banc.regler({ console: jeu, format, appareil });
  const page = await browser.newPage();
  await page.setViewport(vue);
  await page.evaluateOnNewDocument(
    (vierge, stockage) => {
      try {
        if (vierge && !sessionStorage.getItem("banc-focus")) {
          localStorage.clear();
          sessionStorage.setItem("banc-focus", "1");
        }
        localStorage.setItem("nel3ab:name", "banc");
        localStorage.setItem("nel3ab:banc", "1");
        for (const [cle, valeur] of Object.entries(stockage)) localStorage.setItem(cle, valeur);
      } catch {}
    },
    vierge,
    premiere ? stockage : { "nel3ab:aide-clavier": "vue", ...stockage },
  );
  if (manette) await page.evaluateOnNewDocument(manetteSimulee);
  page.on("pageerror", (e) => console.error(`[pageerror] ${e.message}`));
  await page.goto(banc.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#enter", { timeout: 15000 });
  return page;
}

const peintes = (page) => page.evaluate(() => globalThis.nel3abTest?.counters?.().painted ?? 0);

/** Entre dans la salle. `clavier`: par Entrée sur le bouton, sans aucun clic,
 * comme une personne qui n'a pas touché la souris. */
async function entrer(page, { clavier = false, depuis = null } = {}) {
  // Depuis le 22 novembre 2026, l'adresse porte l'entrée (`?entrer=jouer`,
  // audit P9): un rechargement revient dans la salle sans repasser par
  // l'avant-salle. On ne passe la porte que s'il y en a une.
  if ((await page.$("#enter")) !== null) {
    if (clavier) {
      await page.focus("#enter");
      await page.keyboard.press("Enter");
    } else await page.click("#enter");
  }
  // `depuis`: une page entrée seule au chargement a pu envoyer sa première
  // trame avant cet appel; on compte depuis le rechargement.
  const debut = depuis ?? Date.now();
  while ((await peintes(page)) < 30) {
    if (Date.now() - debut > 20000) throw new Precondition("la page n'a pas peint 30 images en 20 s");
    await sleep(100);
  }
  // La place: le banc donne la 1, et la boucle n'envoie aucune trame avant de
  // la tenir. La première trame reçue en est donc la preuve, colonne repliée
  // ou non (sur un téléphone, `#seat` n'est pas affiché).
  const tenue = Date.now();
  while (banc.trames(debut).length === 0) {
    if (Date.now() - tenue > 8000) throw new Precondition("la page n'envoie aucune trame: elle ne tient pas de place");
    await sleep(100);
  }
}

/** Une touche tenue 150 ms: la boucle lit toutes les 4 ms, mais un appui et un
 * relâchement envoyés d'un coup tombent dans le même tour et ne partent jamais.
 * Une vérification « rien n'est parti » sur un appui instantané ne prouverait
 * donc rien. */
const appuyer = (page, touche) => page.keyboard.press(touche, { delay: 150 });

/** Les boutons reçus par la salle depuis `depuis`, OR des changements. */
const recus = (depuis) => banc.trames(depuis).reduce((tous, une) => tous | une.boutons, 0);

/** Attend un état du DOM, au plus `ms`. */
async function attendre(page, fonction, ms = 2000, ...valeurs) {
  try {
    await page.waitForFunction(fonction, { timeout: ms, polling: 50 }, ...valeurs);
    return true;
  } catch {
    return false;
  }
}

const actif = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return {
      id: el?.id ?? "",
      tag: el?.tagName ?? "",
      dansMenu: Boolean(el?.closest("#menu")),
      dansZone: Boolean(el?.closest("[data-zone-jeu]")),
    };
  });

const menuOuvert = (page) => page.evaluate(() => document.querySelector("#menu") !== null);

/** Ouvre le menu comme une personne au clavier: le focus dans le jeu, Échap. */
async function ouvrirMenu(page) {
  await page.mouse.click(...(await centre(page, "#screen")));
  await page.keyboard.press("Escape");
  if (!(await attendre(page, () => document.querySelector("#menu") !== null)))
    throw new Precondition("Échap n'a pas ouvert le menu");
  await sleep(300);
}

/** L'entrée choisie du menu, par son identifiant. */
const choisie = (page) =>
  page.evaluate(
    () => [...document.querySelectorAll("#menu [id^=item-]")].find((el) => el.dataset.selected === "true")?.id ?? null,
  );

/** Maj+Tab jusqu'à la zone de jeu, au plus `fois` appuis. Rend le nombre
 * d'appuis, ou `null` si la zone n'a jamais eu le focus. */
/** Le bouton de la colonne qui ouvre les mesures, et celui qui les referme:
 * la ligne du coin (`#mesures`) depuis le 23 novembre 2026, les onglets
 * « détails » et « normal » avant. Les contrôles rouges rejouent les pages
 * d'avant: l'étape doit y courir jusqu'à son défaut, pas s'arrêter faute de
 * bouton. */
const ouvreMesures = async (page) => ((await page.$("#mesures")) ? "#mesures" : "#mode-details");
const fermeMesures = async (page) => ((await page.$("#mesures")) ? "#mesures" : "#mode-normal");

async function tabArriereJusquALaZone(page, fois = 25) {
  for (let i = 0; i < fois; i += 1) {
    await page.keyboard.down("Shift");
    await page.keyboard.press("Tab");
    await page.keyboard.up("Shift");
    if ((await actif(page)).dansZone) return i + 1;
  }
  return null;
}

/** Ce qui est coupé ou hors de l'écran dans la liste de chaque rubrique. */
async function coupesDesRubriques(page) {
  const toutes = [];
  for (const id of RUBRIQUES) {
    if ((await page.$(`#ray-${id}`)) === null) throw new Precondition(`pas de rubrique « ${id} »`);
    await page.click(`#ray-${id}`);
    await sleep(350);
    const lu = await page.evaluate(() => {
      const W = innerWidth;
      const entrees = [...document.querySelectorAll("#menu [id^=item-]")];
      return {
        n: entrees.length,
        coupes: entrees
          .map((el) => el.querySelector("[data-libelle]"))
          .filter((el) => el && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1))
          .map((el) => el.textContent),
        dehors: entrees
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.left < -1 || r.right > W + 1;
          })
          .map((el) => el.id),
      };
    });
    if (lu.n === 0) throw new Precondition(`la rubrique « ${id} » n'a aucune entrée`);
    toutes.push({ rubrique: id, ...lu });
  }
  return toutes.filter((r) => r.coupes.length || r.dehors.length);
}

async function centre(page, selecteur) {
  const r = await page.$eval(selecteur, (el) => {
    const b = el.getBoundingClientRect();
    return [b.x + b.width / 2, b.y + b.height / 2];
  });
  return r;
}

const ETAPES = {
  /** A11Y-01: Entrée sur un bouton de la colonne active CE bouton, et la salle
   * ne reçoit pas START. */
  async "entree-colonne"() {
    const page = await nouvelle(PC);
    await entrer(page);
    // La ligne du coin, qui ouvre les mesures depuis le 23 novembre 2026 (les
    // onglets « essentiel » et « mesures » sont partis avec `Sidebar`).
    const ouvre = await ouvreMesures(page);
    if ((await page.$(ouvre)) === null) throw new Precondition("pas de bouton pour les mesures");
    await page.focus(ouvre);
    const depuis = Date.now();
    await appuyer(page, "Enter");
    await sleep(300);
    const details = await page.evaluate(() => document.querySelector("#stats") !== null);
    if ((recus(depuis) & START_DOLPHIN) !== 0) throw new Defaut("Entrée sur « mesures » a envoyé START à la salle");
    if (!details) throw new Defaut("Entrée sur « mesures » n'a pas ouvert les mesures");
    // Le prix de la règle, dit sur l'image: le clavier n'est plus au jeu.
    if ((await page.$("#clavierEnPause")) === null)
      throw new Defaut("rien ne dit que le clavier ne joue plus pendant que la colonne a le focus");
    await capture(page, "clavier-en-pause");
    // Espace, le jumeau de touche: même bouton, même effet, rien pour le jeu.
    await page.focus(await fermeMesures(page));
    await appuyer(page, "Space");
    await sleep(300);
    if (await page.evaluate(() => document.querySelector("#stats") !== null))
      throw new Defaut("Espace sur « mesures » ne les a pas refermées");
    // Et une flèche sur ce bouton ne pousse pas le stick: le focus est ailleurs.
    const fleche = Date.now();
    await appuyer(page, "ArrowRight");
    await sleep(200);
    if (banc.trames(fleche).some((une) => une.x !== 0))
      throw new Defaut("une flèche sur un bouton de la colonne a poussé le stick");
    await page.close();
  },

  /** Le jumeau: Entrée DANS la zone de jeu est START, y compris après un clic
   * sur l'image, et y compris après être passé par la colonne. */
  async "entree-jeu"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await page.focus(await ouvreMesures(page));
    await page.mouse.click(...(await centre(page, "#screen")));
    const depuis = Date.now();
    await page.keyboard.down("Enter");
    await sleep(250);
    await page.keyboard.up("Enter");
    await sleep(250);
    if ((recus(depuis) & START_DOLPHIN) === 0) throw new Defaut("Entrée après un clic sur l'image n'a pas envoyé START");
    if ((await page.$("#clavierEnPause")) !== null)
      throw new Defaut("l'avis « le clavier ne joue plus » reste après un clic sur l'image");
    // Une flèche aussi: le stick bouge, la page ne défile pas.
    const fleche = Date.now();
    await appuyer(page, "ArrowRight");
    await sleep(100);
    if (!banc.trames(fleche).some((une) => une.x > 0)) throw new Defaut("la flèche droite n'a pas poussé le stick");
    await capture(page, "salle-zone-de-jeu");
    await page.close();
  },

  /** Le même jumeau sur la trame Switch d'une salle Xbox 360: Entrée y vaut +. */
  async "entree-jeu-pro"() {
    const page = await nouvelle(PC, { console: "x360", format: "switch" });
    await entrer(page);
    await page.mouse.click(...(await centre(page, "#screen")));
    const depuis = Date.now();
    await page.keyboard.down("Enter");
    await sleep(250);
    await page.keyboard.up("Enter");
    await sleep(250);
    const trames = banc.trames(depuis);
    if (!trames.some((une) => une.trame === "switch"))
      throw new Precondition(`aucune trame Switch reçue: ${JSON.stringify(trames.slice(0, 3))}`);
    if ((recus(depuis) & PLUS_SWITCH) === 0) throw new Defaut("Entrée dans la zone de jeu n'a pas envoyé + (Start)");
    // Et le négatif dans la même salle: Entrée sur un bouton de la colonne.
    await page.focus(await ouvreMesures(page));
    const colonne = Date.now();
    await appuyer(page, "Enter");
    await sleep(300);
    if ((recus(colonne) & PLUS_SWITCH) !== 0) throw new Defaut("Entrée sur « mesures » a envoyé + à la salle");
    await page.close();
  },

  /** Échap ouvre le menu, et il RESTE ouvert. Le menu est un dialogue modal
   * ouvert pendant l'appui: sans `preventDefault`, la fin de l'appui était une
   * demande de fermeture qu'il recevait aussitôt (trouvé par ce pilote le
   * 22 novembre 2026, sur la première version de ce chantier). */
  async "echap-ouvre"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await page.mouse.click(...(await centre(page, "#screen")));
    await page.keyboard.press("Escape");
    await sleep(600);
    if (!(await menuOuvert(page))) throw new Defaut("Échap n'a pas laissé le menu ouvert");
    // Le jumeau: un second Échap le ferme.
    await page.keyboard.press("Escape");
    if (!(await attendre(page, () => document.querySelector("#menu") === null)))
      throw new Defaut("un second Échap ne ferme pas le menu");
    await page.close();
  },

  /** A11Y-02: dans le menu, Entrée et Espace sur le bouton qui a le focus
   * activent CE bouton, pas la ligne sous le curseur. Depuis le menu unique
   * (24 novembre 2026), la ligne choisie d'abord est un jeu, qui ouvre sa
   * fiche : Entrée sur « Reprendre la partie » ferme le menu sans l'ouvrir. */
  async "menu-entree-focus"() {
    for (const touche of ["Enter", "Space"]) {
      const page = await nouvelle(PC);
      await entrer(page);
      await ouvrirMenu(page);
      const jeu = await choisie(page);
      if (jeu === null || !jeu.startsWith("item-game")) throw new Precondition(`la ligne choisie n'est pas un jeu (${jeu})`);
      await page.focus("#closeMenu");
      await page.keyboard.press(touche);
      await sleep(400);
      if (await page.evaluate(() => document.querySelector("#fiche, [id^=item-shelf]") !== null))
        throw new Defaut(`${touche} sur « reprendre » a ouvert la ligne sous le curseur`);
      if (await menuOuvert(page)) throw new Defaut(`${touche} sur « reprendre » n'a pas fermé le menu`);
      await page.close();
    }
  },

  /** Le jumeau (M4): Entrée sur la ligne d'un jeu l'active, au clavier seul,
   * ouvre sa fiche et met le focus sur la sauvegarde cochée. */
  async "menu-entree-curseur"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await ouvrirMenu(page);
    // Le jeu GameCube du banc a des sauvegardes : sa ligne ouvre une fiche.
    // Elle reste grisée tant que la page n'a pas lu /saves.
    if ((await page.$("#item-game1")) === null) throw new Precondition("pas de ligne pour le jeu GameCube");
    if (!(await attendre(page, () => document.querySelector("#item-game1")?.getAttribute("aria-disabled") !== "true", 4000)))
      throw new Precondition("la ligne du jeu GameCube reste grisée");
    for (let i = 0; i < 4 && (await choisie(page)) !== "item-game1"; i += 1) {
      await page.keyboard.press("ArrowDown");
      await sleep(150);
    }
    if ((await choisie(page)) !== "item-game1") throw new Precondition("les flèches n'atteignent pas le jeu GameCube");
    await page.keyboard.press("Enter");
    if (!(await attendre(page, () => document.querySelector("#fiche") !== null)))
      throw new Defaut("Entrée sur la ligne choisie n'a pas ouvert sa fiche");
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      return { id: el?.id ?? "", coche: el instanceof HTMLInputElement && el.type === "radio" && el.checked };
    });
    if (!focus.coche) throw new Defaut(`le focus de la fiche n'est pas la sauvegarde cochée (${focus.id})`);
    await capture(page, "menu-fiche");
    await page.close();
  },

  /** M2 et W2 (ADR D30 amendé): le menu se pose hors de l'image, l'image
   * garde son rectangle, le focus entre dans le menu, et Échap pendant une
   * partie rend le focus au jeu. Le menu n'est plus modal : Tab peut en
   * sortir, et un focus qui arrive dans la zone de jeu le ferme. */
  async "menu-en-colonne"() {
    for (const vue of [{ width: 1280, height: 720 }, PC, TELEPHONE, TRAVERS]) {
      const page = await nouvelle(vue);
      await entrer(page);
      const rect = () =>
        page.evaluate(() => {
          const c = document.querySelector("[data-zone-jeu] canvas")?.getBoundingClientRect();
          return c ? [c.x, c.y, c.width, c.height].map(Math.round).join(",") : null;
        });
      const avant = await rect();
      if (avant === null) throw new Precondition(`à ${vue.width} px, pas d'image`);
      await page.keyboard.press("Escape");
      if (!(await attendre(page, () => document.querySelector("#menu") !== null)))
        throw new Precondition(`à ${vue.width} px, Échap n'a pas ouvert le menu`);
      await sleep(300);
      const lu = await page.evaluate(() => {
        const m = document.querySelector("#menu").getBoundingClientRect();
        const z = document.querySelector("[data-zone-jeu] canvas").getBoundingClientRect();
        const l = Math.max(0, Math.min(m.right, z.right) - Math.max(m.left, z.left));
        const h = Math.max(0, Math.min(m.bottom, z.bottom) - Math.max(m.top, z.top));
        return {
          aire: Math.round(l * h),
          bas: Math.round(m.bottom),
          H: innerHeight,
          modal: document.querySelector("dialog#menu") !== null,
          focus: Boolean(document.activeElement?.closest("#menu")),
        };
      });
      await capture(page, "menu-en-colonne");
      if (lu.modal) throw new Defaut(`à ${vue.width} px, le menu est encore un dialogue`);
      if (lu.aire > 0) throw new Defaut(`à ${vue.width} px, le menu couvre ${lu.aire} px² de l'image`);
      if ((await rect()) !== avant) throw new Defaut(`à ${vue.width} px, l'image a bougé à l'ouverture (${avant} → ${await rect()})`);
      if (lu.bas > lu.H + 1) throw new Defaut(`à ${vue.width} px, le bas du menu sort de la fenêtre (${lu.bas} > ${lu.H})`);
      if (!lu.focus) throw new Defaut(`à ${vue.width} px, le focus n'est pas dans le menu à l'ouverture`);
      // M3a : menu ouvert, une flèche ne pousse pas le stick (→ change de
      // rubrique, et c'est le stick horizontal que le banc relève).
      const depuis = Date.now();
      await appuyer(page, "ArrowRight");
      await sleep(200);
      if (banc.trames(depuis).some((t) => t.x !== undefined && t.x !== 0))
        throw new Defaut(`à ${vue.width} px, une flèche dans le menu a poussé le stick`);
      await page.keyboard.press("Escape");
      if (!(await attendre(page, () => document.querySelector("#menu") === null)))
        throw new Defaut(`à ${vue.width} px, Échap n'a pas fermé le menu`);
      await sleep(200);
      const ferme = await actif(page);
      if (!ferme.dansZone) throw new Defaut(`à ${vue.width} px, la fermeture ne rend pas le focus au jeu (${ferme.tag}#${ferme.id})`);
      await page.close();
    }
    // Le jumeau : un clic sur l'image, menu ouvert, ferme le menu et donne
    // le clavier au jeu.
    const page = await nouvelle(PC);
    await entrer(page);
    await page.click("#openMenu");
    if (!(await attendre(page, () => document.querySelector("#menu") !== null)))
      throw new Precondition("« Menu du jeu » n'a pas ouvert le menu");
    await page.mouse.click(...(await centre(page, "#screen")));
    if (!(await attendre(page, () => document.querySelector("#menu") === null)))
      throw new Defaut("un clic sur l'image ne ferme pas le menu");
    await page.close();
  },

  /** A11Y-02, A11Y-11 et M4: le curseur EST le focus, et il est dit. Une
   * ligne de choix reçoit le focus sur sa pastille cochée. */
  async "curseur-focus"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await ouvrirMenu(page);
    await page.keyboard.press("ArrowRight");
    await sleep(150);
    await page.keyboard.press("ArrowDown");
    await sleep(250);
    const lu = await page.evaluate(() => {
      const choisi = [...document.querySelectorAll("#menu [id^=item-]")].find((el) => el.dataset.selected === "true");
      const ici = document.activeElement;
      return {
        choisi: choisi?.id ?? null,
        focus: ici?.id ?? "",
        dedans: Boolean(choisi && ici && choisi.contains(ici)),
        courant: choisi?.getAttribute("aria-current") ?? null,
        rayon: document.querySelector("#menu [role=tab][aria-selected=true]")?.id ?? null,
        tabulables: [...document.querySelectorAll("#menuPanneau *")].filter((el) => el.tabIndex === 0).length,
      };
    });
    if (lu.choisi === null) throw new Precondition("aucune ligne choisie dans le menu");
    if (!lu.dedans) throw new Defaut(`le focus (${lu.focus || "rien"}) n'est pas dans la ligne choisie (${lu.choisi})`);
    if (lu.courant !== "true") throw new Defaut("la ligne choisie ne porte pas aria-current");
    if (lu.rayon !== "ray-manettes") throw new Defaut(`→ n'a pas choisi la rubrique Manettes (${lu.rayon})`);
    if (lu.tabulables !== 1) throw new Defaut(`${lu.tabulables} éléments du panneau sont dans la tabulation, un seul devrait l'être`);
    await capture(page, "menu-curseur");
    await page.close();
  },

  /** M6: le pied ne vient qu'après un premier usage du clavier, et dit les
   * rubriques et Échap. Ouvert à la souris, pas de pied. */
  async "aides-clavier"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await page.click("#openMenu");
    if (!(await attendre(page, () => document.querySelector("#menu") !== null)))
      throw new Precondition("« Menu du jeu » n'a pas ouvert le menu");
    await sleep(300);
    if ((await page.$("#menu footer")) !== null) throw new Defaut("ouvert à la souris, le menu montre déjà son pied");
    await page.keyboard.press("ArrowDown");
    await sleep(200);
    const pied = await page.evaluate(() => document.querySelector("#menu footer")?.textContent ?? null);
    if (pied === null) throw new Defaut("après une flèche, le menu n'a pas de pied");
    if (!/Échap/.test(pied) || !/rubriques/.test(pied)) throw new Defaut(`le pied ne dit ni Échap ni les rubriques: « ${pied} »`);
    if (/\bA\b|Start/.test(pied)) throw new Defaut(`le pied parle de la manette au clavier: « ${pied} »`);
    await capture(page, "menu-clavier");
    await page.close();
  },

  /** Le jumeau: avec une manette branchée, le même pied parle A, B et
   * Start, et jamais Échap. */
  async "aides-manette"() {
    const page = await nouvelle(PC, { manette: true, premiere: true });
    await entrer(page);
    await ouvrirMenu(page);
    const pied = await page.$eval("#menu footer", (el) => el.textContent ?? "").catch(() => null);
    if (pied === null) throw new Defaut("avec une manette, le menu n'a pas de pied");
    if (!/A\s*valider/.test(pied) || !/B\s*revenir/.test(pied) || !/Start/.test(pied))
      throw new Defaut(`avec une manette, le pied ne parle pas A, B et Start: « ${pied} »`);
    if (/Échap/.test(pied)) throw new Defaut(`avec une manette, le pied parle encore Échap: « ${pied} »`);
    // Et la colonne ne montre pas la carte du clavier à qui tient une manette.
    await page.keyboard.press("Escape");
    await sleep(300);
    if (await page.evaluate(() => document.querySelector("#aideClavier, #vueTouches, #tesTouches") !== null))
      throw new Defaut("la vue des touches du clavier s'affiche alors qu'une manette est branchée");
    await capture(page, "menu-manette");
    await page.close();
  },

  /** T02 et en-jeu-clavier.2: la première visite ouvre la colonne sur « Tes
   * touches au clavier », sans ouvrir de menu: une ligne par touche du profil
   * (neuf pour le profil GameCube par défaut). Avant le 23 novembre 2026,
   * c'était la carte dépliable `#aideClavier`; une page d'avant est lue par
   * elle, pour rougir sur son défaut et non sur un sélecteur. */
  async "premiere-visite"() {
    const page = await nouvelle(PC, { premiere: true });
    await entrer(page);
    const carte = await page.evaluate(() => {
      const vue = document.querySelector("#vueTouches");
      if (vue)
        return {
          ouverte: true,
          lignes: vue.querySelectorAll("[data-ligne-touche]").length,
          texte: vue.textContent ?? "",
          vue: true,
        };
      const el = document.querySelector("#aideClavier");
      return el
        ? { ouverte: el.hasAttribute("open"), lignes: el.querySelectorAll("dl > div").length, texte: el.textContent ?? "", vue: false }
        : null;
    });
    if (carte === null) throw new Defaut("aucune vue des touches à la première visite");
    if (!carte.ouverte) throw new Defaut("la carte des touches est repliée à la première visite");
    if (!/Entrée/.test(carte.texte) || !/Start/.test(carte.texte))
      throw new Defaut(`la vue ne dit pas Entrée pour Start: « ${carte.texte} »`);
    if (carte.vue && carte.lignes !== 9)
      throw new Defaut(`la vue a ${carte.lignes} lignes, le profil GameCube par défaut en a neuf`);
    await capture(page, "premiere-visite");
    // Le jumeau: « Revenir » ramène les rangs, et la visite suivante commence
    // sur eux, le rang « Tes touches au clavier » prêt à rouvrir la vue.
    if (carte.vue) await page.click("#revenirTouches");
    else await page.click("#aideClavier summary");
    await sleep(200);
    const recharge = Date.now();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#enter, #screen", { timeout: 15000 });
    await entrer(page, { depuis: recharge });
    await sleep(300);
    const revue = await page.evaluate(() => ({
      vue: document.querySelector("#vueTouches") !== null,
      rang: document.querySelector("#tesTouches") !== null,
      carte: document.querySelector("#aideClavier")?.hasAttribute("open") ?? null,
    }));
    if (carte.vue) {
      if (revue.vue) throw new Defaut("fermée puis rechargée, la vue des touches se rouvre d'elle-même");
      if (!revue.rang) throw new Defaut("fermée puis rechargée, la colonne n'a plus le rang « Tes touches au clavier »");
    } else if (revue.carte !== false) throw new Defaut(`repliée puis rechargée, la carte vaut ${revue.carte}`);
    await page.close();
  },

  /** en-jeu-clavier.1: une ligne de « Tes touches au clavier » se coche
   * quand sa commande part au jeu, et seulement alors. Le jumeau d'abord,
   * avant que la ligne ne soit cochée pour la visite: le focus sur
   * « Revenir », X et C ne cochent rien et le banc ne reçoit ni A ni B. Puis
   * un clic sur l'image, X: la ligne A se coche et le banc reçoit A. Enfin
   * l'écho muet depuis plus de deux secondes: C ne coche pas B. */
  async "touches-cochees"() {
    const page = await nouvelle(PC, { premiere: true });
    await entrer(page);
    if (!(await attendre(page, () => document.querySelector("#vueTouches [data-ligne-touche]") !== null, 4000)))
      throw new Precondition("pas de vue des touches à la première visite");
    const ligne = (fait) =>
      page.evaluate((fait) => {
        const li = [...document.querySelectorAll("#vueTouches [data-ligne-touche]")].find(
          (el) => el.querySelector(".n3-ligne-fait")?.textContent?.trim() === fait,
        );
        return li ? { suivie: li.hasAttribute("data-suivie"), vue: li.hasAttribute("data-vue") } : null;
      }, fait);
    if ((await ligne("A")) === null || (await ligne("B")) === null)
      throw new Precondition("la vue n'a pas de ligne A ou B");
    if (!(await ligne("A")).suivie) throw new Defaut("la ligne A n'a pas de case: rien ne dirait qu'elle part");
    const A = 1 << 0;
    const B = 1 << 1;
    await page.focus("#revenirTouches");
    const hors = Date.now();
    await appuyer(page, "KeyX");
    await appuyer(page, "KeyC");
    await sleep(300);
    // Une faute et pas une précondition: c'est la garde de la boucle d'entrée
    // qui rend la case muette hors de l'image (la vue a la sienne, prouvée
    // par VueTouches.test.tsx), et c'est elle que ce jumeau tient.
    if ((recus(hors) & (A | B)) !== 0) throw new Defaut("X ou C sur « Revenir » est parti au jeu");
    if ((await ligne("A")).vue || (await ligne("B")).vue)
      throw new Defaut("une ligne s'est cochée alors que le focus était hors de l'image");
    await page.mouse.click(...(await centre(page, "#screen")));
    const dedans = Date.now();
    await appuyer(page, "KeyX");
    await sleep(300);
    if ((recus(dedans) & A) === 0) throw new Precondition("X dans la zone n'a pas envoyé A au banc");
    if (!(await ligne("A")).vue) throw new Defaut("A est parti au jeu et sa ligne ne s'est pas cochée");
    if ((await ligne("B")).vue) throw new Defaut("la ligne B s'est cochée sans que B parte");
    await capture(page, "touches-cochees");
    // L'écho muet: la salle n'a rien répondu depuis plus de deux secondes.
    banc.regler({ video: "silent" });
    await sleep(2600);
    if ((await page.$("#vueTouches")) === null) throw new Precondition("la vue des touches a disparu pendant l'écho muet");
    await page.mouse.click(...(await centre(page, "#screen")));
    await appuyer(page, "KeyC");
    await sleep(300);
    if ((await ligne("B")).vue) throw new Defaut("la ligne B s'est cochée alors que l'écho se tait depuis plus de 2 s");
    await page.close();
  },

  /** en-jeu-clavier.4: Ctrl seule dans la zone agrandit l'image, Échap ouvre
   * le menu sans la rétrécir, et Ctrl ramène la salle. Le jumeau: dans une
   * salle Switch, F est la gâchette R; elle part au banc et n'agrandit rien. */
  async "agrandir-ctrl"() {
    const page = await nouvelle(PC);
    await entrer(page);
    const agrandie = () => page.evaluate(() => document.querySelector("[data-cadre]")?.hasAttribute("data-agrandie") ?? null);
    if ((await agrandie()) === null) throw new Precondition("pas de racine [data-cadre]");
    await page.mouse.click(...(await centre(page, "#screen")));
    await page.keyboard.down("Control");
    await page.keyboard.up("Control");
    if (!(await attendre(page, () => document.querySelector("#side") === null, 3000)))
      throw new Defaut("Ctrl seule dans la zone ne replie pas la colonne");
    if (!(await agrandie())) throw new Defaut("Ctrl seule: la racine ne dit pas l'image agrandie");
    await page.keyboard.press("Escape");
    if (!(await attendre(page, () => document.querySelector("#menu") !== null, 3000)))
      throw new Defaut("Échap, image agrandie, n'ouvre pas le menu du jeu");
    if (!(await agrandie())) throw new Defaut("Échap a rétréci l'image en ouvrant le menu");
    await capture(page, "agrandir-menu");
    await page.keyboard.press("Escape");
    if (!(await attendre(page, () => document.querySelector("#menu") === null, 3000)))
      throw new Precondition("Échap ne referme pas le menu");
    await page.mouse.click(...(await centre(page, "#screen")));
    await page.keyboard.down("Control");
    await page.keyboard.up("Control");
    if (!(await attendre(page, () => document.querySelector("#side") !== null, 3000)))
      throw new Defaut("Ctrl ne ramène pas la salle");
    await page.close();
    // Le jumeau: F dans une salle Switch.
    const pro = await nouvelle(PC, { console: "x360", format: "switch" });
    await entrer(pro);
    await pro.mouse.click(...(await centre(pro, "#screen")));
    const depuis = Date.now();
    await appuyer(pro, "KeyF");
    await sleep(300);
    const R_SWITCH = 1 << 5;
    if ((recus(depuis) & R_SWITCH) === 0) throw new Precondition("F n'a pas envoyé R au banc");
    if ((await pro.$("#side")) === null) throw new Defaut("F a replié la colonne dans une salle Switch");
    await pro.close();
  },

  /** T13 et P12: quatre rubriques nommées, une pour les manettes. */
  async "rubriques"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await ouvrirMenu(page);
    const lu = await page.evaluate(() =>
      [...document.querySelectorAll("#menu [id^=ray-]")].map((el) => {
        const nom = el.querySelector("[data-nom]") ?? el;
        let opacite = 1;
        for (let n = nom; n && n !== document.body; n = n.parentElement) opacite *= Number(getComputedStyle(n).opacity);
        const r = el.getBoundingClientRect();
        return { id: el.id, texte: nom.textContent?.trim() ?? "", opacite, gauche: r.left, droite: r.right };
      }),
    );
    const caches = lu.filter((r) => r.opacite < 0.9 || r.droite > 1440 || r.gauche < 0);
    if (caches.length) throw new Defaut(`des rubriques sont muettes ou hors écran: ${JSON.stringify(caches)}`);
    if (!lu.some((r) => r.id === "ray-manettes")) throw new Defaut(`pas de rubrique « manettes »: ${lu.map((r) => r.id)}`);
    if (lu.some((r) => r.id === "ray-mesures")) throw new Defaut("« mesures » occupe encore une rubrique");
    await page.click("#ray-manettes");
    await sleep(300);
    if ((await page.$("#item-bindings")) === null) throw new Defaut("« manettes » ne porte pas le réglage de la manette");
    if ((await page.$("#item-touches-clavier")) === null)
      throw new Defaut("« manettes » ne mène pas à toutes les touches du clavier (M9)");
    await capture(page, "menu-manettes");
    await page.click("#ray-reglages");
    await sleep(300);
    const reglages = await page.$$eval("#menu [id^=item-]", (els) => els.map((el) => el.id));
    if (reglages.length > 12) throw new Defaut(`« réglages » montre encore ${reglages.length} entrées à plat`);
    if (
      reglages.some((id) =>
        ["item-bindings", "item-touches-clavier", "item-pad", "item-touchpad", "item-padonly"].includes(id),
      )
    )
      throw new Defaut(`des réglages de manette restent dans « réglages »: ${reglages}`);
    await capture(page, "menu-reglages");
    await page.close();
  },

  /** M12: sur un téléphone, les rubriques tiennent dans l'écran, les noms sont
   * entiers dans les QUATRE rubriques et la sortie est un vrai bouton de 44 px.
   * La première version ne mesurait que « jeux », à 390 et 844 px: à 320 px,
   * « appareil des jeux Wii » et « commandes tactiles » restaient coupés dans
   * « manettes » (relecture du 22 novembre 2026). */
  async "telephone"() {
    for (const vue of [PETIT, MOYEN, TELEPHONE, TRAVERS]) {
      const page = await nouvelle(vue);
      await entrer(page);
      await page.keyboard.press("Escape");
      if (!(await attendre(page, () => document.querySelector("#menu") !== null)))
        throw new Precondition("Échap n'a pas ouvert le menu sur téléphone");
      await sleep(400);
      await capture(page, "menu-telephone");
      const lu = await page.evaluate(() => {
        const W = innerWidth;
        const rayons = [...document.querySelectorAll("#menu [id^=ray-]")].map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.id, gauche: Math.round(r.left), droite: Math.round(r.right) };
        });
        const sortie = document.querySelector("#closeMenu")?.getBoundingClientRect();
        return {
          W,
          dehors: rayons.filter((r) => r.gauche < 0 || r.droite > W),
          sortie: sortie ? { h: Math.round(sortie.height), w: Math.round(sortie.width) } : null,
          texte: document.querySelector("#closeMenu")?.textContent ?? "",
        };
      });
      if (lu.dehors.length) throw new Defaut(`à ${lu.W} px, des rubriques sortent de l'écran: ${JSON.stringify(lu.dehors)}`);
      if (!lu.sortie || lu.sortie.h < 44 || lu.sortie.w < 44)
        throw new Defaut(`à ${lu.W} px, la sortie fait ${JSON.stringify(lu.sortie)}, sous 44 px`);
      if (!/Reprendre/.test(lu.texte)) throw new Defaut(`à ${lu.W} px, la sortie dit « ${lu.texte} »`);
      const coupes = await coupesDesRubriques(page);
      await capture(page, "menu-telephone-reglages");
      if (coupes.length) throw new Defaut(`à ${lu.W} px, des libellés sont coupés: ${JSON.stringify(coupes)}`);
      await page.close();
    }
  },

  /** Une tablette en portrait (de 700 à 900 px): la liste ne se tasse pas
   * contre le bord droit quand la croix avance. Sur la première version,
   * « réglages » à 768 px tombait dans 296 px et coupait cinq libellés; la page
   * d'avant n'en coupait aucun (relecture du 22 novembre 2026). */
  async "tablette"() {
    for (const vue of [{ width: 701, height: 900 }, TABLETTE, { width: 900, height: 700 }]) {
      const page = await nouvelle(vue);
      await entrer(page);
      await ouvrirMenu(page);
      const coupes = await coupesDesRubriques(page);
      await capture(page, "menu-reglages");
      if (coupes.length) throw new Defaut(`à ${vue.width} px, ${JSON.stringify(coupes)}`);
      await page.close();
    }
  },

  /** M1, W1 et S1: une seule forme de menu. Avec l'ancienne clé de forme
   * (Wii, Switch), le menu a ses quatre onglets, ses lignes ont toutes le
   * même bord gauche, rien ne déborde en largeur, la sortie est entière et
   * fait 44 px, et la clé est effacée. */
  async "une-seule-forme"() {
    for (const coque of ["wii", "switch"]) {
      for (const vue of [PC, TELEPHONE]) {
        const page = await nouvelle(vue, { stockage: { "nel3ab:shell": coque } });
        await entrer(page);
        await page.keyboard.press("Escape");
        if (!(await attendre(page, () => document.querySelector("#menu") !== null)))
          throw new Precondition(`Échap n'a pas ouvert le menu (${coque})`);
        await sleep(400);
        await capture(page, `menu-${coque}`);
        const lu = await page.evaluate(() => {
          const menu = document.querySelector("#menu");
          const bords = new Set(
            [...menu.querySelectorAll("[id^=item-]")].map((el) => Math.round(el.getBoundingClientRect().left)),
          );
          const s = document.querySelector("#closeMenu")?.getBoundingClientRect();
          const ici = s ? document.elementFromPoint(s.x + s.width / 2, s.y + s.height / 2) : null;
          let cle = "?";
          try {
            cle = localStorage.getItem("nel3ab:shell");
          } catch {}
          return {
            onglets: menu.querySelectorAll("[role=tab]").length,
            bords: [...bords],
            deborde: menu.scrollWidth > menu.clientWidth + 1,
            sortie: s ? { g: Math.round(s.left), d: Math.round(s.right), h: Math.round(s.height), bas: Math.round(s.bottom) } : null,
            libre: Boolean(ici && document.querySelector("#closeMenu").contains(ici)),
            W: innerWidth,
            H: innerHeight,
            cle,
          };
        });
        const ou = `${coque} à ${vue.width} px`;
        if (lu.onglets !== 4) throw new Defaut(`${ou}: ${lu.onglets} onglets au lieu de quatre`);
        if (lu.bords.length !== 1) throw new Defaut(`${ou}: les lignes ont ${lu.bords.length} bords gauches (${lu.bords})`);
        if (lu.deborde) throw new Defaut(`${ou}: le menu déborde en largeur`);
        if (lu.sortie === null) throw new Defaut(`${ou}: pas de sortie`);
        if (lu.sortie.g < 0 || lu.sortie.d > lu.W || lu.sortie.bas > lu.H || lu.sortie.h < 44)
          throw new Defaut(`${ou}: la sortie sort de l'écran ou fait moins de 44 px ${JSON.stringify(lu.sortie)}`);
        if (!lu.libre) throw new Defaut(`${ou}: la sortie est couverte`);
        if (lu.cle !== null) throw new Defaut(`${ou}: la clé nel3ab:shell est restée (${lu.cle})`);
        await page.close();
      }
    }
  },

  /** Le câblage de l'entrée: entré au clavier, sans aucun clic, le focus est
   * dans la zone de jeu et Entrée y vaut START. Le mutant « pas de focus à
   * l'entrée » passait les 14 étapes de la première version, parce qu'une page
   * sans focus donne aussi ses touches au jeu: d'où la lecture du focus. */
  async "entree-sans-clic"() {
    const page = await nouvelle(PC);
    await entrer(page, { clavier: true });
    const ici = await actif(page);
    if (!ici.dansZone) throw new Defaut(`entré au clavier, le focus est sur ${ici.tag}#${ici.id}, pas dans la zone de jeu`);
    const depuis = Date.now();
    await page.keyboard.down("Enter");
    await sleep(250);
    await page.keyboard.up("Enter");
    await sleep(250);
    if ((recus(depuis) & START_DOLPHIN) === 0) throw new Defaut("Entrée, sans aucun clic, n'a pas envoyé START");
    await page.close();
  },

  /** La zone est dans l'ordre de Tab pendant une partie, et en sort pendant un
   * chargement, où l'écran de chargement la couvre. Le mutant `tabIndex={-1}`
   * passait les 14 étapes de la première version. */
  async "tab-retour"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await page.focus("#leaveRoom");
    const fois = await tabArriereJusquALaZone(page);
    if (fois === null) throw new Defaut("Maj+Tab depuis la colonne n'atteint jamais la zone de jeu");
    const tab = await page.$eval("[data-zone-jeu]", (el) => el.tabIndex);
    if (tab !== 0) throw new Defaut(`la zone a le focus par Tab mais tabIndex vaut ${tab}`);
    // Le jumeau: pendant un chargement, Tab ne s'arrête pas sur une zone cachée.
    banc.annoncerDemarrage();
    if (!(await attendre(page, () => document.querySelector("[data-zone-jeu]")?.tabIndex === -1, 5000)))
      throw new Defaut("pendant un chargement, la zone de jeu reste dans l'ordre de Tab");
    await page.focus("#leaveRoom");
    if ((await tabArriereJusquALaZone(page)) !== null)
      throw new Defaut("pendant un chargement, Maj+Tab s'arrête encore sur la zone de jeu");
    await page.close();
  },

  /** M7a (chantier menus) : un choix court est une rangée de pastilles, et
   * seul le point du choix coché est plein, 400 ms après le clic, en nuit
   * comme en jour (le clic change justement de régie). Sur la page de main,
   * la ligne des couleurs ne montrait qu'une valeur. */
  async "pastilles"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await ouvrirMenu(page);
    await page.click("#ray-reglages");
    await sleep(300);
    const choix = await page.evaluate(
      () =>
        [...document.querySelectorAll("#item-theme input[type=radio]")].filter(
          (r) => r.closest("label")?.getClientRects().length > 0,
        ).length,
    );
    if (choix < 3) throw new Defaut(`la ligne des couleurs montre ${choix} choix au lieu de ses trois`);
    const points = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("#item-theme input[type=radio]")].map((r) => {
          const point = r.parentElement?.querySelector(".n3-menu-point");
          return {
            id: r.value,
            coche: r.checked,
            opacite: point ? Number(getComputedStyle(point, "::after").opacity) : null,
          };
        }),
      );
    for (const regie of ["jour", "nuit"]) {
      // Un vrai clic sur la pastille, à son centre : le rond natif est caché
      // sous le point dessiné.
      await page.$eval(`label:has(#pick-theme-${regie})`, (l) => l.scrollIntoView({ block: "center" }));
      await sleep(100);
      const [x, y] = await centre(page, `label:has(#pick-theme-${regie})`);
      const recoit = await page.evaluate((x, y) => document.elementFromPoint(x, y)?.closest("label")?.textContent ?? null, x, y);
      if (recoit === null) throw new Precondition(`la pastille ${regie} ne reçoit pas le point (${x}, ${y})`);
      await page.mouse.click(x, y);
      await sleep(400);
      const lus = await points();
      const coche = lus.filter((p) => p.coche);
      if (coche.length !== 1 || coche[0].id !== regie)
        throw new Precondition(`après un clic sur ${regie}, cochés : ${JSON.stringify(coche)}`);
      const faux = lus.filter((p) => p.opacite !== (p.coche ? 1 : 0));
      if (faux.length > 0) throw new Defaut(`en ${regie}, des points ne disent pas le choix : ${JSON.stringify(lus)}`);
    }
    await capture(page, "pastilles");
    await page.close();
  },

  /** M8 : chaque ligne porte son aide, toujours visible et entière ; rien
   * ne change de hauteur quand le focus descend. Le menu façon XMB tenait
   * des lignes de hauteur fixe, mais n'y montrait l'aide que sous la ligne
   * choisie, tronquée. */
  async "aides-fixes"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await ouvrirMenu(page);
    await page.click("#ray-reglages");
    await sleep(300);
    // La hauteur de chaque ligne et l'écart jusqu'à la suivante : une aide
    // posée SOUS la ligne choisie, hors d'elle, pousse la suivante sans
    // changer la hauteur de la ligne elle-même. L'écart ne dépend pas du
    // défilement.
    const hauteurs = () =>
      page.evaluate(() => {
        const lignes = [...document.querySelectorAll("#menu [id^=item-]")];
        return Object.fromEntries(
          lignes.flatMap((el, i) => {
            const r = el.getBoundingClientRect();
            const suivante = lignes[i + 1]?.getBoundingClientRect();
            return [
              [el.id, r.height],
              ...(suivante ? [[`${el.id}→suivante`, suivante.top - r.top]] : []),
            ];
          }),
        );
      });
    /** Les aides qui se voient en entier : présentes, non vides, et sans
     * texte coupé par leur boîte. */
    const aides = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("#menu [id^=item-]")].map((el) => {
          const aide = document.getElementById(`aide-${el.id.slice(5)}`);
          if (!aide || aide.textContent.trim() === "") return "absente";
          const r = aide.getBoundingClientRect();
          if (r.height === 0 || getComputedStyle(aide).visibility === "hidden") return "cachée";
          return aide.scrollWidth > aide.clientWidth + 1 || aide.scrollHeight > aide.clientHeight + 1 ? "coupée" : "vue";
        }),
      );
    const avant = await hauteurs();
    if (Object.keys(avant).length < 9) throw new Precondition(`moins de cinq lignes sous « réglages »`);
    const vuesAvant = await aides();
    if (vuesAvant.filter((v) => v === "vue").length < 4)
      throw new Defaut(`les aides ne se voient pas sur chaque ligne : ${vuesAvant.join(", ")}`);
    const premiere = await choisie(page);
    const premier = Object.keys(avant)[0];
    await page.focus(`#${premier}`);
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("ArrowDown");
      await sleep(80);
    }
    await sleep(300);
    if ((await choisie(page)) === premiere && premiere !== null)
      throw new Precondition("huit flèches n'ont pas déplacé la ligne choisie");
    const apres = await hauteurs();
    const vuesApres = await aides();
    if (vuesApres.join() !== vuesAvant.join())
      throw new Defaut(`les aides changent avec le focus : ${vuesAvant.join(", ")} puis ${vuesApres.join(", ")}`);
    const sautes = Object.keys(avant).filter((id) => id in apres && Math.abs(avant[id] - apres[id]) > 0.5);
    if (sautes.length)
      throw new Defaut(
        `des lignes changent de hauteur avec le focus : ${sautes.map((id) => `${id} ${Math.round(avant[id])}→${Math.round(apres[id])}`).join(", ")}`,
      );
    await page.close();
  },

  /** M12, M13, W4, S4 : au niveau conseillé, ce qui bouge dans le menu ne
   * fait que paraître (opacité), en 120 ms au plus, et rien n'y tourne en
   * boucle. Le XMB respirait sans fin et grossissait la ligne choisie. */
  async "mouvement-menu"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await ouvrirMenu(page);
    const vus = [];
    const lire = () =>
      page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => {
            const cible = a.effect?.target;
            return cible instanceof Element && cible.closest("#menu, .n3-menu, .n3-xmb, dialog[open]") !== null;
          })
          .map((a) => {
            const t = a.effect.getTiming();
            const proprietes = new Set(
              a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !["offset", "easing", "composite", "computedOffset"].includes(p))),
            );
            return {
              nom: a.animationName ?? a.transitionProperty ?? a.constructor.name,
              duree: Number(t.duration) || 0,
              infinie: t.iterations === Infinity,
              proprietes: [...proprietes],
            };
          }),
      );
    for (const touche of ["ArrowRight", "ArrowDown", "ArrowDown", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowDown", "ArrowRight"]) {
      await page.keyboard.press(touche);
      await sleep(40);
      vus.push(...(await lire()));
    }
    if (vus.length === 0) throw new Precondition("aucune animation vue dans le menu : rien à juger");
    const fautes = vus.filter(
      (a) => a.infinie || a.duree > 120 || a.proprietes.some((p) => p !== "opacity"),
    );
    if (fautes.length)
      throw new Defaut(`le menu anime autre chose qu'un fondu court : ${JSON.stringify(fautes.slice(0, 3))}`);
    await page.close();
  },

  /** M15 : dans la fiche d'un jeu, la barre « Lancer » se voit sans défiler,
   * dans la zone qui défile et dans la fenêtre, au bureau comme au
   * téléphone. */
  async "fiche-lancer"() {
    for (const vue of [{ width: 1280, height: 720 }, PC, TELEPHONE]) {
      const page = await nouvelle(vue, { console: "wii" });
      await entrer(page);
      await ouvrirMenu(page);
      await page.click("#ray-jeux");
      await sleep(300);
      if (!(await attendre(page, () => document.querySelector("#item-game2:not([aria-disabled=true]):not(:disabled)") !== null, 5000)))
        throw new Precondition(`à ${vue.width} px, le jeu Wii ne se choisit pas`);
      await page.click("#item-game2");
      if (!(await attendre(page, () => document.querySelector("#menu #fiche [data-lancer]") !== null, 3000)))
        throw new Precondition(`à ${vue.width} px, la fiche du jeu ne s'ouvre pas`);
      await sleep(300);
      const lu = await page.evaluate(() => {
        const barre = document.querySelector("#menu [data-lancer]").getBoundingClientRect();
        let zone = document.querySelector("#menu [data-lancer]").parentElement;
        while (zone && !["auto", "scroll"].includes(getComputedStyle(zone).overflowY)) zone = zone.parentElement;
        const z = (zone ?? document.documentElement).getBoundingClientRect();
        const dans = (a, b) => a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5 && a.left >= b.left - 0.5 && a.right <= b.right + 0.5;
        const fenetre = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
        return { zone: dans(barre, z), fenetre: dans(barre, fenetre), haut: Math.round(barre.top), bas: Math.round(barre.bottom) };
      });
      if (!lu.zone || !lu.fenetre)
        throw new Defaut(`à ${vue.width}x${vue.height}, la barre « Lancer » sort de ${lu.zone ? "la fenêtre" : "sa zone"} (${lu.haut} à ${lu.bas} px)`);
      await page.close();
    }
  },

  /** P10 et M10: « Fermer le jeu » passe par sa fiche ; accepté, la
   * fermeture est l'état de la fiche et de sa ligne, pas un avis ; refusé,
   * le refus s'écrit dans le bloc du menu, visible, sans couvrir sa sortie,
   * et ses touches restent à l'avis. Échap dans la fiche revient à la liste
   * sans fermer le menu. */
  async "fermeture-en-cours"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await ouvrirMenu(page);
    if ((await page.$("#ray-salle")) === null) throw new Precondition("pas de rubrique « salle »");
    await page.click("#ray-salle");
    await sleep(300);
    if ((await page.$("#item-close-game")) === null) throw new Precondition("pas de ligne « fermer le jeu »");
    await page.click("#item-close-game");
    if (!(await attendre(page, () => document.querySelector("#menu #fiche #ficheAgir") !== null)))
      throw new Precondition("« fermer le jeu » ne s'ouvre pas en fiche");
    await page.click("#ficheAgir");
    const vu = await attendre(page, () => document.querySelector("#fiche")?.textContent.includes("Fermeture du jeu en cours…"), 4000);
    if (await page.evaluate(() => document.querySelector(".n3-preparation-error") !== null))
      throw new Defaut("une fermeture acceptée s'écrit comme une erreur");
    if (!vu) throw new Defaut("la fiche ne dit pas que la fermeture est en cours");
    if (!(await page.evaluate(() => document.querySelector("#ficheAgir")?.disabled === true)))
      throw new Defaut("« Fermer le jeu » reste actif pendant la fermeture");
    await capture(page, "fermeture-en-cours");
    await page.close();
  },

  async "refus-dans-le-bloc"() {
    for (const vue of [PC, TELEPHONE]) {
      const page = await nouvelle(vue);
      await entrer(page);
      banc.regler({ refus: "Le salon refuse : le jeu ne se ferme pas." });
      await ouvrirMenu(page);
      if ((await page.$("#ray-salle")) === null) throw new Precondition("pas de rubrique « salle »");
      await page.click("#ray-salle");
      await sleep(300);
      if ((await page.$("#item-close-game")) === null) throw new Precondition("pas de ligne « fermer le jeu »");
      await page.click("#item-close-game");
      // Le défaut d'avant le menu unique : la confirmation était un
      // sélecteur posé par-dessus, pas une fiche dans le bloc du menu.
      if (!(await attendre(page, () => document.querySelector("#menu #fiche #ficheAgir") !== null)))
        throw new Defaut("« fermer le jeu » ne s'ouvre pas en fiche dans le menu");
      if (await page.evaluate(() => document.querySelector(".n3-preparation-error") !== null))
        throw new Defaut("un clic sur la ligne seule a fermé le jeu");
      await page.click("#ficheAgir");
      if (!(await attendre(page, () => document.querySelector(".n3-preparation-error") !== null, 4000)))
        throw new Precondition("aucun avis après un refus de « fermer le jeu »");
      // Au bureau, Aïn joue « refus » au coin, par l'arbitre (sa maison
      // porte la scène qu'elle joue).
      if (vue === PC && !(await attendre(page, () => document.querySelector('[data-scene="refus"]') !== null, 3000)))
        throw new Defaut("un refus du salon ne joue pas la scène « refus »");
      await sleep(300);
      await capture(page, "refus-dans-le-bloc");
      const lu = await page.evaluate(() => {
        const avis = document.querySelector(".n3-preparation-error");
        const r = avis.getBoundingClientRect();
        const dessus = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const sortie = document.querySelector("#closeMenu");
        const s = sortie?.getBoundingClientRect();
        const surSortie = s ? document.elementFromPoint(s.x + s.width / 2, s.y + s.height / 2) : null;
        const bouton = avis.querySelector("button");
        return {
          dansMenu: Boolean(avis.closest("#menu")),
          visible: Boolean(dessus && avis.contains(dessus)),
          sortieLibre: Boolean(surSortie && sortie?.contains(surSortie)),
          bouton: Math.round(bouton?.getBoundingClientRect().height ?? 0),
        };
      });
      if (!lu.dansMenu) throw new Defaut("l'avis n'est pas dans le bloc du menu");
      if (!lu.visible) throw new Defaut("l'avis est couvert");
      if (!lu.sortieLibre) throw new Defaut(`à ${vue.width} px, l'avis couvre la sortie du menu`);
      if (lu.bouton < 44) throw new Defaut(`à ${vue.width} px, le bouton de l'avis fait ${lu.bouton} px de haut`);
      // Les flèches sur le bouton de l'avis ne déplacent rien dans la fiche.
      await page.focus(".n3-preparation-error button");
      await page.keyboard.press("ArrowDown");
      await sleep(200);
      if (await page.evaluate(() => !document.activeElement?.closest(".n3-preparation-error")))
        throw new Defaut("une flèche sur le bouton de l'avis a déplacé le focus");
      // Échap dans la fiche revient à la liste, le menu reste ouvert.
      await page.focus("#ficheRevenir");
      await page.keyboard.press("Escape");
      await sleep(300);
      if (!(await menuOuvert(page))) throw new Defaut("Échap dans la fiche a fermé le menu");
      if (await page.evaluate(() => document.querySelector("#fiche") !== null))
        throw new Defaut("Échap dans la fiche n'est pas revenu à la liste");
      // Le jumeau : Échap sur la liste ferme le menu.
      await page.keyboard.press("Escape");
      if (!(await attendre(page, () => document.querySelector("#menu") === null)))
        throw new Defaut("Échap sur la liste ne ferme plus le menu");
      await page.close();
    }
  },

  /** L'anneau de focus ne reste pas sur l'image pendant une partie: il dit où
   * arrive Tab, puis s'efface à la première touche de jeu. Sur la première
   * version, un trait de 3 px longeait l'image toute la partie après Échap. */
  async "anneau"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await ouvrirMenu(page);
    await page.keyboard.press("Escape");
    if (!(await attendre(page, () => document.querySelector("#menu") === null)))
      throw new Precondition("Échap n'a pas fermé le menu");
    if (!(await actif(page)).dansZone) throw new Precondition("la fermeture n'a pas rendu le focus au jeu");
    const trait = () => page.$eval("[data-zone-jeu]", (el) => getComputedStyle(el).outlineStyle);
    // Rendu par Échap, le focus revient au jeu sans anneau: on y retourne pour
    // jouer, pas pour chercher où est le focus.
    const rendu = await trait();
    if (rendu !== "none") throw new Defaut(`rendu au jeu par Échap, la zone porte un anneau (${rendu})`);
    await page.keyboard.down("ArrowRight");
    await sleep(300);
    await page.keyboard.up("ArrowRight");
    const pendant = await trait();
    await capture(page, "anneau-pendant-partie");
    if (pendant !== "none") throw new Defaut(`l'anneau de focus (${pendant}) reste sur l'image pendant la partie`);
    // Le ▶ du socle (effet « curseur », allumé à tous les niveaux) suit le
    // focus dans la colonne, à gauche du rang visé et hors de l'image ; il
    // se cache quand le focus part dans la zone de jeu, et ne se pose
    // jamais sur l'image. Jusqu'à la relecture du 23 novembre 2026, la salle
    // n'activait aucun ▶ (en-jeu-clavier.5).
    const fleche = () =>
      page.evaluate(() => {
        const t = document.querySelector("#screen").getBoundingClientRect();
        return [...document.querySelectorAll(".rt-curseur[data-visible]")].map((f) => {
          const r = f.getBoundingClientRect();
          const sur =
            Math.min(r.right, t.right) - Math.max(r.left, t.left) > 0.5 &&
            Math.min(r.bottom, t.bottom) - Math.max(r.top, t.top) > 0.5;
          const cible = document.activeElement?.getBoundingClientRect();
          return {
            dansColonne: f.closest("#side") !== null,
            sur,
            aGauche: cible ? r.right <= cible.left + 1 && r.bottom > cible.top && r.top < cible.bottom : false,
          };
        });
      });
    await page.focus("#leaveRoom");
    await sleep(150);
    const surQuitter = await fleche();
    if (surQuitter.length !== 1 || !surQuitter[0].dansColonne || !surQuitter[0].aGauche)
      throw new Defaut(`le ▶ ne se pose pas devant « Quitter la salle » dans la colonne (${JSON.stringify(surQuitter)})`);
    if (surQuitter[0].sur) throw new Defaut("le ▶ de la colonne se pose sur l'image");
    // Le jumeau: arrivé par Tab, l'anneau se montre...
    if ((await tabArriereJusquALaZone(page)) === null) throw new Precondition("Maj+Tab n'atteint pas la zone");
    const dansLaZone = await fleche();
    if (dansLaZone.length) throw new Defaut(`le focus dans la zone de jeu, un ▶ reste visible (${JSON.stringify(dansLaZone)})`);
    const parTab = await trait();
    if (parTab === "none") throw new Defaut("arrivé par Tab, la zone de jeu ne montre aucun anneau");
    // ... puis s'efface à la première touche qui joue.
    await page.keyboard.down("ArrowRight");
    await sleep(300);
    await page.keyboard.up("ArrowRight");
    const joue = await trait();
    if (joue !== "none") throw new Defaut(`arrivé par Tab, l'anneau (${joue}) reste après une touche de jeu`);
    await page.close();
  },

  /** Un clic de souris sur un bouton ponctuel de la colonne rend le clavier au
   * jeu: c'était le geste le plus courant d'une partie (une prise, un mode),
   * et il coupait la manette jusqu'au prochain clic sur l'image. */
  async "clic-colonne"() {
    const page = await nouvelle(PC);
    await entrer(page);
    for (const id of [await ouvreMesures(page), await fermeMesures(page), "#port2"]) {
      if ((await page.$(id)) === null) throw new Precondition(`pas de bouton ${id}`);
      await page.mouse.click(...(await centre(page, id)));
      await sleep(250);
      const depuis = Date.now();
      await appuyer(page, "ArrowRight");
      await sleep(150);
      if (!banc.trames(depuis).some((une) => une.x > 0))
        throw new Defaut(`après un clic sur ${id}, la flèche ne pousse plus le stick`);
    }
    // Le jumeau: au clavier, le focus reste sur le bouton qu'on active.
    const ouvre = await ouvreMesures(page);
    await page.focus(ouvre);
    await appuyer(page, "Enter");
    await sleep(250);
    const ici = await actif(page);
    if (`#${ici.id}` !== ouvre) throw new Defaut(`Entrée au clavier sur « mesures » a mis le focus sur ${ici.tag}#${ici.id}`);
    await page.close();
  },

  /** « mesures techniques » sur un téléphone: le résumé s'ouvre dans le
   * menu, et la colonne ne coupe pas l'écran en deux moitiés de 195 px. La
   * valeur dit l'état, pas un compte d'images (relecture du 22 novembre 2026). */
  async "connexion-telephone"() {
    const ouvrir = async (vue) => {
      const page = await nouvelle(vue);
      await entrer(page);
      await page.keyboard.press("Escape");
      if (!(await attendre(page, () => document.querySelector("#menu") !== null)))
        throw new Precondition("Échap n'a pas ouvert le menu");
      await sleep(300);
      await page.click("#ray-reglages");
      await sleep(300);
      if ((await page.$("#item-connexion")) === null) {
        if ((await page.$("#item-advanced")) === null) throw new Precondition("pas de « réglages avancés »");
        // Un clic du DOM: l'entrée peut être sous le bas de la fenêtre de la
        // liste, qui la coupe, et un clic aux coordonnées tomberait à côté.
        await page.$eval("#item-advanced", (el) => el.click());
        await sleep(300);
      }
      if ((await page.$("#item-connexion")) === null) throw new Precondition("pas d'entrée « mesures techniques »");
      // `data-valeur` depuis la relecture; avant, la valeur était le dernier
      // enfant de l'entrée.
      const valeur = await page.$eval(
        "#item-connexion",
        (el) => (el.querySelector("[data-valeur]") ?? el.lastElementChild)?.textContent?.trim() ?? "",
      );
      if (/images?$/.test(valeur)) throw new Defaut(`la valeur de « mesures techniques » est un compte: « ${valeur} »`);
      await page.$eval("#item-connexion", (el) => el.click());
      await sleep(400);
      return page;
    };
    const tel = await ouvrir(TELEPHONE);
    const lu = await tel.evaluate(() => ({
      menu: document.querySelector("#menu") !== null,
      resume: document.querySelector("#fiche dl")?.textContent ?? null,
      colonne: Math.round(document.querySelector("aside")?.getBoundingClientRect().width ?? 0),
    }));
    await capture(tel, "connexion");
    if (!lu.menu || lu.resume === null)
      throw new Defaut(`sur un téléphone, « mesures techniques » n'ouvre pas son résumé dans la fiche du menu (${JSON.stringify(lu)})`);
    if (!/en marche/.test(lu.resume)) throw new Defaut(`le résumé ne dit pas l'état: « ${lu.resume} »`);
    await tel.close();
    // Le jumeau: sur un ordinateur, le détail s'ouvre dans la colonne.
    const pc = await ouvrir(PC);
    if (!(await attendre(pc, () => document.querySelector("#stats") !== null && document.querySelector("#menu") === null)))
      throw new Defaut("sur un ordinateur, « mesures techniques » n'ouvre plus le détail dans la colonne");
    await pc.close();
  },

  /** La carte des touches d'une salle Wii nomme les boutons de l'appareil de
   * la place. À la Wiimote, la première version disait « Entrée → Start » et
   * « S → X », là où le jeu lit + et 1 (relecture du 22 novembre 2026). */
  async "carte-wii"() {
    const lire = async (options) => {
      const page = await nouvelle(PC, { ...options, premiere: true });
      await entrer(page);
      if (
        !(await attendre(
          page,
          () => document.querySelector("#vueTouches [data-ligne-touche], #aideClavier dl") !== null,
          4000,
        ))
      )
        throw new Precondition("pas de carte des touches");
      await sleep(300);
      // La vue des touches depuis le 23 novembre 2026, la carte dépliable avant.
      const paires = await page.evaluate(() =>
        document.querySelector("#vueTouches")
          ? [...document.querySelectorAll("#vueTouches [data-ligne-touche]")].map((el) => [
              el.querySelector(".n3-ligne-touches")?.textContent?.trim(),
              el.querySelector(".n3-ligne-fait")?.textContent?.trim(),
            ])
          : [...document.querySelectorAll("#aideClavier dl > div")].map((el) => [
              el.querySelector("dt")?.textContent?.trim(),
              el.querySelector("dd")?.textContent?.trim(),
            ]),
      );
      if (options.console === "wii") await capture(page, "carte-wii");
      await page.close();
      return new Map(paires.map(([touche, fait]) => [fait, touche]));
    };
    const wiimote = await lire({ console: "wii", appareil: 1 });
    if (wiimote.get("bouton +") !== "Entrée" || wiimote.get("1") !== "S")
      throw new Defaut(`à la Wiimote, la carte dit ${JSON.stringify([...wiimote])}`);
    if (wiimote.has("Start") || wiimote.has("X"))
      throw new Defaut(`à la Wiimote, la carte parle encore GameCube: ${JSON.stringify([...wiimote])}`);
    // Le jumeau: une salle GameCube garde Start et X.
    const gc = await lire({ console: "gc" });
    if (gc.get("Start") !== "Entrée" || gc.get("X") !== "S")
      throw new Defaut(`en GameCube, la carte dit ${JSON.stringify([...gc])}`);
  },

  /** L'avis « le jeu ne reçoit plus tes touches » ne se pose pas en bas de
   * l'image, où vivent déjà la proposition, la pastille de liaison et l'avis du
   * format réduit: la proposition, plus tard dans le DOM, pouvait couvrir son
   * bouton. Depuis le 23 novembre 2026 (chantier salle), il ne se pose plus
   * du tout sur l'image: une bande noire où il tient, sinon le pied de la
   * colonne (`lieuDesAvis`). */
  async "avis-haut"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await page.focus(await ouvreMesures(page));
    if (!(await attendre(page, () => document.querySelector("#clavierEnPause") !== null)))
      throw new Precondition("l'avis de pause ne s'affiche pas");
    const lu = await page.evaluate(() => {
      const image = document.querySelector("#screen").getBoundingClientRect();
      const avis = document.querySelector("#clavierEnPause").getBoundingClientRect();
      const bouton = document.querySelector("#clavierEnPause button");
      const b = bouton.getBoundingClientRect();
      const ici = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      const l = Math.min(image.right, avis.right) - Math.max(image.left, avis.left);
      const h = Math.min(image.bottom, avis.bottom) - Math.max(image.top, avis.top);
      return { coupe: l > 0 && h > 0 ? Math.round(l * h) : 0, libre: bouton.contains(ici), texte: bouton.textContent };
    });
    await capture(page, "avis-haut");
    if (lu.coupe > 0) throw new Defaut(`l'avis est posé sur l'image (${lu.coupe} px²)`);
    if (!lu.libre) throw new Defaut("le bouton de l'avis est couvert");
    await page.close();
  },

  /** colonne.10: la colonne déborde à 1280×720. Tab passe sur chaque arrêt
   * de la colonne, et chacun se voit en entier: ni sous « Plus bas », ni sous
   * la pile des avis collée en tête. Le jumeau, dans la même page: la marge
   * de défilement du bas remise à 0, au moins un arrêt passe sous « Plus
   * bas ». Sans ce jumeau, une colonne qui ne déborde pas passerait pour rien. */
  async "colonne-deborde"() {
    const page = await nouvelle({ width: 1280, height: 720 });
    await entrer(page);
    await page.evaluate(() => {
      const autres = document.querySelector("#autresReglages");
      if (autres) autres.open = true;
    });
    const deborde = await page.evaluate(() => {
      const side = document.querySelector("#side");
      return side ? side.scrollHeight > side.clientHeight + 40 : false;
    });
    if (!deborde) throw new Precondition("la colonne ne déborde pas à 1280×720");
    if ((await page.$("#leaveRoom")) === null) throw new Precondition("pas de « Quitter » en tête de colonne");
    /** Les arrêts de Tab dans la colonne, et ceux qu'on ne voit pas en entier. */
    const parcourir = async () => {
      await page.evaluate(() => {
        document.querySelector("#side").scrollTop = 0;
        document.querySelector("#leaveRoom").focus();
      });
      const caches = [];
      let arrets = 0;
      for (let i = 0; i < 60; i += 1) {
        await appuyer(page, "Tab");
        await sleep(60);
        const lu = await page.evaluate(() => {
          const el = document.activeElement;
          const side = document.querySelector("#side");
          if (!el || !side?.contains(el)) return null;
          const r = el.getBoundingClientRect();
          const c = side.getBoundingClientRect();
          const plus = document.querySelector("#plusBas")?.getBoundingClientRect();
          const tete = document.querySelector("#side > .sticky")?.getBoundingClientRect();
          const bas = plus && plus.height > 0 ? plus.top : c.bottom;
          const haut = tete && tete.height > 0 ? tete.bottom : c.top;
          return {
            nom: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} « ${(el.textContent ?? "").trim().slice(0, 24)} »`,
            vu: r.top >= haut - 0.5 && r.bottom <= bas + 0.5,
          };
        });
        if (lu === null) break;
        arrets += 1;
        if (!lu.vu) caches.push(lu.nom);
      }
      return { arrets, caches };
    };
    const juste = await parcourir();
    if (juste.arrets < 6) throw new Precondition(`seulement ${juste.arrets} arrêts dans la colonne`);
    await capture(page, "colonne-deborde");
    await page.evaluate(() => {
      document.querySelector("#side").style.scrollPaddingBottom = "0px";
    });
    const sansMarge = await parcourir();
    if (sansMarge.caches.length === 0)
      throw new Precondition("sans marge de défilement, aucun arrêt ne passe sous « Plus bas »: l'étape ne voit rien");
    if (juste.caches.length > 0)
      throw new Defaut(`arrêts cachés dans la colonne (${juste.arrets} arrêts): ${juste.caches.join(", ")}`);
    await page.close();
  },

  /** A11Y-10 et A11Y-11: les contrôles de la colonne ont un nom et un état. */
  async "noms"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await page.evaluate(() => window.dispatchEvent(new Event("pointerup")));
    await attendre(page, () => document.querySelector("#volume") !== null, 4000);
    const lu = await page.evaluate(() => {
      const nom = (el) =>
        el
          ? (el.getAttribute("aria-label") ??
            [...(el.labels ?? [])].map((l) => l.textContent).join(" ") ??
            "")
          : null;
      const p1 = document.querySelector("#port1");
      const p2 = document.querySelector("#port2");
      return {
        volume: nom(document.querySelector("#volume")),
        mesures:
          // aria-expanded depuis le 24 novembre 2026 (la ligne déplie les
          // mesures), aria-pressed sur les pages d'avant.
          ((el) => el?.getAttribute("aria-expanded") ?? el?.getAttribute("aria-pressed") ?? null)(
            document.querySelector("#mesures") ?? document.querySelector("#mode-details"),
          ),
        p1: p1?.getAttribute("aria-label") ?? null,
        p1Inactif: p1?.disabled ?? null,
        p2: p2?.getAttribute("aria-label") ?? null,
      };
    });
    if (lu.volume === null) throw new Precondition("pas de glissière de volume");
    if (!/volume/i.test(lu.volume)) throw new Defaut(`la glissière n'a pas de nom: « ${lu.volume} »`);
    if (lu.mesures !== "false") throw new Defaut(`la ligne des mesures ne dit pas si elles sont ouvertes: ${lu.mesures}`);
    if (!/la tienne/.test(lu.p1 ?? "")) throw new Defaut(`ta prise ne dit pas qu'elle est à toi: « ${lu.p1} »`);
    if (lu.p1Inactif) throw new Defaut("ta prise est retirée de la tabulation (disabled)");
    if (!/libre/.test(lu.p2 ?? "")) throw new Defaut(`une prise libre ne le dit pas: « ${lu.p2} »`);
    await page.close();
  },
};

const voulues = option("etapes")?.split(",").filter(Boolean) ?? Object.keys(ETAPES);
const resultats = [];
for (const nom of voulues) {
  const etape = ETAPES[nom];
  if (!etape) throw new Error(`étape inconnue: ${nom}`);
  const debut = Date.now();
  try {
    await etape();
    resultats.push({ nom, verdict: "passe", ms: Date.now() - debut });
  } catch (erreur) {
    const sorte = erreur instanceof Defaut ? "defaut" : erreur instanceof Precondition ? "precondition" : "erreur";
    resultats.push({ nom, verdict: sorte, message: erreur.message, ms: Date.now() - debut });
  }
  console.log(JSON.stringify(resultats.at(-1)));
  for (const p of await browser.pages()) if (p.url() !== "about:blank") await p.close().catch(() => {});
}
await browser.close();
await banc.fermer();

if (ROUGE) {
  const rate = ROUGE.filter((nom) => resultats.find((r) => r.nom === nom)?.verdict !== "defaut");
  if (rate.length) {
    console.error(`ces étapes ne rougissent pas sur leur défaut: ${rate.join(", ")}`);
    process.exit(1);
  }
  console.log(`rouge attendu, obtenu sur ${ROUGE.length} étape(s)`);
} else if (resultats.some((r) => r.verdict !== "passe")) {
  process.exit(1);
}
