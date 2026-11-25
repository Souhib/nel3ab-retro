// Les parcours de la salle, prouvés dans un vrai navigateur contre le banc
// simulé (`parcours-banc.mjs`). Lancé par `just parcours-navigateur`.
//
// Pourquoi ce pilote existe. Le chantier « parcours et mots » du 22 novembre
// 2026 a mis l'entrée dans l'adresse, une sortie unique, l'invitation, la
// fermeture de la salle et les bons noms de console dans `App.tsx`. Sa
// relecture a appliqué cinq mutants à `App.tsx` ensemble: les 1 105 essais et
// `tsc` sont restés verts. Rien de commité ne tenait ce câblage. Chaque étape
// ci-dessous en tient un morceau, avec son jumeau.
//
// Chaque échec dit s'il porte sur le DÉFAUT nommé ou sur une PRÉCONDITION.
// Un contrôle négatif doit échouer sur le défaut: une page d'avant qui tombe
// sur une précondition ne prouve pas que l'étape sait rougir.
//
//   node parcours.mjs --page <index.html> --flux <flux.h264> [--port 5477]
//        [--etapes a,b] [--captures dossier] [--rouge-attendu a,b]
//
// Sans `--port`, le banc prend un port libre (`port.mjs`).
//
// Sans `--rouge-attendu`, sort en échec dès qu'une étape échoue. Avec, sort en
// succès seulement si CHACUNE des étapes nommées échoue sur son défaut.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import puppeteer from "puppeteer";
import { BIBLIOTHEQUE, BO, MOI, demarrerParcours } from "./parcours-banc.mjs";
import { portDemande } from "./port.mjs";

const args = process.argv.slice(2);
const option = (nom, defaut = null) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 ? args[i + 1] : defaut;
};
const PAGE = option("page");
const FLUX = option("flux");
if (!PAGE || !FLUX) throw new Error("usage: parcours.mjs --page <index.html> --flux <flux.h264>");
const PORT = portDemande(args);
const CAPTURES = option("captures");
const ROUGE = option("rouge-attendu")?.split(",").filter(Boolean) ?? null;
const TOUT = ROUGE !== null;
if (CAPTURES) mkdirSync(CAPTURES, { recursive: true });

class Defaut extends Error {}
class Precondition extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PC = { width: 1440, height: 900 };
const TELEPHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

const banc = await demarrerParcours({ port: PORT, page: PAGE, flux: FLUX });
const empreinte = createHash("sha256").update(readFileSync(PAGE)).digest("hex");
const servie = createHash("sha256")
  .update(Buffer.from(await (await fetch(banc.url)).arrayBuffer()))
  .digest("hex");
if (servie !== empreinte) throw new Error(`la page servie (${servie}) n'est pas ${PAGE} (${empreinte})`);
console.log(JSON.stringify({ page: PAGE, sha256: empreinte, port: banc.port }));

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});

async function capture(page, nom) {
  if (!CAPTURES) return;
  const vue = page.viewport();
  await page.screenshot({ path: `${CAPTURES}/${vue.width}x${vue.height}-${nom}.png` });
}

/** Une page neuve, sur une salle remise à zéro puis réglée. */
async function nouvelle(vue, { salle = {}, stockage = {}, avant = null } = {}) {
  banc.reinitialiser();
  banc.regler(salle);
  const page = await browser.newPage();
  await page.setViewport(vue);
  await page.evaluateOnNewDocument((s) => {
    try {
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    } catch {
      // Un stockage refusé laisse la page sur ses réglages par défaut.
    }
    // La vue des touches de la première visite prend la place des rangs de
    // la colonne (chantier salle, étape 6); les parcours partent d'une vue lue.
    // Les mesures aussi (`nel3ab:mode`) : le navigateur garde le stockage
    // d'une page à l'autre, et `mesures-figee`, qui les déplie, privait
    // l'étape suivante de « Signaler » (24 novembre 2026).
  }, { "nel3ab:aide-clavier": "vue", "nel3ab:mode": "normal", ...stockage });
  if (avant) await page.evaluateOnNewDocument(avant);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.protocol === "data:" || u.protocol === "blob:" || u.origin === banc.base) return req.continue();
    return req.abort();
  });
  return page;
}

const siege = (page) => page.evaluate(() => document.querySelector("#seat")?.textContent ?? "");
const adresse = (page) => page.evaluate(() => location.pathname + location.search);
/** Le texte d'un élément tel qu'il est écrit, et non tel que la feuille de
 * style le montre: `innerText` rend « AVANT DE JOUER » pour une étiquette en
 * capitales, et l'étape comparait alors la casse d'un style. */
const texte = (page, sel = "body") =>
  page.evaluate(
    (s) => (document.querySelector(s)?.textContent ?? "").replace(/\s+/g, " ").trim(),
    sel,
  );

/** L'identifiant de l'élément qui a le focus. */
const idActif = (page) => page.evaluate(() => document.activeElement?.id ?? "");
/** Le focus est-il dans la zone de jeu, où vont les touches du jeu ? */
const dansLeJeu = (page) =>
  page.evaluate(() => document.activeElement?.closest("[data-zone-jeu]") != null);
/** La place qui est à moi, ou `null`. */
const maPlace = (page) =>
  page.evaluate(
    () => [1, 2, 3, 4].find((n) => document.querySelector(`#port${n}`)?.dataset.state === "mine") ?? null,
  );
/** Le contraste WCAG de deux couleurs [r, g, b]. */
function contraste(a, b) {
  const l = ([r, g, bl]) => {
    const c = [r, g, bl].map((v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [hi, lo] = [l(a), l(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Le centre d'un élément, en nombres (un DOMRect arrive vide de `evaluate`). */
const centreDe = (page, sel) =>
  page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  });

/** Attend que `test` soit vrai, au plus `ms`. Rend vrai s'il l'est devenu. */
async function jusqua(test, ms, pas = 100) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await test()) return true;
    if (Date.now() > fin) return false;
    await sleep(pas);
  }
}

/** La salle montre son image, et sa colonne l'a lue : le cadre dit « vit »
 * (`data-etat`, `lib/cadre`). Les rangs du son, du clip et d'Agrandir, et
 * au bureau le panneau de commande, entrent dans la colonne au même rendu,
 * jusqu'à 450 ms après qu'une place se lit dans `#seat` (mesuré le
 * 24 novembre 2026). Un clic posé avant ce rendu vise une colonne qui va
 * changer sous lui. */
async function imageEnPlace(page) {
  const vu = await jusqua(
    () => page.evaluate(() => document.querySelector('[data-cadre][data-etat="vit"][data-sans-image="non"]') !== null),
    10000,
  );
  if (!vu) {
    const etat = await page.evaluate(() => document.querySelector("[data-cadre]")?.dataset.etat ?? "pas de cadre");
    throw new Precondition(`la salle ne montre pas son image (cadre : ${etat})`);
  }
}

/** Un vrai clic au centre de `sel`, comme une personne qui fait défiler la
 * colonne jusqu'à lui : amené au milieu de son conteneur, immobile trois
 * images de suite, et son centre rend bien `sel` (`elementFromPoint`). Le
 * pied collé de la colonne (« Plus bas » et le coin d'Aïn) couvre son bas :
 * une boîte dans la fenêtre ne dit pas qui reçoit le point, et un clic à son
 * centre tombait sur le pied (`place-suit-adresse`, 24 novembre 2026). */
async function cliquer(page, sel) {
  const lu = await page.evaluate(async (s) => {
    const el = document.querySelector(s);
    if (!el) return { absent: true };
    el.scrollIntoView({ block: "center" });
    let avant = "";
    let stables = 0;
    for (let i = 0; i < 120 && stables < 3; i += 1) {
      await new Promise((r) => requestAnimationFrame(r));
      const r = el.getBoundingClientRect();
      const ici = `${r.left},${r.top},${r.width},${r.height}`;
      stables = ici === avant ? stables + 1 : 0;
      avant = ici;
    }
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const recoit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      stable: stables >= 3,
      touche: recoit !== null && el.contains(recoit),
      sous: recoit ? `${recoit.tagName.toLowerCase()}${recoit.id ? `#${recoit.id}` : ""}` : "rien",
    };
  }, sel);
  if (lu.absent) throw new Precondition(`${sel} n'est pas dans la page`);
  if (!lu.stable) throw new Precondition(`${sel} bouge encore après deux secondes d'images`);
  if (!lu.touche) throw new Precondition(`le centre de ${sel} tombe sur ${lu.sous}`);
  await page.mouse.click(lu.x, lu.y);
}

/** Entre dans la salle par la porte de l'avant-salle, comme sur toutes les
 * pages, d'avant comme d'après: les étapes qui ne portent pas sur l'adresse ne
 * doivent pas tomber sur elle. */
async function entrer(page) {
  await page.goto(banc.url, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector("#enter, #screen", { timeout: 15000 });
    if (await page.$("#enter")) {
      await page.click("#enter");
      await page.waitForSelector("#screen", { timeout: 15000 });
    }
  } catch (e) {
    throw new Precondition(`la salle ne s'ouvre pas: ${e.message}`);
  }
  // Au téléphone, la colonne est repliée: on la déplie pour lire la place.
  // Jusqu'à ce qu'elle le soit: un clic posé pendant le premier rendu de la
  // salle peut se perdre, et l'étape tombait alors sur une précondition.
  // Du 22 au 23 novembre 2026, elle était un tiroir, ouvert par « ••• » puis
  // « La salle » ; depuis, la feuille « La salle » de la barre, agrandie par
  // « Toute la salle ». Les pages d'avant gardent leur chemin.
  await jusqua(async () => {
    if (await page.$("#seat")) return true;
    await page.evaluate(() => {
      const avant = document.querySelector("#unbare");
      if (avant) return avant.click();
      const salle = document.querySelector('[data-entree="toute-la-salle"], [data-entree="salle"]');
      if (salle) return salle.click();
      document.querySelector('#laSalle, [data-geste="feuille"], #ouvrirFeuille')?.click();
    });
    return false;
  }, 5000, 300);
  if (!(await jusqua(async () => /place \d|manette \d|\dP|P\d/.test(await siege(page)), 8000)))
    throw new Precondition(`aucune place prise en entrant: « ${await siege(page)} »`);
}

/** Ouvre le menu sur un rayon. */
async function menu(page, rayon) {
  await page.evaluate(() => document.querySelector("#openMenu")?.click());
  if (!(await jusqua(() => page.$(`#ray-${rayon}`).then(Boolean), 3000)))
    throw new Precondition(`le menu ne montre pas le rayon ${rayon}`);
  await page.evaluate((r) => document.getElementById(`ray-${r}`)?.click(), rayon);
  await sleep(500);
}

/** Une préparation du jeu `jeu`, lancée par moi, avec Bo assis et prêt ou non. */
function preparation(jeu, allowed, boPret, boPad = null) {
  return {
    id: `banc-${jeu}`,
    game: jeu,
    key: ["mp4.iso", "sonic.iso", "mkw.rvz"][jeu],
    save: 0,
    starter: MOI,
    allowed,
    players: [
      { port: 1, claim: MOI, name: "Ami", ready: false, pad: null },
      { port: 2, claim: BO, name: "Bo", ready: boPret, pad: boPret ? (boPad ?? allowed[0]) : null },
    ],
  };
}

