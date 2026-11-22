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

async function nouvelle(vue, { console: jeu = "gc", format = "dolphin", manette = false, vierge = true } = {}) {
  banc.reinitialiser();
  banc.regler({ console: jeu, format });
  const page = await browser.newPage();
  await page.setViewport(vue);
  await page.evaluateOnNewDocument((vierge) => {
    try {
      if (vierge && !sessionStorage.getItem("banc-focus")) {
        localStorage.clear();
        sessionStorage.setItem("banc-focus", "1");
      }
      localStorage.setItem("nel3ab:name", "banc");
      localStorage.setItem("nel3ab:banc", "1");
    } catch {}
  }, vierge);
  if (manette) await page.evaluateOnNewDocument(manetteSimulee);
  page.on("pageerror", (e) => console.error(`[pageerror] ${e.message}`));
  await page.goto(banc.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#enter", { timeout: 15000 });
  return page;
}

const peintes = (page) => page.evaluate(() => globalThis.nel3abTest?.counters?.().painted ?? 0);

async function entrer(page) {
  await page.click("#enter");
  const debut = Date.now();
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
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#enter", { timeout: 15000 });
    await entrer(page);
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
   * entiers et la sortie est un vrai bouton de 44 px. */
  async "telephone"() {
    for (const vue of [TELEPHONE, TRAVERS]) {
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
        const coupes = [...document.querySelectorAll("#menu [id^=item-] [data-libelle]")]
          .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
          .map((el) => el.textContent);
        const sortie = document.querySelector("#closeMenu")?.getBoundingClientRect();
        return {
          W,
          dehors: rayons.filter((r) => r.gauche < 0 || r.droite > W),
          coupes,
          sortie: sortie ? { h: Math.round(sortie.height), w: Math.round(sortie.width) } : null,
          texte: document.querySelector("#closeMenu")?.textContent ?? "",
        };
      });
      if (lu.dehors.length) throw new Defaut(`à ${lu.W} px, des rubriques sortent de l'écran: ${JSON.stringify(lu.dehors)}`);
      if (lu.coupes.length) throw new Defaut(`à ${lu.W} px, des libellés sont coupés: ${JSON.stringify(lu.coupes)}`);
      if (!lu.sortie || lu.sortie.h < 44 || lu.sortie.w < 44)
        throw new Defaut(`à ${lu.W} px, la sortie fait ${JSON.stringify(lu.sortie)}, sous 44 px`);
      if (!/Reprendre/.test(lu.texte)) throw new Defaut(`à ${lu.W} px, la sortie dit « ${lu.texte} »`);
      await page.close();
    }
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
