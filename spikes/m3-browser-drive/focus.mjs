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

async function nouvelle(
  vue,
  { console: jeu = "gc", format = "dolphin", manette = false, vierge = true, stockage = {}, appareil = null } = {},
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
    stockage,
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
    if ((await page.$("#mode-details")) === null) throw new Precondition("pas de bouton « détails »");
    await page.focus("#mode-details");
    const depuis = Date.now();
    await appuyer(page, "Enter");
    await sleep(300);
    const details = await page.evaluate(() => document.querySelector("#stats") !== null);
    if ((recus(depuis) & START_DOLPHIN) !== 0) throw new Defaut("Entrée sur « détails » a envoyé START à la salle");
    if (!details) throw new Defaut("Entrée sur « détails » n'a pas changé de mode");
    // Le prix de la règle, dit sur l'image: le clavier n'est plus au jeu.
    if ((await page.$("#clavierEnPause")) === null)
      throw new Defaut("rien ne dit que le clavier ne joue plus pendant que la colonne a le focus");
    await capture(page, "clavier-en-pause");
    // Espace, le jumeau de touche: même bouton, même effet, rien pour le jeu.
    await page.focus("#mode-normal");
    await appuyer(page, "Space");
    await sleep(300);
    if (await page.evaluate(() => document.querySelector("#stats") !== null))
      throw new Defaut("Espace sur « salle » n'a pas changé de mode");
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
    await page.focus("#mode-details");
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
    await page.focus("#mode-details");
    const colonne = Date.now();
    await appuyer(page, "Enter");
    await sleep(300);
    if ((recus(colonne) & PLUS_SWITCH) !== 0) throw new Defaut("Entrée sur « détails » a envoyé + à la salle");
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
   * activent CE bouton, pas l'entrée sous le curseur. */
  async "menu-entree-focus"() {
    for (const touche of ["Enter", "Space"]) {
      const page = await nouvelle(PC);
      await entrer(page);
      await ouvrirMenu(page);
      if ((await page.$("#item-shelf-gc")) === null) throw new Precondition("pas de dossier GameCube dans « jeux »");
      const selon = await page.$eval("#item-shelf-gc", (el) => el.getAttribute("data-selected"));
      if (selon !== "true") {
        // Le curseur sur le dossier GameCube, comme dans le relevé de l'audit.
        await page.keyboard.press("ArrowDown");
        await sleep(200);
      }
      await page.focus("#closeMenu");
      await page.keyboard.press(touche);
      await sleep(400);
      if (await page.evaluate(() => document.querySelector("[id^=item-game]") !== null))
        throw new Defaut(`${touche} sur « reprendre » a ouvert le dossier sous le curseur`);
      if (await menuOuvert(page)) throw new Defaut(`${touche} sur « reprendre » n'a pas fermé le menu`);
      await page.close();
    }
  },

  /** Le jumeau: Entrée sur l'entrée choisie l'active, au clavier seul. */
  async "menu-entree-curseur"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await ouvrirMenu(page);
    // Le curseur sur le dossier GameCube, par les flèches.
    for (let i = 0; i < 3 && (await page.$eval("#item-shelf-gc", (el) => el.dataset.selected)) !== "true"; i += 1) {
      await page.keyboard.press("ArrowDown");
      await sleep(150);
    }
    await page.keyboard.press("Enter");
    if (!(await attendre(page, () => document.querySelector("[id^=item-game]") !== null)))
      throw new Defaut("Entrée sur le dossier choisi ne l'a pas ouvert");
    await capture(page, "menu-dossier");
    await page.close();
  },

  /** A11Y-04: le menu prend le focus, Tab ne sort pas du menu, et la fermeture
   * rend le focus à quelque chose de vivant. */
  async "menu-modal"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await page.click("#openMenu");
    if (!(await attendre(page, () => document.querySelector("#menu") !== null)))
      throw new Precondition("« menu » n'a pas ouvert le menu");
    await sleep(300);
    const ouvert = await actif(page);
    if (!ouvert.dansMenu) throw new Defaut(`le focus n'est pas dans le menu à l'ouverture (${ouvert.tag}#${ouvert.id})`);
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.press("Tab");
      const ici = await actif(page);
      if (!ici.dansMenu && ici.tag !== "BODY") throw new Defaut(`Tab ${i + 1} sort du menu vers ${ici.tag}#${ici.id}`);
    }
    await page.keyboard.press("Escape");
    if (!(await attendre(page, () => document.querySelector("#menu") === null)))
      throw new Defaut("Échap n'a pas fermé le menu");
    await sleep(200);
    const ferme = await actif(page);
    if (ferme.tag === "BODY" || ferme.id === "openMenu")
      throw new Defaut(`le focus retombe sur ${ferme.tag}#${ferme.id} et non sur le jeu`);
    if (!ferme.dansZone) throw new Defaut(`la fermeture ne rend pas le focus au jeu (${ferme.tag}#${ferme.id})`);
    // Le jumeau: menu fermé, la colonne se rejoint au clavier.
    await page.keyboard.press("Tab");
    const suite = await actif(page);
    if (suite.dansMenu || suite.tag === "BODY") throw new Defaut(`Tab après le menu ne va nulle part (${suite.tag})`);
    await page.close();
  },

  /** A11Y-02 et A11Y-11: le curseur EST le focus, et il est dit. */
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
      return {
        choisi: choisi?.id ?? null,
        focus: document.activeElement?.id ?? "",
        courant: choisi?.getAttribute("aria-current") ?? null,
        rayon: document.querySelector("#menu [id^=ray-][aria-current=true]")?.id ?? null,
        autres: [...document.querySelectorAll("#menu [id^=item-]")].filter((el) => el.tabIndex === 0).length,
      };
    });
    if (lu.choisi === null) throw new Precondition("aucune entrée choisie dans le menu");
    if (lu.focus !== lu.choisi) throw new Defaut(`le focus (${lu.focus || "rien"}) n'est pas l'entrée choisie (${lu.choisi})`);
    if (lu.courant !== "true") throw new Defaut("l'entrée choisie ne porte pas aria-current");
    if (lu.rayon === null) throw new Defaut("la rubrique choisie ne porte pas aria-current");
    if (lu.autres !== 1) throw new Defaut(`${lu.autres} entrées sont dans l'ordre de tabulation, une seule devrait l'être`);
    await capture(page, "menu-curseur");
    await page.close();
  },

  /** T02: au clavier, le menu parle Entrée et Échap. */
  async "aides-clavier"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await ouvrirMenu(page);
    const pied = await page.$eval("#menu footer", (el) => el.textContent ?? "");
    if (/A choisi/.test(pied)) throw new Defaut(`le pied parle encore de la manette au clavier: « ${pied} »`);
    if (!/Entrée/.test(pied) || !/Échap/.test(pied)) throw new Defaut(`le pied ne dit ni Entrée ni Échap: « ${pied} »`);
    if (/rayon/.test(pied)) throw new Defaut(`le pied parle de « rayon »: « ${pied} »`);
    await capture(page, "menu-clavier");
    await page.close();
  },

  /** Le jumeau: avec une manette branchée, le même pied parle A et B. */
  async "aides-manette"() {
    const page = await nouvelle(PC, { manette: true });
    await entrer(page);
    await ouvrirMenu(page);
    const pied = await page.$eval("#menu footer", (el) => el.textContent ?? "");
    if (!/A\s*choisir/.test(pied) || !/B\s*(retour|reprendre)/i.test(pied))
      throw new Defaut(`avec une manette, le pied ne parle pas A et B: « ${pied} »`);
    if (/Entrée/.test(pied)) throw new Defaut(`avec une manette, le pied parle encore Entrée: « ${pied} »`);
    // Et la colonne ne montre pas la carte du clavier à qui tient une manette.
    await page.keyboard.press("Escape");
    await sleep(300);
    if (await page.evaluate(() => document.querySelector("#aideClavier") !== null))
      throw new Defaut("la carte des touches du clavier s'affiche alors qu'une manette est branchée");
    await capture(page, "menu-manette");
    await page.close();
  },

  /** T02: la première visite montre les touches, sans ouvrir de menu. */
  async "premiere-visite"() {
    const page = await nouvelle(PC);
    await entrer(page);
    const carte = await page.evaluate(() => {
      const el = document.querySelector("#aideClavier");
      return el ? { ouverte: el.hasAttribute("open"), texte: el.textContent ?? "" } : null;
    });
    if (carte === null) throw new Defaut("aucune carte des touches à la première visite");
    if (!carte.ouverte) throw new Defaut("la carte des touches est repliée à la première visite");
    if (!/Entrée/.test(carte.texte) || !/Start/.test(carte.texte))
      throw new Defaut(`la carte ne dit pas Entrée pour Start: « ${carte.texte} »`);
    await capture(page, "premiere-visite");
    // Le jumeau: repliée une fois, elle reste repliée à la visite suivante.
    await page.click("#aideClavier summary");
    await sleep(200);
    const recharge = Date.now();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#enter, #screen", { timeout: 15000 });
    await entrer(page, { depuis: recharge });
    const revue = await page.evaluate(() => document.querySelector("#aideClavier")?.hasAttribute("open") ?? null);
    if (revue !== false) throw new Defaut(`repliée puis rechargée, la carte vaut ${revue}`);
    await page.close();
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
    await capture(page, "menu-manettes");
    await page.click("#ray-reglages");
    await sleep(300);
    const reglages = await page.$$eval("#menu [id^=item-]", (els) => els.map((el) => el.id));
    if (reglages.length > 12) throw new Defaut(`« réglages » montre encore ${reglages.length} entrées à plat`);
    if (reglages.some((id) => ["item-bindings", "item-pad", "item-touchpad", "item-padonly"].includes(id)))
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

  /** Les coques Wii et Switch sur un téléphone: la sortie est entière dans
   * l'écran et fait 44 px. La sortie de la Switch « Reprendre » sortait à
   * droite (x 324 à 430 sur 390). */
  async "coques-telephone"() {
    for (const coque of ["switch", "wii"]) {
      const page = await nouvelle(TELEPHONE, { stockage: { "nel3ab:shell": coque } });
      await entrer(page);
      await page.keyboard.press("Escape");
      if (!(await attendre(page, () => document.querySelector("#menu") !== null)))
        throw new Precondition(`Échap n'a pas ouvert le menu ${coque}`);
      await sleep(400);
      await capture(page, `menu-${coque}`);
      const sortie = await page.evaluate(() => {
        const el = document.querySelector("#closeMenu");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const ici = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {
          gauche: Math.round(r.left),
          droite: Math.round(r.right),
          h: Math.round(r.height),
          w: Math.round(r.width),
          libre: Boolean(ici && el.contains(ici)),
          W: innerWidth,
          H: innerHeight,
          bas: Math.round(r.bottom),
        };
      });
      if (sortie === null) throw new Precondition(`pas de sortie dans la coque ${coque}`);
      if (sortie.gauche < 0 || sortie.droite > sortie.W || sortie.bas > sortie.H)
        throw new Defaut(`coque ${coque}: la sortie sort de l'écran ${JSON.stringify(sortie)}`);
      if (sortie.h < 44 || sortie.w < 44) throw new Defaut(`coque ${coque}: la sortie fait ${sortie.w}x${sortie.h}`);
      if (!sortie.libre) throw new Defaut(`coque ${coque}: la sortie est couverte`);
      await page.close();
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
    await page.focus("#mode-details");
    const fois = await tabArriereJusquALaZone(page);
    if (fois === null) throw new Defaut("Maj+Tab depuis la colonne n'atteint jamais la zone de jeu");
    const tab = await page.$eval("[data-zone-jeu]", (el) => el.tabIndex);
    if (tab !== 0) throw new Defaut(`la zone a le focus par Tab mais tabIndex vaut ${tab}`);
    // Le jumeau: pendant un chargement, Tab ne s'arrête pas sur une zone cachée.
    banc.annoncerDemarrage();
    if (!(await attendre(page, () => document.querySelector("[data-zone-jeu]")?.tabIndex === -1, 5000)))
      throw new Defaut("pendant un chargement, la zone de jeu reste dans l'ordre de Tab");
    await page.focus("#mode-details");
    if ((await tabArriereJusquALaZone(page)) !== null)
      throw new Defaut("pendant un chargement, Maj+Tab s'arrête encore sur la zone de jeu");
    await page.close();
  },

  /** Les avis posés au-dessus du menu (`Surcouche`): l'avis d'un lancement est
   * DANS le menu ouvert, visible, ne couvre pas la sortie, et garde ses touches:
   * ni une flèche ni Échap sur son bouton ne conduisent le menu. Aucun essai ne
   * citait `Surcouche` dans la première version, et le mutant qui retirait la
   * garde `[data-surcouche]` passait. */
  async "surcouche"() {
    for (const vue of [PC, TELEPHONE]) {
      const page = await nouvelle(vue);
      await entrer(page);
      await ouvrirMenu(page);
      if ((await page.$("#ray-salle")) === null) throw new Precondition("pas de rubrique « salle »");
      await page.click("#ray-salle");
      await sleep(300);
      if ((await page.$("#item-close-game")) === null) throw new Precondition("pas d'entrée « fermer le jeu »");
      await page.click("#item-close-game");
      if (!(await attendre(page, () => document.querySelector("#pick-close") !== null)))
        throw new Precondition("le sélecteur de « fermer le jeu » ne s'ouvre pas");
      await page.click("#pick-close");
      if (!(await attendre(page, () => document.querySelector(".n3-preparation-error") !== null, 4000)))
        throw new Precondition("aucun avis après « fermer le jeu »");
      await sleep(300);
      await capture(page, "surcouche");
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
      if (!lu.dansMenu) throw new Defaut("l'avis n'est pas dans le menu ouvert: le dialogue modal le rend inerte");
      if (!lu.visible) throw new Defaut("l'avis est couvert par le menu");
      if (!lu.sortieLibre) throw new Defaut(`à ${vue.width} px, l'avis couvre la sortie du menu`);
      if (lu.bouton < 44) throw new Defaut(`à ${vue.width} px, le bouton de l'avis fait ${lu.bouton} px de haut`);
      // Les touches de l'avis lui restent.
      const avant = await choisie(page);
      if (avant === null) throw new Precondition("aucune entrée choisie dans « salle »");
      const rang = await page.$$eval("#menu [id^=item-]", (els, id) => els.findIndex((el) => el.id === id), avant);
      const fleche = rang > 0 ? "ArrowUp" : "ArrowDown";
      await page.focus(".n3-preparation-error button");
      await page.keyboard.press(fleche);
      await sleep(250);
      if ((await choisie(page)) !== avant) throw new Defaut("une flèche sur le bouton de l'avis a déplacé le curseur du menu");
      await page.keyboard.press("Escape");
      await sleep(400);
      if (!(await menuOuvert(page))) throw new Defaut("Échap sur le bouton de l'avis a fermé le menu");
      // Le geste « retour » d'Android arrive par l'événement `cancel` du
      // dialogue, sans touche: le même, le focus sur l'avis.
      const retour = () =>
        page.evaluate(() => document.querySelector("#menu")?.dispatchEvent(new Event("cancel", { cancelable: true })));
      await retour();
      await sleep(400);
      if (!(await menuOuvert(page))) throw new Defaut("le geste retour, le focus sur l'avis, a fermé le menu");
      // Le jumeau: la même flèche, sur l'entrée choisie, déplace le curseur.
      await page.focus(`#${avant}`);
      await page.keyboard.press(fleche);
      await sleep(250);
      if ((await choisie(page)) === avant) throw new Defaut("une flèche sur l'entrée choisie ne déplace plus le curseur");
      // Et le geste retour, le focus sur une entrée, ferme le menu.
      await retour();
      if (!(await attendre(page, () => document.querySelector("#menu") === null)))
        throw new Defaut("le geste retour, le focus sur une entrée, ne ferme plus le menu");
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
    // Le jumeau: arrivé par Tab, l'anneau se montre...
    await page.focus("#mode-details");
    if ((await tabArriereJusquALaZone(page)) === null) throw new Precondition("Maj+Tab n'atteint pas la zone");
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
    for (const id of ["#mode-details", "#mode-normal", "#port2"]) {
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
    await page.focus("#mode-details");
    await appuyer(page, "Enter");
    await sleep(250);
    const ici = await actif(page);
    if (ici.id !== "mode-details") throw new Defaut(`Entrée au clavier sur « détails » a mis le focus sur ${ici.tag}#${ici.id}`);
    await page.close();
  },

  /** « état de la connexion » sur un téléphone: le résumé s'ouvre dans le
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
      if ((await page.$("#item-connexion")) === null) throw new Precondition("pas d'entrée « état de la connexion »");
      // `data-valeur` depuis la relecture; avant, la valeur était le dernier
      // enfant de l'entrée.
      const valeur = await page.$eval(
        "#item-connexion",
        (el) => (el.querySelector("[data-valeur]") ?? el.lastElementChild)?.textContent?.trim() ?? "",
      );
      if (/images?$/.test(valeur)) throw new Defaut(`la valeur de « état de la connexion » est un compte: « ${valeur} »`);
      await page.$eval("#item-connexion", (el) => el.click());
      await sleep(400);
      return page;
    };
    const tel = await ouvrir(TELEPHONE);
    const lu = await tel.evaluate(() => ({
      menu: document.querySelector("#menu") !== null,
      resume: document.querySelector("#picker dl")?.textContent ?? null,
      colonne: Math.round(document.querySelector("aside")?.getBoundingClientRect().width ?? 0),
    }));
    await capture(tel, "connexion");
    if (!lu.menu || lu.resume === null)
      throw new Defaut(`sur un téléphone, « état de la connexion » n'ouvre pas son résumé dans le menu (${JSON.stringify(lu)})`);
    if (!/en marche/.test(lu.resume)) throw new Defaut(`le résumé ne dit pas l'état: « ${lu.resume} »`);
    await tel.close();
    // Le jumeau: sur un ordinateur, le détail s'ouvre dans la colonne.
    const pc = await ouvrir(PC);
    if (!(await attendre(pc, () => document.querySelector("#stats") !== null && document.querySelector("#menu") === null)))
      throw new Defaut("sur un ordinateur, « état de la connexion » n'ouvre plus le détail dans la colonne");
    await pc.close();
  },

  /** La carte des touches d'une salle Wii nomme les boutons de l'appareil de
   * la place. À la Wiimote, la première version disait « Entrée → Start » et
   * « S → X », là où le jeu lit + et 1 (relecture du 22 novembre 2026). */
  async "carte-wii"() {
    const lire = async (options) => {
      const page = await nouvelle(PC, options);
      await entrer(page);
      if (!(await attendre(page, () => document.querySelector("#aideClavier dl") !== null, 4000)))
        throw new Precondition("pas de carte des touches");
      await sleep(300);
      const paires = await page.$$eval("#aideClavier dl > div", (els) =>
        els.map((el) => [el.querySelector("dt")?.textContent?.trim(), el.querySelector("dd")?.textContent?.trim()]),
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
   * bouton. */
  async "avis-haut"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await page.focus("#mode-details");
    if (!(await attendre(page, () => document.querySelector("#clavierEnPause") !== null)))
      throw new Precondition("l'avis de pause ne s'affiche pas");
    const lu = await page.evaluate(() => {
      const zone = document.querySelector("[data-zone-jeu]").getBoundingClientRect();
      const avis = document.querySelector("#clavierEnPause").getBoundingClientRect();
      const bouton = document.querySelector("#clavierEnPause button");
      const b = bouton.getBoundingClientRect();
      const ici = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { milieu: zone.top + zone.height / 2, bas: avis.bottom, libre: bouton.contains(ici), texte: bouton.textContent };
    });
    await capture(page, "avis-haut");
    if (lu.bas > lu.milieu) throw new Defaut(`l'avis descend à ${Math.round(lu.bas)} px, sous le milieu de l'image (${Math.round(lu.milieu)})`);
    if (!lu.libre) throw new Defaut("le bouton de l'avis est couvert");
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
        normal: document.querySelector("#mode-normal")?.getAttribute("aria-pressed") ?? null,
        details: document.querySelector("#mode-details")?.getAttribute("aria-pressed") ?? null,
        p1: p1?.getAttribute("aria-label") ?? null,
        p1Inactif: p1?.disabled ?? null,
        p2: p2?.getAttribute("aria-label") ?? null,
      };
    });
    if (lu.volume === null) throw new Precondition("pas de glissière de volume");
    if (!/volume/i.test(lu.volume)) throw new Defaut(`la glissière n'a pas de nom: « ${lu.volume} »`);
    if (lu.normal !== "true" || lu.details !== "false")
      throw new Defaut(`les modes ne disent pas lequel est choisi: ${lu.normal}/${lu.details}`);
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