const ETAPES = {
  /** P9: `?entrer=jouer` entre directement; le jumeau, sans paramètre, reste à
   * l'avant-salle sans ouvrir de socket d'entrée. */
  async "entree-adresse"() {
    const page = await nouvelle(PC);
    await page.goto(`${banc.url}?entrer=jouer`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#enter, #screen", { timeout: 15000 });
    if (await page.$("#enter")) throw new Defaut("`?entrer=jouer` mène à l'avant-salle");
    if (!(await jusqua(async () => /place 1/.test(await siege(page)), 8000)))
      throw new Defaut(`entré par l'adresse sans place: « ${await siege(page)} »`);
    await capture(page, "entree-adresse");
    await page.close();
    const jumeau = await nouvelle(PC);
    await jumeau.goto(banc.url, { waitUntil: "domcontentloaded" });
    await jumeau.waitForSelector("#enter, #screen", { timeout: 15000 });
    if (!(await jumeau.$("#enter"))) throw new Defaut("sans entrée dans l'adresse, la page est entrée seule");
    await sleep(1500);
    if (banc.journal.entrees !== 0) throw new Defaut("l'avant-salle a ouvert une socket d'entrée");
    await jumeau.close();
  },

  /** P9: entrer par la porte écrit l'entrée dans l'adresse, et un rechargement
   * revient dans la salle avec une place. */
  async rechargement() {
    const page = await nouvelle(PC);
    await entrer(page);
    if (!(await jusqua(async () => (await adresse(page)) === "/r/1/?entrer=jouer", 3000)))
      throw new Defaut(`entrer n'écrit pas l'adresse: ${await adresse(page)}`);
    const avant = banc.journal.entrees;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#enter, #screen", { timeout: 15000 });
    if (await page.$("#enter")) throw new Defaut("un rechargement ramène à l'avant-salle");
    if (!(await jusqua(async () => banc.journal.entrees > avant && /place \d/.test(await siege(page)), 8000)))
      throw new Defaut(`rechargé sans reprendre de place: « ${await siege(page)} »`);
    await page.close();
  },

  /** spectateur.1: le spectateur lit QUELLE place il prendra, « Prendre la
   * place N », et c'est bien celle-là qu'il tient après l'appui. Le jumeau
   * d'une salle pleine (aucun bouton) est dans `Colonne.test.tsx`: le banc ne
   * sait pas tenir les quatre places. */
  async "spectateur-prendre"() {
    const page = await nouvelle(PC);
    await page.goto(`${banc.url}?entrer=regarder`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#screen", { timeout: 15000 }).catch(() => {
      throw new Precondition("`?entrer=regarder` n'entre pas dans la salle");
    });
    if (!(await jusqua(async () => /tu regardes/.test(await siege(page)), 5000)))
      throw new Precondition(`entré pour regarder: « ${await siege(page)} »`);
    const texte = await page
      .waitForSelector("#takePad", { timeout: 5000 })
      .then((el) => el.evaluate((b) => b.textContent.trim()))
      .catch(() => "");
    const lu = /Prendre la place (\d)/.exec(texte);
    if (!lu) throw new Defaut(`le bouton du spectateur ne dit pas quelle place: « ${texte} »`);
    await page.click("#takePad");
    if (!(await jusqua(async () => /place \d/.test(await siege(page)), 8000)))
      throw new Precondition(`« ${texte} » sans place: « ${await siege(page)} »`);
    const tenue = /place (\d)/.exec(await siege(page))[1];
    if (tenue !== lu[1]) throw new Defaut(`« ${texte} » a donné la place ${tenue}`);
    await page.close();
  },

  /** La relecture: l'adresse suit la place, pas la porte d'entrée. Entré pour
   * regarder puis assis, on rentre assis; entré pour jouer puis levé, on rentre
   * pour regarder, sans socket d'entrée. */
  async "place-suit-adresse"() {
    const page = await nouvelle(PC);
    await page.goto(`${banc.url}?entrer=regarder`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#screen", { timeout: 15000 }).catch(() => {
      throw new Precondition("`?entrer=regarder` n'entre pas dans la salle");
    });
    if (!(await jusqua(async () => /tu regardes/.test(await siege(page)), 5000)))
      throw new Precondition(`entré pour regarder: « ${await siege(page)} »`);
    await cliquer(page, "#takePad");
    if (!(await jusqua(async () => /place \d/.test(await siege(page)), 8000)))
      throw new Precondition(`« Prendre une place » sans place: « ${await siege(page)} »`);
    if (!(await jusqua(async () => (await adresse(page)) === "/r/1/?entrer=jouer", 3000)))
      throw new Defaut(`assis, l'adresse dit encore ${await adresse(page)}`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#screen", { timeout: 15000 });
    if (!(await jusqua(async () => /place \d/.test(await siege(page)), 8000)))
      throw new Defaut(`le rechargement a rendu la place prise: « ${await siege(page)} »`);
    // Le jumeau: entré pour jouer, puis levé.
    // « Rendre ma place » vit dans « Autres réglages » depuis le
    // 23 novembre 2026 (colonne de la salle) : on le déplie d'abord.
    // Une fois sur cinq, l'étape tombait ici sur « Node is either not
    // clickable or not an Element » (vague B1, 24 novembre 2026). Le clic
    // partait dès que la place se lisait, et la colonne changeait ensuite à
    // la première image : avant elle, « Autres réglages » était en haut et
    // le clic passait ; après elle, il était au pied de la colonne, sous
    // « Plus bas », et « Rendre ma place » restait hors d'atteinte. Depuis la
    // fin de la salle, le panneau de commande d'une GameCube est au pied de
    // la colonne dès l'arrivée (format attendu), et « Autres réglages » passe
    // sous le coin collé d'Aïn : un clic à son centre tombait sur le coin à
    // chaque passage. L'étape attend donc la colonne de l'image, et clique
    // comme une personne qui fait défiler, au point vérifié.
    await imageEnPlace(page);
    await cliquer(page, "#autresReglages > summary");
    if (!(await jusqua(() => page.evaluate(() => document.querySelector("#autresReglages")?.open === true), 2000)))
      throw new Precondition("le clic n'ouvre pas « Autres réglages »");
    await cliquer(page, "#watchOnly");
    if (!(await jusqua(async () => /tu regardes/.test(await siege(page)), 5000)))
      throw new Precondition(`« Rendre ma place » sans effet: « ${await siege(page)} »`);
    if (!(await jusqua(async () => (await adresse(page)) === "/r/1/?entrer=regarder", 3000)))
      throw new Defaut(`levé, l'adresse dit encore ${await adresse(page)}`);
    const avant = banc.journal.entrees;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#screen", { timeout: 15000 });
    await sleep(3000);
    if (banc.journal.entrees !== avant || !/tu regardes/.test(await siege(page)))
      throw new Defaut(`le rechargement a repris la place rendue: « ${await siege(page)} »`);
    await capture(page, "place-suit-adresse");
    await page.close();
  },

  /** P11: « Inviter quelqu'un » déplie un panneau (23 novembre 2026) : le code
   * QR n'est dessiné qu'à l'ouverture, « Copier le lien » copie le lien qui
   * entre dans CETTE salle pour jouer, et la ligne parlée le dit. Le jumeau :
   * « pour regarder » copie le lien qui entre pour regarder. Sans feuille de
   * partage (un ordinateur), c'est le presse-papiers. */
  async invitation() {
    const page = await nouvelle(PC, {
      avant: () => {
        Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: async (t) => void (window.__copie = t) },
        });
      },
    });
    await entrer(page);
    if (!(await page.$("#inviter"))) throw new Defaut("aucun bouton pour inviter");
    if (await page.$(".n3-qr")) throw new Defaut("le code QR est dessiné avant l'ouverture");
    await page.click("#inviter");
    if (!(await jusqua(() => page.$("#copierLien").then(Boolean), 2000)))
      throw new Defaut("« Inviter » ne déplie aucun panneau avec « Copier le lien »");
    const deplie = await page.$eval("#inviter", (b) => b.getAttribute("aria-expanded"));
    if (deplie !== "true") throw new Defaut(`#inviter dit aria-expanded=${deplie}`);
    if (!(await jusqua(() => page.$(".n3-qr path").then(Boolean), 3000)))
      throw new Defaut("le code QR n'est pas dessiné à l'ouverture");
    await page.click("#copierLien");
    if (!(await jusqua(() => page.evaluate(() => typeof window.__copie === "string"), 3000)))
      throw new Defaut("« Copier le lien » n'a rien copié");
    const copie = await page.evaluate(() => window.__copie);
    if (copie !== `${banc.base}/r/1/?entrer=jouer`) throw new Defaut(`lien copié: ${copie}`);
    if (!(await jusqua(async () => /Lien copié/.test(await texte(page, "#ligneParlee")), 2000)))
      throw new Defaut("la copie n'est pas dite par la ligne parlée");
    // Le jumeau : regarder.
    await page.evaluate(() => (window.__copie = undefined));
    await page.click("input[type=radio][value=watch]");
    await page.click("#copierLien");
    if (!(await jusqua(() => page.evaluate(() => typeof window.__copie === "string"), 3000)))
      throw new Defaut("« Copier le lien » n'a rien copié pour regarder");
    const regarder = await page.evaluate(() => window.__copie);
    if (regarder !== `${banc.base}/r/1/?entrer=regarder`)
      throw new Defaut(`lien pour regarder copié: ${regarder}`);
    await capture(page, "invitation");
    await page.close();
  },

  /** A11Y-09 (plan personnes, places-demande 1) : les places au vrai
   * clavier. Tab mène à la place de Bo, Entrée ouvre sa carte et y pose le
   * focus, Échap la ferme et rend le focus à la place sans ouvrir le menu du
   * jeu ; la place garde le focus quand Bo part puis revient (aucun
   * démontage). Le jumeau : Échap depuis la zone de jeu laisse la carte et
   * ouvre le menu, comme avant. Écrite le 23 novembre 2026 ; la page de
   * 54d1f6f (`rouges/personnes-54d1f6f.html`), où Échap ouvrait le menu par
   * la carte, doit y tomber sur son défaut. */
  async "places-clavier"() {
    const page = await nouvelle(PC, { salle: { bo: true } });
    await entrer(page);
    if (!(await page.$("#port2"))) throw new Precondition("aucune place #port2");
    await page.mouse.click(...(await centreDe(page, "#screen")));
    let appuis = 0;
    while ((await idActif(page)) !== "port2") {
      if (++appuis > 80) throw new Precondition("80 Tab n'ont jamais atteint #port2");
      await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter");
    if (!(await jusqua(() => page.$("#cartePlace").then(Boolean), 2000)))
      throw new Precondition("Entrée sur la place de Bo n'ouvre aucune carte");
    if ((await idActif(page)) !== "cartePlaceTitre")
      throw new Defaut(`la carte ouverte au clavier n'a pas le focus (${await idActif(page)})`);
    await page.keyboard.press("Escape");
    await sleep(300);
    if (await page.$("#menu")) throw new Defaut("Échap dans la carte ouvre le menu du jeu");
    if (await page.$("#cartePlace")) throw new Defaut("Échap dans la carte ne la ferme pas");
    if ((await idActif(page)) !== "port2")
      throw new Defaut(`Échap ne rend pas le focus à la place (${await idActif(page)})`);
    // La rangée se met à jour en place : Bo part, puis revient.
    banc.regler({ bo: false });
    if (!(await jusqua(() => page.$eval("#port2", (b) => b.dataset.state === "free"), 3000)))
      throw new Precondition("la place 2 ne se libère pas quand Bo part");
    banc.regler({ bo: true });
    if (!(await jusqua(() => page.$eval("#port2", (b) => b.dataset.state === "busy"), 3000)))
      throw new Precondition("la place 2 ne se reprend pas quand Bo revient");
    if ((await idActif(page)) !== "port2")
      throw new Defaut(`la place a perdu le focus quand Bo est parti et revenu (${await idActif(page)})`);
    // Le jumeau : la carte ouverte, Échap depuis la zone de jeu ouvre le menu.
    await page.keyboard.press("Enter");
    if (!(await jusqua(() => page.$("#cartePlace").then(Boolean), 2000)))
      throw new Precondition("Entrée ne rouvre pas la carte");
    await page.focus("[data-zone-jeu]");
    await page.keyboard.press("Escape");
    if (!(await jusqua(() => page.$("#menu").then(Boolean), 2000)))
      throw new Defaut("Échap depuis la zone de jeu n'ouvre plus le menu");
    await capture(page, "places-clavier");
    await page.close();
  },

  /** Plan personnes, places-demande 4 : demander la place de Bo. La demande
   * s'écrit hors de l'image, dit la vraie règle du salon (sans réponse, tu
   * pourras prendre la place) et attend le délai avant « Prendre ». Le banc
   * répond comme `api/ws/recovery.py`. Sur 03b21c0, le panneau fixe de
   * `Recovery` se posait en haut de la page, sur l'image. */
  async "demande-place"() {
    const page = await nouvelle(PC, { salle: { bo: true } });
    await entrer(page);
    const depuis = Date.now();
    await page.click("#port2");
    // La page d'après ouvre d'abord la carte de la place ; celle d'avant
    // demandait au premier clic.
    if (await jusqua(() => page.$("#demanderPlace").then(Boolean), 1500)) await page.click("#demanderPlace");
    const demandee = () =>
      banc.journal.evenements.some(
        (e) => e.a >= depuis && e.quoi[0] === "recover" && e.quoi[1]?.action === "begin" && e.quoi[1]?.port === 2,
      );
    if (!(await jusqua(async () => demandee(), 3000))) throw new Precondition("la page n'a pas demandé la place 2");
    const boite = "#cartePlace, #recovery";
    if (!(await jusqua(() => page.evaluate((s) => document.querySelector(s)?.textContent.includes("Bo") ?? false, boite), 3000)))
      throw new Precondition("la demande en cours ne s'écrit nulle part");
    const pose = await page.evaluate((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      const t = document.querySelector("#screen").getBoundingClientRect();
      const coupe = r.left < t.right && t.left < r.right && r.top < t.bottom && t.top < r.bottom;
      const points = [
        [t.left + t.width / 2, t.top + t.height / 2],
        [t.left + 3, t.top + 3],
        [t.right - 3, t.top + 3],
        [t.left + 3, t.bottom - 3],
        [t.right - 3, t.bottom - 3],
      ];
      const caches = points.filter(([x, y]) => document.elementFromPoint(x, y)?.id !== "screen").length;
      return { coupe, caches, boite: [r.left, r.top, r.width, r.height].map(Math.round) };
    }, boite);
    if (pose.coupe) throw new Defaut(`la demande se pose sur l'image (boîte ${pose.boite.join(" ")})`);
    if (pose.caches > 0) throw new Defaut(`${pose.caches} point(s) de l'image ne rendent plus l'image`);
    const dit = await texte(page, boite);
    if (!dit.includes("Sans réponse, tu pourras prendre la place 2"))
      throw new Defaut(`la demande ne dit pas la règle du salon : « ${dit} »`);
    const attend = await page.$eval("#confirmRecovery", (b) => b.getAttribute("aria-disabled") === "true" || b.disabled);
    if (!attend) throw new Defaut("« Prendre la place 2 » est permis avant le délai");
    // Le jumeau : annuler part au salon.
    await page.click("#annulerDemande");
    if (
      !(await jusqua(
        async () => banc.journal.evenements.some((e) => e.a >= depuis && e.quoi[0] === "recover" && e.quoi[1]?.action === "cancel"),
        2000,
      ))
    )
      throw new Defaut("« Annuler » n'a rien envoyé au salon");
    await capture(page, "demande-place");
    await page.close();
  },

  /** A11Y-18 (plan personnes, places-demande 14) : Bo arrive, sa phrase est
   * écrite dans la ligne parlée, et 90 ms plus tard le salon annonce un
   * démarrage. La ligne dit « Sonic Generations démarre. » sans avoir
   * effacé l'arrivée. Sur la page de 54d1f6f, la phrase d'état la
   * remplaçait. Depuis le chargement réécrit (chantier menus, C9), la ligne
   * nomme le jeu ; les pages d'avant disaient « Le jeu démarre. ». */
  async "annonce-arrivee"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await sleep(800);
    banc.regler({ bo: true });
    if (!(await jusqua(async () => /Bo/.test(await texte(page, "#ligneParlee")), 4000)))
      throw new Precondition(`l'arrivée de Bo n'est pas dite : « ${await texte(page, "#ligneParlee")} »`);
    const arrivee = await texte(page, "#ligneParlee");
    await sleep(90);
    banc.annoncer({ game: "Sonic Generations", save: "nouvelle partie" });
    // « Sonic Generations démarre. » depuis que la ligne nomme le jeu
    // (chantier états, phrases demandées par menus) ; « Le jeu démarre. »
    // sur les pages d'avant, que la recette rouge relit.
    if (!(await jusqua(async () => /(Le jeu|Sonic Generations) démarre/.test(await texte(page, "#ligneParlee")), 3000)))
      throw new Precondition(`le démarrage n'est pas dit : « ${await texte(page, "#ligneParlee")} »`);
    const ensuite = await texte(page, "#ligneParlee");
    if (!ensuite.includes(arrivee))
      throw new Defaut(`l'arrivée (« ${arrivee} ») est effacée par l'état : « ${ensuite} »`);
    // Le jumeau : la ligne parlée est la seule région de la salle, hors de
    // `#controller-status` (ControllerStatus, chantier manettes, qui dit les
    // manettes branchées ; le réunir à la ligne est à ce chantier-là).
    // Inviter, Signaler et la reprise avaient chacun la leur.
    const regions = await page.evaluate(() =>
      [...document.querySelectorAll("[role=status], [role=alert], [aria-live]:not([aria-live=off])")]
        .filter((e) => e.id !== "controller-status")
        .map((e) => `${e.tagName.toLowerCase()}#${e.id}.${e.className}`),
    );
    if (regions.length !== 1 || !regions[0].startsWith("p#ligneParlee"))
      throw new Defaut(`${regions.length} régions parlées dans la salle : ${regions.join(", ")}`);
    await page.close();
  },

  /** Effet « lettres » (plan personnes) : l'arrivée de Bo s'écrit sur
   * l'ancre de l'annonce du socle, hors de l'image, puis s'efface. Sur la
   * page de 54d1f6f, l'ancre restait vide. */
  async "annonce-lettres"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await sleep(800);
    if (!(await page.$('[data-ancre="annonce"]'))) throw new Precondition("aucune ancre d'annonce dans la salle");
    banc.regler({ bo: true });
    if (!(await jusqua(async () => /Bo/.test(await texte(page, "#ligneParlee")), 4000)))
      throw new Precondition("l'arrivée de Bo n'est pas dite");
    const phrase = await texte(page, "#ligneParlee");
    if (!(await jusqua(async () => (await texte(page, '[data-ancre="annonce"]')) === phrase, 3000)))
      throw new Defaut(`l'ancre ne dit pas l'arrivée : « ${await texte(page, '[data-ancre="annonce"]')} »`);
    const pose = await page.evaluate(() => {
      const r = document.querySelector('[data-ancre="annonce"]').getBoundingClientRect();
      const t = document.querySelector("#screen").getBoundingClientRect();
      return { coupe: r.left < t.right && t.left < r.right && r.top < t.bottom && t.top < r.bottom, haut: r.height };
    });
    if (pose.coupe) throw new Defaut("l'annonce s'écrit sur l'image");
    if (pose.haut === 0) throw new Defaut("l'ancre écrite n'a aucune hauteur : personne ne la voit");
    await capture(page, "annonce-lettres");
    // Le jumeau : elle s'efface (ANNONCE_RESTE_MS, 6 s après la fin).
    if (!(await jusqua(async () => (await texte(page, '[data-ancre="annonce"]')) === "", 9000)))
      throw new Defaut("l'annonce reste écrite sur l'ancre");
    await page.close();
  },

  /* Les huit étapes qui suivent viennent de la relecture du chantier
     personnes du 24 novembre 2026. Chacune doit rougir sur son défaut sur
     la page de cc8c8a6 (`rouges/personnes-cc8c8a6.html`). */

  /** Celui qui TIENT la place reçoit, après sa réponse, la raison du salon :
   * `notify` l'envoie à qui demande ET aux cibles. Sur cc8c8a6, elle ouvrait
   * la carte de la place, prenait le focus à la zone de jeu et proposait
   * « Prendre la place 3 ». La raison se dit par la ligne parlée, sans
   * carte et sans focus. Le jumeau : la demande reçue s'affiche, elle aussi
   * sans prendre le focus. */
  async "carte-cible"() {
    const page = await nouvelle(PC, { salle: { bo: true } });
    await entrer(page);
    const mienne = await maPlace(page);
    if (mienne === null) throw new Precondition("aucune place n'est à moi");
    for (const [id, raison] of [
      ["banc-cible-1", `Ami garde sa place ${mienne}.`],
      ["banc-cible-2", "Demande annulée."],
    ]) {
      const avis = { id, port: mienne, from: "Bo", to: "Ami", asking: false, accepted: false };
      await page.focus("[data-zone-jeu]");
      banc.avisDeReprise({ ...avis, remaining: 20, reason: null });
      if (!(await jusqua(() => page.$("#demandeRecue").then(Boolean), 2000)))
        throw new Precondition("la demande de Bo ne s'affiche pas");
      if (!(await dansLeJeu(page)))
        throw new Defaut(`la demande reçue prend le focus à la zone de jeu (${await idActif(page)})`);
      banc.avisDeReprise({ ...avis, remaining: 0, reason: raison });
      if (!(await jusqua(async () => !(await page.$("#demandeRecue")), 2000)))
        throw new Precondition("la demande reçue reste après la raison du salon");
      await sleep(300);
      if (await page.$("#cartePlace"))
        throw new Defaut(`« ${raison} » ouvre une carte chez qui tient la place : « ${await texte(page, "#cartePlace")} »`);
      if (!(await dansLeJeu(page)))
        throw new Defaut(`« ${raison} » prend le focus à la zone de jeu (${await idActif(page)})`);
      if (!(await jusqua(async () => (await texte(page, "#ligneParlee")).includes(raison), 2000)))
        throw new Defaut(`la ligne parlée ne dit pas « ${raison} » : « ${await texte(page, "#ligneParlee")} »`);
    }
    await page.close();
  },

  /** La carte ouverte sur la place de Bo disparaît quand Bo part. Sur
   * cc8c8a6, la page gardait son numéro : au retour de Bo, la carte se
   * rouvrait seule et prenait le focus à la zone de jeu. Le jumeau : un clic
   * sur la place la rouvre. */
  async "carte-revient"() {
    const page = await nouvelle(PC, { salle: { bo: true } });
    await entrer(page);
    await page.click("#port2");
    if (!(await jusqua(() => page.$("#cartePlace").then(Boolean), 2000)))
      throw new Precondition("un clic sur 2P n'ouvre aucune carte");
    banc.regler({ bo: false });
    if (!(await jusqua(async () => !(await page.$("#cartePlace")), 3000)))
      throw new Precondition("la carte reste quand Bo part");
    await page.focus("[data-zone-jeu]");
    banc.regler({ bo: true });
    if (!(await jusqua(() => page.$eval("#port2", (b) => b.dataset.state === "busy"), 3000)))
      throw new Precondition("Bo ne revient pas à la place 2");
    await sleep(400);
    if (await page.$("#cartePlace"))
      throw new Defaut(`la carte se rouvre seule au retour de Bo : « ${await texte(page, "#cartePlace")} »`);
    if (!(await dansLeJeu(page)))
      throw new Defaut(`le retour de Bo prend le focus à la zone de jeu (${await idActif(page)})`);
    await page.click("#port2");
    if (!(await jusqua(() => page.$("#cartePlace").then(Boolean), 2000)))
      throw new Defaut("un clic sur 2P ne rouvre plus la carte");
    await page.close();
  },

  /** Bo refuse : la carte le montre, et la ligne parlée, seule région de la
   * salle, le dit. Sur cc8c8a6, aucune issue d'une reprise n'était dite :
   * le panneau `Recovery` retiré la disait par `role=alert`. */
  async "refus-dit"() {
    const page = await nouvelle(PC, { salle: { bo: true, boRepond: "garde" } });
    await entrer(page);
    await page.click("#port2");
    if (!(await jusqua(() => page.$("#demanderPlace").then(Boolean), 2000)))
      throw new Precondition("la carte de Bo n'a pas « Lui demander sa place »");
    await page.click("#demanderPlace");
    if (!(await jusqua(async () => (await texte(page, "#cartePlace")).includes("Bo garde sa place 2."), 3000)))
      throw new Precondition(`le refus ne s'écrit pas dans la carte : « ${await texte(page, "#cartePlace")} »`);
    if (!(await jusqua(async () => (await texte(page, "#ligneParlee")).includes("Bo garde sa place 2."), 2000)))
      throw new Defaut(`la ligne parlée ne dit pas le refus : « ${await texte(page, "#ligneParlee")} »`);
    await page.close();
  },

  /** Bo donne sa place : le salon renvoie un reste à 0 sans raison, avec
   * `accepted`. Sur cc8c8a6, la carte n'avait qu'une lecture d'un reste à 0
   * et affirmait « Bo n'a pas répondu ». La place se prend tout de suite, et
   * la ligne parlée le dit. */
  async "don-dit"() {
    const page = await nouvelle(PC, { salle: { bo: true, boRepond: "donne" } });
    await entrer(page);
    await page.click("#port2");
    if (!(await jusqua(() => page.$("#demanderPlace").then(Boolean), 2000)))
      throw new Precondition("la carte de Bo n'a pas « Lui demander sa place »");
    await page.click("#demanderPlace");
    if (!(await jusqua(() => page.$("#confirmRecovery").then(Boolean), 3000)))
      throw new Precondition("la demande en cours ne s'affiche pas");
    if (
      !(await jusqua(async () => !(await texte(page, "#cartePlaceTitre")).startsWith("Ta demande est chez"), 3000))
    )
      throw new Precondition("le don de Bo ne change rien à la carte");
    const titre = await texte(page, "#cartePlaceTitre");
    if (/n'a pas répondu/.test(titre)) throw new Defaut(`une place donnée se dit un silence : « ${titre} »`);
    if (titre !== "Bo te laisse sa place 2.") throw new Defaut(`la carte dit « ${titre} »`);
    const attend = await page.$eval("#confirmRecovery", (b) => b.getAttribute("aria-disabled") === "true");
    if (attend) throw new Defaut("« Prendre la place 2 » attend encore après le don");
    if (!(await jusqua(async () => (await texte(page, "#ligneParlee")).includes(titre), 2000)))
      throw new Defaut(`la ligne parlée ne dit pas le don : « ${await texte(page, "#ligneParlee")} »`);
    await page.close();
  },

  /** Sami entre : le salon le dit sans place, sa place à confirmer
   * (`seat_pending`). Il arrive, il ne regarde pas. Sur cc8c8a6, la ligne
   * parlée disait « Sami regarde la partie. » pendant que la colonne disait
   * qu'il arrivait. Le jumeau : placé par le salon sans place, il regarde,
   * et la ligne le dit. */
  async "arrivee-a-confirmer"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await sleep(800);
    const sami = { name: "Sami", id: "s", moi: false, seat: null };
    banc.regler({ autres: [{ ...sami, seat_pending: true }] });
    if (!(await jusqua(async () => (await texte(page, "[aria-labelledby=ilsRegardent]")).includes("Sami arrive"), 3000)))
      throw new Precondition("la colonne ne dit pas que Sami arrive");
    await sleep(700);
    const dit = await texte(page, "#ligneParlee");
    if (/Sami regarde/.test(dit)) throw new Defaut(`qui arrive est annoncé spectateur : « ${dit} »`);
    banc.regler({ autres: [{ ...sami, seat_pending: false }] });
    if (!(await jusqua(async () => /Sami regarde la partie/.test(await texte(page, "#ligneParlee")), 3000)))
      throw new Defaut(`un vrai spectateur n'est pas annoncé : « ${await texte(page, "#ligneParlee")} »`);
    await page.close();
  },

  /** L'annonce écrite sur l'ancre du socle se lit sur le fond de son hôte,
   * de jour comme de nuit. Sur cc8c8a6, le fronton (fond de l'écran, noir)
   * l'écrivait au signal du jour : 3,28:1 en 17 px. L'encre et le fond sont
   * lus dans le rendu, le fond sur le premier ancêtre opaque. */
  async "annonce-fronton"() {
    // Le jumeau du calcul : le signal du jour sur le noir, mesuré à 3,28:1.
    if (contraste([59, 79, 214], [0, 0, 0]) >= 4.5) throw new Error("le calcul du contraste est faux");
    for (const [schema, niveau, fronton] of [
      ["light", "conseille", true],
      ["dark", "conseille", true],
      ["light", "sobre", false],
    ]) {
      const page = await nouvelle(
        { width: 1280, height: 1024 },
        { stockage: { "nel3ab:effets": JSON.stringify({ niveau, sons: false }) } },
      );
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: schema }]);
      await entrer(page);
      await sleep(800);
      banc.regler({ bo: true });
      const ancre = '[data-ancre="annonce"]';
      if (!(await jusqua(async () => (await texte(page, ancre)).length > 3, 4000)))
        throw new Precondition(`${schema} ${niveau} : l'ancre n'écrit pas l'arrivée de Bo`);
      const lu = await page.evaluate((sel) => {
        const nombres = (t) => (t.match(/[\d.]+/g) ?? []).map(Number);
        const a = document.querySelector(sel);
        let fond = null;
        let hote = "";
        for (let e = a; e && fond === null; e = e.parentElement) {
          const v = nombres(getComputedStyle(e).backgroundColor);
          if (v.length === 3 || (v.length === 4 && v[3] === 1)) {
            fond = v.slice(0, 3);
            hote = e.id || String(e.className);
          }
        }
        return {
          encre: nombres(getComputedStyle(a).color).slice(0, 3),
          fond,
          hote,
          fronton: a.closest("#fronton") !== null,
        };
      }, ancre);
      if (lu.fond === null) throw new Precondition(`${schema} ${niveau} : aucun fond opaque sous l'ancre`);
      if (fronton && !lu.fronton)
        throw new Precondition(`${schema} ${niveau} : l'ancre n'est pas sur le fronton (${lu.hote})`);
      const c = contraste(lu.encre, lu.fond);
      if (c < 4.5)
        throw new Defaut(
          `${schema} ${niveau} : l'annonce sur ${lu.hote} tient ${c.toFixed(2)}:1 (encre ${lu.encre}, fond ${lu.fond})`,
        );
      await page.close();
    }
  },

  /** Le contrat d'Aïn : `start-1` à `start-4` sur le rond START de chaque
   * place, une fois, visibles et hors de l'image. Sur cc8c8a6, aucune ancre
   * n'existait, et l'arrivée et le départ ne pouvaient atteindre la place du
   * joueur. Depuis le 24 novembre 2026 (fin-ain), l'ancre est le rond et non
   * le bouton entier : posée sur le bouton, elle mettait Aïn et l'étiquette
   * de « depart » sur le nom écrit au ras du haut de la place. */
  async "ancres-start"() {
    const page = await nouvelle(PC, { salle: { bo: true } });
    await entrer(page);
    const lu = await page.evaluate(() => {
      const t = document.querySelector("#screen").getBoundingClientRect();
      return {
        toutes: document.querySelectorAll('[data-ancre^="start-"]').length,
        places: [1, 2, 3, 4].map((n) => {
          const a = document.querySelectorAll(`[data-ancre="start-${n}"]`);
          const r = a[0]?.getBoundingClientRect();
          return {
            n,
            combien: a.length,
            surLaPlace: a[0] !== undefined && a[0] === document.querySelector(`#port${n} .rt-bouton-start`),
            visible: r !== undefined && r.width > 0 && r.height > 0,
            surLImage: r !== undefined && r.left < t.right && t.left < r.right && r.top < t.bottom && t.top < r.bottom,
          };
        }),
      };
    });
    for (const p of lu.places) {
      if (p.combien !== 1) throw new Defaut(`${p.combien} ancre(s) start-${p.n}`);
      if (!p.surLaPlace) throw new Defaut(`start-${p.n} n'est pas sur le rond START de #port${p.n}`);
      if (!p.visible) throw new Defaut(`start-${p.n} n'a aucune boîte`);
      if (p.surLImage) throw new Defaut(`start-${p.n} est sur l'image`);
    }
    if (lu.toutes !== 4) throw new Defaut(`${lu.toutes} ancres start- dans la salle`);
    await page.close();
  },

  /** Le jumeau d'`ancres-start` (relecture finale du 25 novembre 2026) :
   * tenu en main à 667x375, la manette à l'écran laisse 114 px au panneau,
   * et `#placesToutes` remplace la rangée. Les places cachées ne portent
   * aucune ancre `start-N`, ni les lampes : une seule ancre par place
   * VISIBLE. Seul le faux ResizeObserver de Places.test.tsx tenait cette
   * règle, et il rappelait même un observateur qui n'observait rien. */
  async "ancres-start-cachees"() {
    const page = await nouvelle({ width: 667, height: 375, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, { salle: { bo: true } });
    await page.goto(banc.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#enter, #screen", { timeout: 15000 });
    if (await page.$("#enter")) await page.click("#enter");
    await page.waitForSelector("#screen", { timeout: 15000 });
    // La rangée cachée, le bouton de toutes les places montré.
    const bascule = await jusqua(
      () =>
        page.evaluate(() => {
          const toutes = document.querySelector("#placesToutes");
          const rangee = document.querySelector("#ports");
          return toutes !== null && toutes.getClientRects().length > 0 && rangee !== null && rangee.getClientRects().length === 0;
        }),
      8000,
    );
    if (!bascule) throw new Precondition("à 667x375, #placesToutes ne remplace pas la rangée des places");
    await sleep(300);
    const lu = await page.evaluate(() =>
      [...document.querySelectorAll('[data-ancre^="start-"]')].map((a) => ({
        ancre: a.dataset.ancre,
        boite: a.getClientRects().length > 0,
        dans: a.closest("[id]")?.id ?? null,
      })),
    );
    console.log(JSON.stringify({ ancres: lu }));
    if (lu.length) throw new Defaut(`${lu.length} ancre(s) start- sur une rangée cachée : ${lu.map((a) => `${a.ancre} dans #${a.dans}${a.boite ? "" : " sans boîte"}`).join(", ")}`);
    await page.close();
  },

  /** L'image s'arrête : les mesures comptent zéro image peinte, puis la
   * cadence revient avec les images. Sur cc8c8a6, la cadence ne se
   * recalculait qu'au changement du compteur, et le panneau gardait la
   * dernière, « 60 images peintes par seconde », sur une image figée. */
  async "mesures-figee"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await page.click("#mesures");
    if (!(await jusqua(() => page.$("#panneauMesures").then(Boolean), 2000)))
      throw new Precondition("la ligne du coin ne déplie pas les mesures");
    const lire = () => texte(page, "#panneauMesures .n3-mesures dd");
    if (!(await jusqua(async () => /^[1-9]\d* images? peintes? par seconde/.test(await lire()), 5000)))
      throw new Precondition(`aucune cadence lue avant le gel : « ${await lire()} »`);
    banc.regler({ fige: true });
    if (!(await jusqua(async () => /^0 images? peintes? par seconde/.test(await lire()), 5000)))
      throw new Defaut(`une image figée garde une cadence : « ${await lire()} »`);
    banc.regler({ fige: false });
    if (!(await jusqua(async () => /^[1-9]\d* images? peintes? par seconde/.test(await lire()), 8000)))
      throw new Defaut(`la cadence ne revient pas avec les images : « ${await lire()} »`);
    await page.close();
  },

  /** P7 (plan personnes, signaler 0) : « Signaler un problème » se voit sans
   * défiler dans la colonne, à trois tailles de bureau. Sur 03b21c0, à
   * 1280 × 720, il était sous le pli. */
  async "signaler-visible"() {
    for (const vue of [
      { width: 1440, height: 900 },
      { width: 1366, height: 768 },
      { width: 1280, height: 720 },
    ]) {
      const page = await nouvelle(vue);
      await entrer(page);
      if (!(await page.$("#complain"))) throw new Precondition(`aucun #complain à ${vue.width} × ${vue.height}`);
      const vu = await page.evaluate(() => {
        const b = document.querySelector("#complain");
        const r = b.getBoundingClientRect();
        let haut = 0;
        let bas = innerHeight;
        for (let p = b.parentElement; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (/(auto|scroll|hidden)/.test(s.overflowY)) {
            const q = p.getBoundingClientRect();
            haut = Math.max(haut, q.top);
            bas = Math.min(bas, q.bottom);
          }
        }
        const centre = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { haut: r.top, bas: r.bottom, visibleDe: haut, visibleA: bas, touche: b.contains(centre) };
      });
      if (vu.haut < vu.visibleDe || vu.bas > vu.visibleA + 0.5 || !vu.touche)
        throw new Defaut(
          `à ${vue.width} × ${vue.height}, #complain va de ${Math.round(vu.haut)} à ${Math.round(vu.bas)} px, ` +
            `la colonne montre ${Math.round(vu.visibleDe)} à ${Math.round(vu.visibleA)} px` +
            (vu.touche ? "" : ", et son centre ne le touche pas"),
        );
      await capture(page, "signaler-visible");
      await page.close();
    }
  },

  /** P8: une seule sortie, « Quitter la salle », vers les autres salles. */
  async quitter() {
    const page = await nouvelle(PC);
    await entrer(page);
    const bouton = await page.$("#leaveRoom");
    if (!bouton) throw new Precondition("pas de bouton de sortie dans la colonne");
    const libelle = await page.evaluate(() => document.querySelector("#leaveRoom").textContent.trim());
    if (libelle !== "Quitter la salle") throw new Defaut(`la sortie s'appelle « ${libelle} »`);
    await Promise.all([page.waitForNavigation({ timeout: 5000 }).catch(() => null), page.click("#leaveRoom")]);
    if (!(await jusqua(async () => (await adresse(page)) === "/", 3000)))
      throw new Defaut(`« Quitter la salle » mène à ${await adresse(page)}`);
    if (!(await page.$("#accueil-du-banc"))) throw new Defaut("la sortie n'arrive pas sur la liste des salles");
    await page.close();
  },

  /** P14: le chef ferme la salle depuis le menu; le jumeau: un autre n'a pas
   * l'entrée. */
  async "fermer-salle"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await menu(page, "salle");
    if (!(await page.$("#item-close-room"))) throw new Defaut("le chef n'a pas « fermer la salle »");
    await page.click("#item-close-room");
    // Depuis le menu unique (24 novembre 2026), la confirmation est la fiche
    // de la ligne, dans le menu : sa conséquence et « Fermer la salle ».
    if (!(await jusqua(() => page.$("#fiche #ficheAgir").then(Boolean), 2000)))
      throw new Defaut("« fermer la salle » ne demande pas de confirmer");
    if (banc.journal.suppressions.length !== 0) throw new Defaut("un clic sur la ligne seule a fermé la salle");
    await capture(page, "fermer-salle");
    await Promise.all([page.waitForNavigation({ timeout: 5000 }).catch(() => null), page.click("#ficheAgir")]);
    if (!(await jusqua(async () => banc.journal.suppressions.length === 1, 3000)))
      throw new Defaut("aucune demande de fermeture n'est partie");
    if (!(await jusqua(async () => (await adresse(page)) === "/", 3000)))
      throw new Defaut(`après la fermeture, la page est sur ${await adresse(page)}`);
    await page.close();
    const autre = await nouvelle(PC, { salle: { chef: "bo", bo: true, decide: false } });
    await entrer(autre);
    await menu(autre, "salle");
    if (await autre.$("#item-close-room")) throw new Defaut("« fermer la salle » proposé à qui n'est pas chef");
    await autre.close();
  },

  /** B1 et B12 (chantier menus) : une salle sans jeu montre ses jeux sur
   * l'écran éteint, une cartouche par jeu, sans ouvrir le menu, et le focus
   * d'entrée est sur la première cartouche. Le jumeau : un jeu en cours n'a
   * pas de rayonnage, et la rubrique Jeux du menu liste les mêmes jeux. */
  async rayonnage() {
    const page = await nouvelle(PC, { salle: { jeu: null } });
    await entrer(page);
    // Les pages d'avant le rayonnage n'ont pas toutes l'écran éteint : son
    // absence est le défaut cherché, pas une précondition.
    await jusqua(() => page.$("#rayonnage [data-jeu]").then(Boolean), 5000);
    await sleep(800);
    const vu = await page.evaluate(() => {
      const premiere = document.querySelector("#rayonnage [data-jeu]");
      const r = premiere?.getBoundingClientRect();
      const ici = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      return {
        rayonnage: document.querySelector("#rayonnage") !== null,
        menu: document.querySelector("#menu") !== null,
        jeux: document.querySelectorAll("#rayonnage [data-jeu]").length,
        focus: document.activeElement === premiere && premiere !== null,
        touche: premiere !== null && ici !== null && premiere.contains(ici),
      };
    });
    if (!vu.rayonnage) throw new Defaut("la salle sans jeu ne montre pas ses jeux (#rayonnage absent)");
    if (vu.menu) throw new Defaut("la salle sans jeu ouvre le menu d'office");
    if (vu.jeux !== BIBLIOTHEQUE.length)
      throw new Defaut(`${vu.jeux} cartouches pour ${BIBLIOTHEQUE.length} jeux`);
    if (!vu.focus) throw new Defaut(`le focus d'entrée est sur « ${await idActif(page)} », pas sur la première cartouche`);
    if (!vu.touche) throw new Defaut("le centre de la première cartouche ne la touche pas (elementFromPoint)");
    await capture(page, "rayonnage");
    await page.close();
    const partie = await nouvelle(PC);
    await entrer(partie);
    await sleep(800);
    if (await partie.$("#rayonnage")) throw new Defaut("un jeu en cours garde le rayonnage");
    await menu(partie, "jeux");
    const lignes = await partie.$$eval('[id^="item-game"]', (l) => l.length);
    if (lignes !== BIBLIOTHEQUE.length)
      throw new Defaut(`la rubrique Jeux liste ${lignes} jeux pour ${BIBLIOTHEQUE.length}`);
    await partie.close();
  },

  /** B1 (chantier menus) : au bureau, la fiche d'un jeu s'ouvre À CÔTÉ des
   * rangées, qui restent visibles et se parcourent ; une autre cartouche
   * remplace la fiche. Le jumeau : au téléphone, la fiche prend la place
   * des rangées. Rouge sur la page d'avant, où la fiche les cachait partout. */
  async "fiche-a-cote"() {
    const page = await nouvelle(PC, { salle: { jeu: null } });
    await entrer(page);
    if (!(await jusqua(() => page.$("#rayonnage [data-jeu]").then(Boolean), 5000)))
      throw new Precondition("la salle sans jeu ne montre pas ses jeux (#rayonnage absent)");
    await page.click('#rayonnage [data-jeu="0"]');
    if (!(await jusqua(() => page.$("#ficheJeu").then(Boolean), 3000)))
      throw new Precondition("la cartouche n'ouvre pas la fiche du jeu");
    await sleep(300);
    const mesure = () =>
      page.evaluate(() => {
        const boite = (n) => {
          const r = n?.getBoundingClientRect();
          return r && r.width > 0 && r.height > 0
            ? { gauche: r.left, droite: r.right, haut: r.top, bas: r.bottom }
            : null;
        };
        const visible = (n) => {
          const r = n?.getBoundingClientRect();
          if (!r || r.width === 0) return false;
          const ici = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 20));
          return ici !== null && n.contains(ici);
        };
        const autre = document.querySelector('#rayonnage [data-jeu]:not([data-jeu="0"])');
        return {
          rangees: boite(document.querySelector(".n3-rayonnage-rangees")),
          fiche: boite(document.querySelector("#ficheJeu")),
          cartoucheVue: visible(document.querySelector('#rayonnage [data-jeu="0"]')),
          ficheVue: visible(document.querySelector("#ficheJeuTitre")),
          autre: autre?.getAttribute("data-jeu") ?? null,
          titre: document.querySelector("#ficheJeuTitre")?.textContent ?? "",
        };
      });
    const vu = await mesure();
    if (!vu.rangees || !vu.cartoucheVue)
      throw new Defaut("au bureau, la fiche ouverte cache les rangées");
    if (!vu.fiche || !vu.ficheVue) throw new Defaut("la fiche ouverte n'est pas visible");
    if (vu.fiche.gauche < vu.rangees.droite - 1)
      throw new Defaut(
        `la fiche (${Math.round(vu.fiche.gauche)} px) n'est pas à côté des rangées (bord droit ${Math.round(vu.rangees.droite)} px)`,
      );
    // La cartouche dont la fiche est ouverte sort de 4 px de sa rangée, et
    // les autres restent (« boîte tirée », relecture du 24 novembre 2026 :
    // l'effet n'était pas branché). Lu contre sa place dans la rangée (son
    // <li>), que la translation ne déplace pas.
    const tirees = await page.evaluate(() =>
      [...document.querySelectorAll("#rayonnage [data-jeu]")].map((b) => ({
        jeu: b.getAttribute("data-jeu"),
        sortie: Math.round(b.parentElement.getBoundingClientRect().top - b.getBoundingClientRect().top),
      })),
    );
    const ouverte = tirees.find((t) => t.jeu === "0");
    if (ouverte?.sortie !== 4)
      throw new Defaut(`la cartouche ouverte ne sort pas de 4 px de sa rangée (${ouverte?.sortie} px)`);
    const bougees = tirees.filter((t) => t.jeu !== "0" && t.sortie !== 0);
    if (bougees.length) throw new Defaut(`des cartouches fermées sortent de leur rangée : ${JSON.stringify(bougees)}`);
    // Les rangées se parcourent fiche ouverte, et une autre cartouche la remplace.
    await page.focus('#rayonnage [data-jeu="0"]');
    await page.keyboard.press("ArrowRight");
    const apres = await page.evaluate(() => document.activeElement?.getAttribute("data-jeu") ?? null);
    if (apres === null || apres === "0")
      throw new Defaut("fiche ouverte, → ne passe pas à la cartouche suivante");
    if (!vu.autre) throw new Precondition("le banc n'a qu'un jeu");
    await page.click(`#rayonnage [data-jeu="${vu.autre}"]`);
    await sleep(300);
    const remplace = await mesure();
    if (remplace.titre === vu.titre)
      throw new Defaut("une autre cartouche ne remplace pas la fiche ouverte");
    await capture(page, "fiche-a-cote");
    await page.close();
    // Le jumeau : au téléphone, la fiche prend la place des rangées.
    const tel = await nouvelle(TELEPHONE, { salle: { jeu: null } });
    await entrer(tel);
    if (await tel.$("#fermerFeuille")) await tel.click("#fermerFeuille");
    if (!(await jusqua(() => tel.$("#rayonnage [data-jeu]").then(Boolean), 5000)))
      throw new Precondition("au téléphone, la salle sans jeu ne montre pas ses jeux");
    await tel.$eval('#rayonnage [data-jeu="0"]', (b) => b.click());
    if (!(await jusqua(() => tel.$("#ficheJeu").then(Boolean), 3000)))
      throw new Precondition("au téléphone, la cartouche n'ouvre pas la fiche");
    const cachees = await tel.$eval(".n3-rayonnage-rangees", (n) => n.getBoundingClientRect().height === 0);
    if (!cachees) throw new Defaut("au téléphone, les rangées restent sous la fiche");
    await tel.close();
  },

  /** P2 et M4 (chantier menus) : à 1280x720, chaque arrêt de Tab du bloc de
   * préparation et chaque ligne du menu (↓) reste visible, hors des barres
   * collées (la rangée de gestes, « Plus bas », le coin d'Aïn), et la rangée
   * ne descend jamais sous le coin. Trois gardes, chacune avec son jumeau
   * qui doit cacher un arrêt : la rangée collée au-dessus du coin, la marge
   * de défilement d'un choix du bloc, la radio du menu posée dans sa
   * pastille. Écrite ici plutôt que dans focus.mjs : seul ce banc tient une
   * préparation. Rouge sur 1ee8b49. */
  async "garde-focus"() {
    const VUE = { width: 1280, height: 720 };
    /** Les arrêts dans `bloc`, chacun mesuré contre les barres collées. Un
     * arrêt est caché s'il sort de la colonne ou croise une barre collée qui
     * ne le contient pas. Un calque de scène d'Aïn ne compte pas : il passe,
     * une barre reste. */
    const course = async (page, bloc, premier, touche = "Tab") => {
      await page.$eval(premier, (n) => n.focus());
      const arrets = [];
      for (let i = 0; i < 40; i++) {
        await sleep(80);
        const vu = await page.evaluate((b) => {
          const ici = document.activeElement;
          if (!ici || !ici.closest(b)) return null;
          const cible = ici.closest("label") ?? ici;
          const r = cible.getBoundingClientRect();
          const cadre = document.querySelector("#side").getBoundingClientRect();
          const barres = [...document.querySelectorAll(".n3-colonne-pied, .n3-plus-bas, .n3-prep-actions, .n3-menu-fiche-barre")]
            .filter((barre) => !barre.contains(cible))
            .map((barre) => ({ nom: barre.className.split(" ").find((c) => c.startsWith("n3-")), r: barre.getBoundingClientRect() }))
            .filter(({ r: br }) => br.height > 0);
          const croise = barres.find(({ r: br }) => r.bottom > br.top + 1 && r.top < br.bottom - 1 && r.right > br.left && r.left < br.right);
          const dedans = r.top >= cadre.top - 1 && r.bottom <= cadre.bottom + 1;
          return {
            id: ici.id || ici.textContent.trim().slice(0, 24),
            vu: dedans && !croise,
            dessus: croise ? croise.nom : dedans ? null : "hors de la colonne",
            haut: Math.round(r.top),
            bas: Math.round(r.bottom),
          };
        }, bloc);
        if (vu === null) break;
        if (arrets.length > 0 && arrets.at(-1).id === vu.id) break;
        arrets.push(vu);
        await page.keyboard.press(touche);
      }
      return arrets;
    };
    /** Les trois gardes, chacune rendue seule par son jumeau. */
    const JUMEAUX = {
      rangee: { partie: "prep", css: ".n3-prep-actions { bottom: 0 !important; }" },
      marge: { partie: "prep", css: "#preparation * { scroll-margin: 0 !important; }" },
      radios: { partie: "menu", css: ".n3-menu-pastille { position: static !important; }" },
    };
    const mesurer = async (jumeau) => {
      const page = await nouvelle(VUE, { salle: { bo: true, preparation: preparation(0, [0, 1], false) } });
      await entrer(page);
      if (!(await jusqua(() => page.$("#preparation").then(Boolean), 8000)))
        throw new Precondition("la préparation ne se montre pas");
      if (jumeau) await page.addStyleTag({ content: JUMEAUX[jumeau].css });
      // La rangée de gestes elle-même, colonne au plus haut puis au plus bas :
      // elle colle au bas de ce qui se voit, jamais sous le coin d'Aïn.
      const gestes = [];
      for (const ou of [0, 1e6]) {
        gestes.push(
          await page.evaluate((y) => {
            document.querySelector("#side").scrollTop = y;
            const g = document.querySelector(".n3-prep-actions")?.getBoundingClientRect();
            const coin = document.querySelector(".n3-colonne-pied")?.getBoundingClientRect();
            return { croise: Boolean(g && coin && g.bottom > coin.top + 1), bas: g?.bottom ?? null, coin: coin?.top ?? null };
          }, ou),
        );
      }
      await page.evaluate(() => (document.querySelector("#side").scrollTop = 0));
      const deborde = await page.$eval("#side", (c) => c.scrollHeight > c.clientHeight + 40);
      const prep = await course(page, "#preparation", "#preparation input:not(:disabled), #preparation button:not(:disabled)");
      // Dans le menu, Tab passe d'un groupe à l'autre et ↓ de ligne en ligne
      // (le focus itinérant, M4) : la course suit ↓ dans la plus longue rubrique.
      await menu(page, "reglages");
      const menuArrets = await course(page, "#menu", '#menu [id^="item-"]', "ArrowDown");
      if (!jumeau) await capture(page, "garde-focus");
      await page.close();
      return { deborde, gestes, prep, menu: menuArrets };
    };
    const vu = await mesurer(null);
    if (process.env.GARDE_MESURE) console.error(JSON.stringify({ vu }, null, 1));
    if (!vu.deborde) throw new Precondition(`à ${VUE.width}x${VUE.height}, la colonne ne déborde pas`);
    if (vu.prep.length < 3) throw new Precondition(`le bloc n'a que ${vu.prep.length} arrêt(s)`);
    const caches = (m) => [...m.prep, ...m.menu].filter((a) => !a.vu);
    // Chaque garde a son jumeau, qui doit cacher un arrêt : deux gardes dont
    // l'une suffirait se cacheraient l'une l'autre.
    for (const [nom, { partie }] of Object.entries(JUMEAUX)) {
      const casse = await mesurer(nom);
      if (process.env.GARDE_MESURE) console.error(JSON.stringify({ [nom]: casse }, null, 1));
      if (casse[partie].every((a) => a.vu) && !(partie === "prep" && casse.gestes.some((g) => g.croise)))
        throw new Precondition(
          `à ${VUE.width}x${VUE.height}, sans la garde « ${nom} », aucun arrêt de ${partie} n'est caché : elle n'est pas prouvée ici`,
        );
    }
    const sous = vu.gestes.find((g) => g.croise);
    if (sous) throw new Defaut(`la rangée de gestes descend sous le coin d'Aïn (bas ${Math.round(sous.bas)} px, coin ${Math.round(sous.coin)} px)`);
    const perdus = caches(vu);
    if (perdus.length > 0)
      throw new Defaut(
        `${perdus.length} arrêt(s) caché(s) : ${perdus.map((a) => `${a.id} sous ${a.dessus}`).join(", ")}`,
      );
  },

  /** B4 : seul dans la salle, la cartouche puis « Lancer », sauvegarde déjà
   * cochée : un seul « begin » part au salon, avec direct. Le jumeau : la
   * cartouche seule n'envoie rien. */
  async "lancer-seul"() {
    const page = await nouvelle(PC, { salle: { jeu: null } });
    await entrer(page);
    if (!(await jusqua(() => page.$("#rayonnage [data-jeu]").then(Boolean), 5000)))
      throw new Defaut("la salle sans jeu ne montre pas ses jeux (#rayonnage absent)");
    const avant = banc.journal.evenements.length;
    await page.click('#rayonnage [data-jeu="0"]');
    if (!(await jusqua(() => page.$("#ficheJeu").then(Boolean), 3000)))
      throw new Defaut("la cartouche n'ouvre pas la fiche du jeu");
    await sleep(500);
    const partis = () =>
      banc.journal.evenements.slice(avant).filter((e) => Array.isArray(e.quoi) && e.quoi[0] === "preparation");
    if (partis().length !== 0) throw new Defaut("ouvrir la fiche a déjà envoyé une préparation");
    const fiche = await texte(page, "#ficheJeu");
    if (!fiche.includes("Le jeu part tout de suite."))
      throw new Defaut(`seul, la fiche ne dit pas que le jeu part tout de suite: « ${fiche.slice(0, 120)} »`);
    if (!(await jusqua(() => page.$eval("#ficheJeuAgir", (b) => !b.disabled).catch(() => false), 5000)))
      throw new Defaut("« Lancer » reste grisé : les sauvegardes ne sont pas lues au repos");
    await page.click("#rayonnage [data-lancer] #ficheJeuAgir");
    if (!(await jusqua(() => partis().length > 0, 3000))) throw new Defaut("« Lancer » n'envoie rien au salon");
    await sleep(300);
    const envois = partis().map((e) => e.quoi[1]);
    if (envois.length !== 1) throw new Defaut(`${envois.length} préparations envoyées pour un « Lancer »`);
    const [begin] = envois;
    if (begin?.action !== "begin" || begin.direct !== true || begin.game !== 0)
      throw new Defaut(`la préparation envoyée: ${JSON.stringify(begin)}`);
    await capture(page, "lancer-seul");
    await page.close();
  },

  /** B11 : Entrée ouvre la fiche, le focus sur la sauvegarde cochée ; Échap
   * la ferme, rend le focus à la même cartouche et n'ouvre pas le menu. Le
   * jumeau : Échap sans fiche ouverte ouvre le menu. */
  async "bibliotheque-clavier"() {
    const page = await nouvelle(PC, { salle: { jeu: null } });
    await entrer(page);
    if (!(await jusqua(() => page.$("#rayonnage [data-jeu]").then(Boolean), 5000)))
      throw new Defaut("la salle sans jeu ne montre pas ses jeux (#rayonnage absent)");
    await page.focus('#rayonnage [data-jeu="0"]');
    await page.keyboard.press("ArrowDown");
    const apresFleche = await page.evaluate(() => document.activeElement?.getAttribute("data-jeu"));
    if (apresFleche !== "2") throw new Defaut(`↓ depuis la GameCube mène à « ${apresFleche} », pas au jeu Wii`);
    await page.keyboard.press("Enter");
    if (!(await jusqua(() => page.$("#ficheJeu").then(Boolean), 3000)))
      throw new Defaut("Entrée sur une cartouche n'ouvre pas la fiche");
    // Depuis le 24 novembre 2026 au soir, chaque fiche relit les sauvegardes :
    // le focus attend sur son titre, puis passe au choix coché à la réponse.
    await jusqua(
      () => page.evaluate(() => document.activeElement instanceof HTMLInputElement && document.activeElement.checked),
      2000,
    );
    const ouvert = await page.evaluate(() => ({
      etendu: document.querySelector('[data-jeu="2"]')?.getAttribute("aria-expanded"),
      coche: document.activeElement instanceof HTMLInputElement && document.activeElement.checked,
      agir: document.activeElement?.id,
    }));
    if (ouvert.etendu !== "true") throw new Defaut("la cartouche ouverte ne dit pas aria-expanded=true");
    // Un jeu Wii a ses sauvegardes : le focus va sur celle qui est cochée.
    if (!ouvert.coche) throw new Defaut(`le focus de la fiche est sur « ${ouvert.agir} », pas sur la sauvegarde cochée`);
    await page.keyboard.press("Escape");
    await sleep(400);
    const ferme = await page.evaluate(() => ({
      fiche: document.querySelector("#ficheJeu") !== null,
      menu: document.querySelector("#menu") !== null,
      focus: document.activeElement?.getAttribute("data-jeu"),
    }));
    if (ferme.fiche) throw new Defaut("Échap ne ferme pas la fiche");
    if (ferme.menu) throw new Defaut("Échap sur la fiche ouvre aussi le menu");
    if (ferme.focus !== "2") throw new Defaut(`après Échap, le focus est sur « ${ferme.focus} », pas sur la cartouche`);
    await page.keyboard.press("Escape");
    if (!(await jusqua(() => page.$("#menu").then(Boolean), 3000)))
      throw new Defaut("Échap sans fiche ouverte n'ouvre plus le menu");
    await page.close();
  },

  /** T12: un seul verbe pour le chef, et la reprise du rôle seulement quand le
   * chef ne joue plus. */
  async "menu-chef"() {
    const page = await nouvelle(PC, { salle: { chef: "bo", bo: true, decide: false } });
    await entrer(page);
    if (await page.$("#recoverOwner"))
      throw new Defaut("« Prendre le rôle de chef » proposé alors que le chef joue");
    await menu(page, "jeux");
    // Un AUTRE jeu que celui qui tourne: celui-là se relance, il n'est pas
    // grisé. Plus de dossier par console depuis le menu unique : les jeux sont
    // rangés sous le nom de leur console. Les pages d'avant des contrôles
    // rouges ont encore le dossier Wii : on l'ouvre s'il existe.
    await page.evaluate(() => document.querySelector("#item-shelf-wii")?.click());
    if (!(await jusqua(() => page.$("#item-game2").then(Boolean), 3000)))
      throw new Precondition("la rubrique Jeux ne montre pas le jeu Wii");
    await page.evaluate(() => document.querySelector("#item-game2")?.click());
    await sleep(500);
    const aide = await page.evaluate(() => document.querySelector("#item-game2")?.innerText ?? "");
    if (/décide/.test(aide) || !/Bo choisit le jeu\./.test(aide))
      throw new Defaut(`l'aide d'un jeu grisé dit « ${aide.replace(/\s+/g, " ")} »`);
    await capture(page, "menu-chef");
    await page.close();
    // Le jumeau: le chef est là mais ne joue plus, le worker laisse choisir.
    const parti = await nouvelle(PC, { salle: { chef: "bo", bo: true, decide: true } });
    await entrer(parti);
    if (!(await jusqua(() => parti.$("#recoverOwner").then(Boolean), 3000)))
      throw new Defaut("le chef ne joue plus et personne ne peut reprendre son rôle");
    await parti.close();
  },

  /** M10 et K25 (chantier menus, 24 novembre 2026) : au bureau, le menu prend
   * la place des rangs de la colonne. Sa rubrique Salle dit « [Bo] choisit le
   * jeu. » avec l'étiquette de Bo à sa place, et porte Signaler en ligne : un
   * seul Signaler à l'écran. Le jumeau : menu fermé, Signaler est dans la
   * colonne et plus dans le menu. */
  async "menu-salle"() {
    const page = await nouvelle(PC, { salle: { chef: "bo", bo: true, decide: false } });
    await entrer(page);
    const signaler = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("button")]
          .filter((b) => /Signaler/.test(b.textContent ?? "") && b.getClientRects().length > 0)
          .map((b) => b.id),
      );
    const avant = await signaler();
    if (avant.length !== 1 || avant[0] !== "complain")
      throw new Precondition(`menu fermé, les Signaler visibles sont ${JSON.stringify(avant)}`);
    await menu(page, "salle");
    const tete = await page.evaluate(() => {
      const p = document.querySelector("#menuPanneau #menuQuiChoisit");
      return {
        texte: p?.textContent ?? null,
        place: p?.querySelector(".n3-etiquette")?.getAttribute("data-place") ?? null,
      };
    });
    if (tete.texte === null || !/Bo.*choisit le jeu\./.test(tete.texte))
      throw new Defaut(`la rubrique Salle ne dit pas qui choisit le jeu : « ${tete.texte} »`);
    if (tete.place !== "2") throw new Defaut(`l'étiquette de Bo n'est pas à sa place 2 : ${tete.place}`);
    const ouverts = await signaler();
    await capture(page, "menu-salle");
    if (ouverts.length !== 1 || ouverts[0] !== "signalerMenu")
      throw new Defaut(`menu ouvert, les Signaler visibles sont ${JSON.stringify(ouverts)}`);
    await page.close();
  },

  /** T04 et P1: la préparation est un bloc de la colonne, pas un dialogue ;
   * elle dit GameCube, n'ouvre pas l'écran des touches, et le jeu reçoit
   * encore les touches. Le jumeau : « Essayer mes touches » ouvre le réglage,
   * qui, lui, retient les gestes, et la flèche n'arrive plus. */
  async "preparation-gamecube"() {
    const page = await nouvelle(PC, { salle: { bo: true, preparation: preparation(0, [0], false) } });
    await entrer(page);
    if (!(await jusqua(() => page.$("#preparation, .n3-preparation").then(Boolean), 8000)))
      throw new Precondition("la préparation ne se montre pas");
    const bloc = await page.evaluate(() => {
      const b = document.querySelector("#preparation");
      return {
        colonne: b?.closest("#side") != null,
        dialogue: document.querySelector("dialog[open]") !== null,
        texte: (b?.textContent ?? "").replace(/\s+/g, " "),
      };
    });
    if (!bloc.colonne) throw new Defaut("la préparation n'est pas un bloc de la colonne (#side #preparation)");
    if (bloc.dialogue) throw new Defaut("un dialogue reste ouvert pendant la préparation");
    if (!bloc.texte.includes("GameCube")) throw new Defaut(`le bloc ne dit pas GameCube: « ${bloc.texte.slice(0, 80)} »`);
    if (bloc.texte.includes("Avant de jouer")) throw new Defaut("le bloc garde le sur-titre « Avant de jouer »");
    if ((await page.$("#reading")) || /Lecture des commandes/.test(await texte(page)))
      throw new Defaut("l'écran des touches lit les commandes pendant une préparation");
    const fleche = async () => {
      const avant = banc.journal.droite;
      await page.focus("[data-zone-jeu]");
      await page.keyboard.down("ArrowRight");
      await sleep(400);
      await page.keyboard.up("ArrowRight");
      await sleep(300);
      return banc.journal.droite > avant;
    };
    if (!(await fleche())) throw new Defaut("pendant la préparation, une flèche dans la zone de jeu n'arrive pas au jeu");
    await capture(page, "preparation-gamecube");
    await page.click("#essayerTouches");
    if (!(await jusqua(() => page.$("#side #preparation").then(Boolean), 2000)))
      throw new Defaut("« Essayer mes touches » fait disparaître la préparation");
    await sleep(500);
    if (await fleche()) throw new Defaut("le réglage ouvert par « Essayer mes touches » laisse passer la flèche au jeu");
    await page.close();
  },

  /** P7 et P9 : une préparation Wii se choisit en radios ; qui regarde lit
   * le compte, sans bouton. */
  async "preparation-wii"() {
    const wii = await nouvelle(PC, {
      salle: { jeu: 2, bo: true, chef: "bo", preparation: { ...preparation(2, [1, 0], false), starter: BO } },
    });
    await entrer(wii);
    if (!(await jusqua(() => wii.$("#preparation, .n3-preparation").then(Boolean), 8000)))
      throw new Precondition("la préparation Wii ne se montre pas");
    const choix = await wii.evaluate(() => ({
      radios: document.querySelectorAll("#preparation input[type=radio]").length,
      listes: document.querySelectorAll("#preparation select, .n3-preparation select").length,
      titre: document.querySelector("#preparationTitre")?.textContent ?? "",
    }));
    if (choix.radios !== 2 || choix.listes !== 0)
      throw new Defaut(`les appareils Wii: ${choix.radios} radios et ${choix.listes} listes`);
    if (choix.titre !== "Bo lance le prochain jeu") throw new Defaut(`le titre dit « ${choix.titre} »`);
    if (!(await wii.$("#pretPrepared"))) throw new Defaut("un joueur de la préparation n'a pas « Je suis prêt »");
    await wii.close();
  },

  /** T03 et P6: une préparation Xbox 360 est le même bloc, nomme sa manette,
   * ne regrette pas des boutons Switch, et le chef lance en un geste. */
  async "preparation-x360"() {
    const page = await nouvelle(PC, {
      salle: { jeu: 1, bo: true, preparation: preparation(1, [4], true, 4) },
    });
    await entrer(page);
    if (!(await jusqua(() => page.$("#preparation, .n3-switch-setup[open]").then(Boolean), 8000)))
      throw new Precondition("la préparation Xbox 360 ne se montre pas");
    if (!(await page.$("#side #preparation")))
      throw new Defaut("la préparation Xbox 360 garde son dialogue au lieu du bloc de la colonne");
    const panneau = await texte(page, "#preparation");
    if (!panneau.includes("manette Xbox 360 · prêt") || /manette Pro · prêt/i.test(panneau))
      throw new Defaut("la ligne de Bo ne nomme pas la manette Xbox 360");
    if (panneau.includes("Home, Capture")) throw new Defaut("une salle Xbox 360 regrette Home et Capture");
    if (await page.$("#pretPrepared")) throw new Defaut("le chef doit encore dire « Je suis prêt »");
    if (!(await page.evaluate(() => document.querySelector("#cancelPrepared")?.textContent.trim() === "Garder Sonic Generations")))
      throw new Defaut("l'annulation ne dit pas qu'elle garde le jeu en cours");
    const avant = banc.journal.evenements.length;
    await page.click("#launchPrepared");
    const lance = () =>
      banc.journal.evenements
        .slice(avant)
        .some((e) => Array.isArray(e.quoi) && e.quoi[0] === "preparation" && e.quoi[1]?.action === "launch" && e.quoi[1]?.pad === 4);
    if (!(await jusqua(lance, 3000))) throw new Defaut("« Lancer le jeu » n'envoie pas le lancement avec la manette Pro");
    await capture(page, "preparation-x360");
    await page.close();
  },

  /** P8 : au téléphone, la bande dit la préparation en une ligne et ouvre
   * le bloc dans la feuille de la salle ; la manette à l'écran reste montée
   * et rien ne se pose sur l'image. Le jumeau : sans préparation, la bande
   * n'en dit rien. */
  async "preparation-telephone"() {
    const page = await nouvelle(TELEPHONE, {
      salle: { bo: true, chef: "bo", preparation: { ...preparation(0, [0], false), starter: BO } },
      stockage: { "nel3ab:touchpad": "on" },
    });
    await entrer(page);
    // `entrer` ouvre la feuille de la salle pour lire la place : la refermer.
    await page.evaluate(() => document.querySelector("#fermerFeuille")?.click());
    if (!(await jusqua(() => page.$("#bande").then(Boolean), 8000)))
      throw new Precondition("la feuille refermée, la bande ne revient pas");
    if (!(await jusqua(() => page.$("#bande #ouvrirPreparation").then(Boolean), 4000))) {
      const vu = await page.evaluate(() => ({
        bande: document.querySelector("#bande") !== null,
        bref: document.querySelector("#preparationEnBref")?.parentElement?.id ?? null,
        bloc: document.querySelector("#preparation")?.parentElement?.closest("[id]")?.id ?? null,
      }));
      throw new Defaut(`la bande ne dit pas la préparation (${JSON.stringify(vu)})`);
    }
    const bref = await page.evaluate(() => ({
      ligne: document.querySelector("#preparationEnBref p")?.textContent ?? "",
      bouton: document.querySelector("#ouvrirPreparation")?.textContent.trim() ?? "",
      pave: document.querySelector(".n3-pave") !== null,
      dialogue: document.querySelector("dialog[open]:not(#feuilleSalle)") !== null,
    }));
    if (bref.ligne !== "Bo lance le prochain jeu, Mario Party 4") throw new Defaut(`la bande dit « ${bref.ligne} »`);
    if (bref.bouton !== "Choisir ma manette") throw new Defaut(`le bouton de la bande dit « ${bref.bouton} »`);
    if (!bref.pave) throw new Defaut("la manette à l'écran disparaît pendant la préparation");
    if (bref.dialogue) throw new Defaut("un dialogue s'ouvre de lui-même pendant la préparation");
    await page.click("#ouvrirPreparation");
    if (!(await jusqua(() => page.$("#preparation #pretPrepared").then(Boolean), 3000)))
      throw new Defaut("« Choisir ma manette » n'ouvre pas le bloc de la préparation");
    await capture(page, "preparation-telephone");
    await page.close();
    const sans = await nouvelle(TELEPHONE, { stockage: { "nel3ab:touchpad": "on" } });
    await entrer(sans);
    await sans.evaluate(() => document.querySelector("#fermerFeuille")?.click());
    if (!(await jusqua(() => sans.$("#bande").then(Boolean), 8000)))
      throw new Precondition("sans préparation, la bande ne revient pas");
    await sleep(500);
    if (await sans.$("#preparationEnBref")) throw new Defaut("la bande dit une préparation qui n'existe pas");
    await sans.close();
  },

  /** T06 et C6 (chantier menus, 24 novembre 2026) : qui a lancé lit « Sur ta
   * sauvegarde. » ; les autres lisent l'étiquette de qui a lancé, à la place
   * que la salle lui donne, et « l'a lancé sur sa sauvegarde. ». */
  async "lanceur-ma-sauvegarde"() {
    const page = await nouvelle(PC, { salle: { bo: true } });
    await entrer(page);
    banc.annoncer({ game: "Mario Party 4", save: "la sauvegarde d'Ami", saveSlot: 2, starter: MOI });
    if (!(await jusqua(() => page.$("#booting").then(Boolean), 3000)))
      throw new Precondition("l'annonce de démarrage n'affiche pas d'écran de chargement");
    const vu = await texte(page, "#booting");
    if (!vu.includes("Sur ta sauvegarde.")) throw new Defaut(`le lanceur lit « ${vu.replace(/\s+/g, " ")} »`);
    if (await page.$("#booting .n3-etiquette"))
      throw new Defaut("le lanceur lit sa propre étiquette au lieu de « ta sauvegarde »");
    await capture(page, "lanceur-ma-sauvegarde");
    // Le jumeau : lancé par Bo, assis à la place 2, la même page lit
    // l'étiquette de Bo à la couleur de sa place.
    banc.annoncer({ game: "Mario Party 4", save: "la sauvegarde de Bo", saveSlot: 2, starter: BO });
    const lu = () =>
      page.evaluate(() => {
        const ligne = document.querySelector("#booting .n3-charge-sauvegarde");
        const etiquette = ligne?.querySelector(".n3-etiquette");
        return {
          texte: ligne?.textContent ?? "",
          place: etiquette?.getAttribute("data-place") ?? null,
        };
      });
    if (!(await jusqua(async () => (await lu()).place !== null, 3000))) {
      const l = await lu();
      throw new Defaut(`lancé par Bo, la page lit « ${l.texte} » sans étiquette`);
    }
    const l = await lu();
    if (l.place !== "2" || !l.texte.includes("Bo") || !l.texte.includes("l'a lancé sur sa sauvegarde."))
      throw new Defaut(`lancé par Bo, la page lit « ${l.texte} » (place ${l.place})`);
    await page.close();
  },

  /** C10 (chantier menus) : entrer dans une salle où un jeu tourne ne montre
   * jamais l'écran de chargement ; une annonce de démarrage le montre. */
  async "arrivee-sans-chargement"() {
    const page = await nouvelle(PC);
    let vu = false;
    await page.exposeFunction("__vuChargement", () => {
      vu = true;
    });
    await page.evaluateOnNewDocument(() => {
      new MutationObserver(() => {
        if (document.getElementById("booting")) window.__vuChargement?.();
      }).observe(document, { childList: true, subtree: true });
    });
    await entrer(page);
    if (!(await jusqua(() => page.$("#screen").then(Boolean), 5000)))
      throw new Precondition("la salle n'a pas d'image");
    await sleep(5000);
    if (vu) throw new Defaut("l'écran de chargement s'est montré à l'arrivée dans une salle où un jeu tourne");
    // Le jumeau : une annonce de démarrage le montre en moins de 3 s.
    banc.annoncer({ game: "Mario Party 4", save: "nouvelle partie", saveSlot: 0, starter: BO });
    if (!(await jusqua(() => page.$("#booting").then(Boolean), 3000)))
      throw new Precondition("une annonce de démarrage ne montre pas l'écran de chargement");
    if (!vu) throw new Precondition("l'observateur n'a pas vu l'écran de chargement qui est là");
    await page.close();
  },

  /** La relecture: au doigt, « Rendre ma place » et « Quitter la salle » font
   * 44 px de haut, et le clip ne laisse pas son « s » seul à la ligne. */
  async "cibles-tactiles"() {
    const page = await nouvelle(TELEPHONE, { stockage: { "nel3ab:touchpad": "off" } });
    await entrer(page);
    if (!(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)))
      throw new Precondition("le navigateur ne se dit pas tactile");
    await sleep(500);
    const tailles = await page.evaluate(() =>
      Object.fromEntries(
        ["#watchOnly", "#leaveRoom"].map((s) => [s, document.querySelector(s)?.getBoundingClientRect().height ?? 0]),
      ),
    );
    for (const [sel, h] of Object.entries(tailles)) if (h < 44) throw new Defaut(`${sel} fait ${Math.round(h)} px de haut`);
    const clip = await page.evaluate(
      () => [...document.querySelectorAll("button")].map((b) => b.textContent).find((t) => /clip des 45/.test(t)) ?? "",
    );
    if (/45 s/.test(clip)) throw new Defaut("« 45 s » peut se couper entre le nombre et l'unité");
    await page.evaluate(() => document.querySelector("#watchOnly")?.scrollIntoView({ block: "center" }));
    await capture(page, "cibles-tactiles");
    await page.close();
  },

  /** T05: l'avant-salle compte des places, et sa porte dit « Rejoindre »,
   * comme l'accueil des salles. Sous les trois dessins de l'avant-salle. */
  /** L'avant-salle n'a plus qu'un dessin (24 novembre 2026, chantier salon) :
   * la borne et son panneau START. La première place libre est le seul bouton
   * plein, « Prendre la place N », et « manettes libres » ne revient pas. Le
   * jumeau : Bo assis en 2, la place 1 reste conseillée et la 2 n'est pas à
   * prendre. */
  async "avant-salle-places"() {
    for (const bo of [false, true]) {
      const page = await nouvelle(PC, { salle: { bo } });
      await page.goto(banc.url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#enter", { timeout: 15000 });
      await sleep(800);
      const vu = await texte(page);
      if (/manettes? libres?/i.test(vu)) throw new Defaut("« manettes libres » dans l'avant-salle");
      const lu = await page.evaluate(() => ({
        porte: document.querySelector("#enter").textContent.trim(),
        pleins: [...document.querySelectorAll(".rt-bouton-plein")].map((b) => b.id),
        etats: [...document.querySelectorAll("#lobbySeats [data-port]")].map((p) => p.dataset.state),
        bascule: document.querySelector("#lookSwitch") !== null,
        // Le centre de chaque place rend la place : un nom de classe partagé
        // avec la borne du cadre a caché toute la borne le 24 novembre 2026,
        // et le DOM seul le laissait passer.
        touchees: [...document.querySelectorAll("#lobbySeats [data-port]")].map((p) => {
          const r = p.getBoundingClientRect();
          return r.width > 0 && p.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
        }),
      }));
      if (lu.bascule) throw new Defaut("l'avant-salle propose encore un autre dessin");
      if (lu.etats.length !== 4) throw new Precondition(`${lu.etats.length} places dans le panneau`);
      if (!lu.touchees.every(Boolean)) throw new Defaut(`places qui ne reçoivent pas leur centre : ${lu.touchees}`);
      if (lu.porte !== "Prendre la place 1") throw new Defaut(`la porte dit « ${lu.porte} »`);
      if (lu.pleins.join() !== "enter") throw new Defaut(`boutons pleins : ${lu.pleins.join(", ")}`);
      const deux = bo ? "busy" : "free";
      if (lu.etats[1] !== deux) throw new Defaut(`place 2 « ${lu.etats[1]} », attendu « ${deux} »`);
      await capture(page, `avant-salle-${bo ? "bo" : "vide"}`);
      await page.close();
    }
  },

  /** Une salle pleine (Bo à la 2, Cy, Di et Ed aux autres) : l'avant-salle
   * n'offre aucune place, et « Regarder la partie » est son seul plein.
   * Le jumeau : une place se libère, et « Prendre la place N » redevient le
   * seul plein. */
  async "salle-pleine-avant-salle"() {
    const page = await nouvelle(PC, { salle: { bo: true, occupes: { 1: "Cy", 3: "Di", 4: "Ed" } } });
    await page.goto(banc.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#lobbySeats [data-port]", { timeout: 15000 }).catch(() => {
      throw new Precondition("l'avant-salle ne montre pas ses places");
    });
    await sleep(800);
    const lu = () => page.evaluate(() => ({
      pleins: [...document.querySelectorAll(".rt-bouton-plein")]
        .filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.id),
      regarder: document.querySelector("#watch")?.textContent.trim() ?? null,
      boutons: document.querySelectorAll("#lobbySeats button[data-port]").length,
      noms: [...document.querySelectorAll("#lobbySeats [data-port]")].map((p) => p.textContent.trim()),
      // Le plein reçoit le point en son centre (un nom de classe partagé a
      // déjà caché toute la borne, 24 novembre 2026).
      touche: (() => {
        const b = document.querySelector("#watch");
        const r = b?.getBoundingClientRect();
        return !!r && r.width > 0 && b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      })(),
    }));
    const plein = await lu();
    if (!plein.noms.every((n) => /Cy|Bo|Di|Ed/.test(n))) throw new Precondition(`places du banc : ${plein.noms}`);
    if (plein.boutons !== 0) throw new Defaut(`${plein.boutons} places à prendre dans une salle pleine`);
    if (plein.pleins.join() !== "watch") throw new Defaut(`boutons pleins d'une salle pleine : ${plein.pleins.join(", ")}`);
    if (plein.regarder !== "Regarder la partie") throw new Defaut(`le plein dit « ${plein.regarder} »`);
    if (!plein.touche) throw new Defaut("« Regarder la partie » ne reçoit pas le point en son centre");
    banc.regler({ occupes: { 1: "Cy", 4: "Ed" } });
    if (!(await jusqua(async () => (await lu()).pleins.join() === "enter", 8000)))
      throw new Defaut(`la place 3 libérée, les pleins restent ${(await lu()).pleins.join(", ")}`);
    await page.close();
  },

  /** `?entrer=jouer&place=3` (lien de l'accueil du salon) entre à la place 3,
   * pas à la première libre, et l'adresse oublie la place une fois prise.
   * Puis le bouton de la place 3 de l'avant-salle fait de même. Le jumeau :
   * Bo tient la 2, un lien vers la 2 ne la lui prend pas. */
  async "place-precise"() {
    const page = await nouvelle(PC);
    await page.goto(`${banc.url}?entrer=jouer&place=3`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#screen", { timeout: 15000 }).catch(() => {
      throw new Precondition("`?entrer=jouer&place=3` n'entre pas dans la salle");
    });
    if (!(await jusqua(async () => /place \d/.test(await siege(page)), 8000)))
      throw new Precondition(`entré pour jouer sans place : « ${await siege(page)} »`);
    if (!(await jusqua(async () => /place 3/.test(await siege(page)), 4000)))
      throw new Defaut(`le lien de la place 3 a donné « ${await siege(page)} »`);
    if (!(await jusqua(async () => (await adresse(page)) === "/r/1/?entrer=jouer", 3000)))
      throw new Defaut(`l'adresse garde la place : ${await adresse(page)}`);
    await page.close();

    const avant = await nouvelle(PC);
    await avant.goto(banc.url, { waitUntil: "domcontentloaded" });
    await avant.waitForSelector('#lobbySeats button[data-port="3"]', { timeout: 15000 });
    await sleep(500);
    // Un vrai clic au centre, après avoir vérifié que ce point rend le bouton.
    const centre = await avant.evaluate(() => {
      const b = document.querySelector('#lobbySeats button[data-port="3"]');
      b?.scrollIntoView({ block: "center" });
      const r = b?.getBoundingClientRect();
      if (!b || !r || r.width === 0) return null;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      return { x, y, touche: b.contains(document.elementFromPoint(x, y)) };
    });
    if (!centre?.touche) throw new Precondition(`le bouton de la place 3 ne reçoit pas son centre : ${JSON.stringify(centre)}`);
    await avant.mouse.click(centre.x, centre.y);
    await avant.waitForSelector("#screen", { timeout: 15000 });
    if (!(await jusqua(async () => /place 3/.test(await siege(avant)), 8000)))
      throw new Defaut(`« Prendre » de la place 3 a donné « ${await siege(avant)} »`);
    await capture(avant, "place-precise");
    await avant.close();

    const jumeau = await nouvelle(PC, { salle: { bo: true } });
    const prises = (banc.journal.prises ?? []).length;
    await jumeau.goto(`${banc.url}?entrer=jouer&place=2`, { waitUntil: "domcontentloaded" });
    await jumeau.waitForSelector("#screen", { timeout: 15000 });
    if (!(await jusqua(async () => /place \d/.test(await siege(jumeau)), 8000)))
      throw new Precondition(`entré pour jouer sans place : « ${await siege(jumeau)} »`);
    await sleep(1500);
    if ((banc.journal.prises ?? []).length !== prises)
      throw new Defaut("la page a demandé la place 2, tenue par Bo");
    if (!/place 1/.test(await siege(jumeau))) throw new Defaut(`le jumeau tient « ${await siege(jumeau)} »`);
    if ((await adresse(jumeau)) !== "/r/1/?entrer=jouer")
      throw new Defaut(`l'adresse du jumeau garde la place : ${await adresse(jumeau)}`);
    await jumeau.close();
  },

  /** Aïn dans l'avant-salle (24 novembre 2026, chantier salon) : il vit dans
   * le logo de l'en-tête. Bo quitte la place 2 : « depart » se joue, le plein
   * passe à « Prendre la place 2 » sans attendre la scène, et la version
   * jouée n'est pas la pose clé (les ancres `start-2` et le sol `panneau`
   * sont trouvés). Bo revient : « arrivee ». Le jumeau : la page ouverte
   * avec Bo déjà assis ne joue rien. */
  async "avant-salle-ain"() {
    // Le niveau d'effets nommé : le stockage passe d'une étape à l'autre, et
    // une étape d'avant qui laissait « sobre » réduisait Aïn à sa pose clé
    // (porte complète du 24 novembre 2026).
    const page = await nouvelle(PC, {
      salle: { bo: true },
      stockage: { "nel3ab:effets": JSON.stringify({ niveau: "conseille", sons: false }) },
    });
    await page.goto(banc.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#enter", { timeout: 15000 });
    const ain = () =>
      page.evaluate(() => {
        const toile = document.querySelector('header [data-hote="logo"] > .rt-mascotte');
        return toile
          ? {
              scene: toile.dataset.scene ?? null,
              version: toile.dataset.version ?? null,
              refus: toile.dataset.refus ?? "",
            }
          : null;
      });
    if (!(await jusqua(async () => (await ain()) !== null, 4000)))
      throw new Defaut("Aïn n'est pas peint dans le logo de l'avant-salle");
    // Le jumeau : rien ne joue au premier état, Bo déjà assis.
    for (let i = 0; i < 8; i++) {
      const vu = await ain();
      if (vu.scene) throw new Defaut(`une scène au premier état : ${JSON.stringify(vu)}`);
      await sleep(100);
    }
    banc.regler({ bo: false });
    let depart = null;
    if (!(await jusqua(async () => (depart = await ain())?.scene === "depart", 3000)))
      throw new Defaut(`Bo part de la place 2 sans scène « depart » : ${JSON.stringify(await ain())}`);
    const porte = await page.$eval("#enter", (b) => b.textContent.trim());
    if (porte !== "Prendre la place 1")
      throw new Precondition(`le plein dit « ${porte} » : la place 1 reste la première libre`);
    const deux = await page.$eval('#lobbySeats [data-port="2"]', (p) => p.dataset.state);
    if (deux !== "free") throw new Defaut(`la place 2 est « ${deux} » pendant la scène`);
    // Le repli se lit dans `data-refus` : une version demandée puis refusée
    // (une ancre absente, un contrôle ou les mots du jeu sur le chemin).
    // « courte » sans refus est le choix d'un navigateur qui l'a déjà vue.
    if (depart.version === "cle" || depart.version === "pose" || depart.version === null || depart.refus)
      throw new Defaut(`« depart » replié en ${depart.version} : ${depart.refus || "sans raison dite"}`);
    console.log(JSON.stringify({ depart }));
    await capture(page, "avant-salle-depart");
    await sleep(2500);
    banc.regler({ bo: true });
    let arrivee = null;
    if (!(await jusqua(async () => (arrivee = await ain())?.scene === "arrivee", 3000)))
      throw new Defaut(`Bo revient à la place 2 sans scène « arrivee » : ${JSON.stringify(await ain())}`);
    console.log(JSON.stringify({ arrivee }));
    if (arrivee.version === "cle" || arrivee.version === "pose" || arrivee.refus)
      throw new Defaut(`« arrivee » replié en ${arrivee.version} : ${arrivee.refus || "sans raison dite"}`);
    await page.close();
  },
};

