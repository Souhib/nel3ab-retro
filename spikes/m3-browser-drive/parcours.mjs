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
// Sans `--rouge-attendu`, sort en échec dès qu'une étape échoue. Avec, sort en
// succès seulement si CHACUNE des étapes nommées échoue sur son défaut.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import puppeteer from "puppeteer";
import { BO, MOI, demarrerParcours } from "./parcours-banc.mjs";

const args = process.argv.slice(2);
const option = (nom, defaut = null) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 ? args[i + 1] : defaut;
};
const PAGE = option("page");
const FLUX = option("flux");
if (!PAGE || !FLUX) throw new Error("usage: parcours.mjs --page <index.html> --flux <flux.h264>");
const PORT = Number(option("port", "5477"));
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
    await page.click("#takePad");
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
    await page.click("#autresReglages > summary");
    await page.click("#watchOnly");
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
   * démarrage. La ligne dit « Le jeu démarre. » sans avoir effacé
   * l'arrivée. Sur la page de 54d1f6f, la phrase d'état la remplaçait. */
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
    if (!(await jusqua(async () => /Le jeu démarre/.test(await texte(page, "#ligneParlee")), 3000)))
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

  /** Le contrat d'Aïn : `start-1` à `start-4` sur chaque bouton START, une
   * fois, visibles et hors de l'image. Sur cc8c8a6, aucune ancre n'existait,
   * et l'arrivée et le départ ne pouvaient atteindre la place du joueur. */
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
            surLaPlace: a[0] !== undefined && a[0] === document.querySelector(`#port${n}`),
            visible: r !== undefined && r.width > 0 && r.height > 0,
            surLImage: r !== undefined && r.left < t.right && t.left < r.right && r.top < t.bottom && t.top < r.bottom,
          };
        }),
      };
    });
    for (const p of lu.places) {
      if (p.combien !== 1) throw new Defaut(`${p.combien} ancre(s) start-${p.n}`);
      if (!p.surLaPlace) throw new Defaut(`start-${p.n} n'est pas sur #port${p.n}`);
      if (!p.visible) throw new Defaut(`start-${p.n} n'a aucune boîte`);
      if (p.surLImage) throw new Defaut(`start-${p.n} est sur l'image`);
    }
    if (lu.toutes !== 4) throw new Defaut(`${lu.toutes} ancres start- dans la salle`);
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

  /** T04: une préparation GameCube dit GameCube, et l'écran des touches lit
   * une manette GameCube; le jumeau Wii garde sa lecture des commandes. */
  async "preparation-gamecube"() {
    const page = await nouvelle(PC, { salle: { bo: true, preparation: preparation(0, [0], false) } });
    await entrer(page);
    if (!(await jusqua(() => page.$(".n3-preparation").then(Boolean), 8000)))
      throw new Precondition("le panneau de préparation ne s'ouvre pas");
    const panneau = await texte(page, ".n3-preparation");
    if (!panneau.includes("Avant de jouer · GameCube"))
      throw new Defaut(`l'en-tête d'une préparation GameCube: « ${panneau.slice(0, 60)} »`);
    if ((await page.$("#reading")) || /Lecture des commandes/.test(await texte(page)))
      throw new Defaut("l'écran des touches lit les commandes d'un jeu Wii");
    await capture(page, "preparation-gamecube");
    await page.close();
    const wii = await nouvelle(PC, {
      salle: { jeu: 2, bo: true, preparation: preparation(2, [1, 0], false) },
    });
    await entrer(wii);
    if (!(await jusqua(() => wii.$("#reading").then(Boolean), 8000)))
      throw new Defaut("une préparation Wii n'a plus sa lecture des commandes");
    await wii.close();
  },

  /** T03 et P6: une préparation Xbox 360 nomme sa manette, ne regrette pas des
   * boutons Switch, et le chef lance en un geste. */
  async "preparation-x360"() {
    const page = await nouvelle(PC, {
      salle: { jeu: 1, bo: true, preparation: preparation(1, [4], true, 4) },
    });
    await entrer(page);
    if (!(await jusqua(() => page.$(".n3-switch-setup[open]").then(Boolean), 8000)))
      throw new Precondition("le panneau de la manette Pro ne s'ouvre pas");
    const panneau = await texte(page, ".n3-switch-setup[open]");
    if (!panneau.includes("manette Xbox 360 · prêt") || /Manette Pro · prêt|manette Pro · prêt/.test(panneau))
      throw new Defaut("la ligne de Bo ne nomme pas la manette Xbox 360");
    if (panneau.includes("Home, Capture")) throw new Defaut("une salle Xbox 360 regrette Home et Capture");
    const pret = await page.evaluate(() =>
      [...document.querySelectorAll(".n3-switch-setup[open] button")].some((b) => b.textContent.trim() === "Je suis prêt"),
    );
    if (pret) throw new Defaut("le chef doit encore dire « Je suis prêt »");
    await capture(page, "preparation-x360");
    await page.close();
  },

  /** T06: qui a lancé lit « ma sauvegarde »; les autres, le mot du salon. */
  async "lanceur-ma-sauvegarde"() {
    const page = await nouvelle(PC);
    await entrer(page);
    banc.annoncer({ game: "Mario Party 4", save: "la sauvegarde d'Ami", saveSlot: 2, starter: MOI });
    if (!(await jusqua(() => page.$("#booting").then(Boolean), 3000)))
      throw new Precondition("l'annonce de démarrage n'affiche pas d'écran de chargement");
    const vu = await texte(page, "#booting");
    if (!vu.includes("ma sauvegarde")) throw new Defaut(`le lanceur lit « ${vu.replace(/\s+/g, " ")} »`);
    await capture(page, "lanceur-ma-sauvegarde");
    // Le jumeau: lancé par Bo, la même page lit le mot du salon.
    banc.annoncer({ game: "Mario Party 4", save: "la sauvegarde de Bo", saveSlot: 2, starter: BO });
    if (!(await jusqua(async () => (await texte(page, "#booting")).includes("la sauvegarde de Bo"), 3000)))
      throw new Defaut("lancé par un autre, la page ne lit pas « la sauvegarde de Bo »");
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
  async "avant-salle-places"() {
    for (const look of ["classique", "cables", "plan"]) {
      const page = await nouvelle(PC, { salle: { bo: true }, stockage: { "nel3ab:lobby": look } });
      await page.goto(banc.url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#enter", { timeout: 15000 });
      await sleep(800);
      const vu = await texte(page);
      if (/manettes? libres?/i.test(vu)) throw new Defaut(`« manettes libres » dans le dessin ${look}`);
      const porte = await page.evaluate(() => document.querySelector("#enter").textContent.trim());
      if (porte !== "Rejoindre") throw new Defaut(`la porte du dessin ${look} dit « ${porte} »`);
      await capture(page, `avant-salle-${look}`);
      await page.close();
    }
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