const choisies = option("etapes")?.split(",").filter(Boolean) ?? Object.keys(ETAPES);
const resultats = [];
try {
  for (const nom of choisies) {
    const etape = ETAPES[nom];
    if (!etape) throw new Error(`étape inconnue: ${nom}`);
    const debut = Date.now();
    let verdict = { etape: nom, resultat: "ok" };
    try {
      await etape();
    } catch (erreur) {
      for (const p of await browser.pages()) if (p.url() !== "about:blank") await capture(p, `${nom}-echec`).catch(() => {});
      const genre = erreur instanceof Defaut ? "défaut" : erreur instanceof Precondition ? "précondition" : "erreur";
      verdict = { etape: nom, resultat: genre, raison: erreur.message };
    }
    verdict.duree_s = Math.round((Date.now() - debut) / 100) / 10;
    resultats.push(verdict);
    console.log(JSON.stringify(verdict));
    for (const p of await browser.pages()) if (p.url() !== "about:blank") await p.close();
    if (verdict.resultat !== "ok" && !TOUT) break;
  }
} finally {
  await browser.close();
  await banc.fermer();
}

if (ROUGE) {
  const manque = ROUGE.filter((nom) => resultats.find((r) => r.etape === nom)?.resultat !== "défaut");
  console.log(JSON.stringify({ controle_negatif: manque.length === 0 ? "rouge comme attendu" : "PAS rouge", manque }));
  process.exit(manque.length === 0 ? 0 : 1);
}
process.exit(resultats.every((r) => r.resultat === "ok") && resultats.length === choisies.length ? 0 : 1);
