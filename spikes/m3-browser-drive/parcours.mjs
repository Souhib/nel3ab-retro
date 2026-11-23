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
  }, { "nel3ab:aide-clavier": "vue", ...stockage });
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
    if (!(await jusqua(() => page.$("#pick-close").then(Boolean), 2000)))
      throw new Defaut("« fermer la salle » ne demande pas de confirmer");
    await capture(page, "fermer-salle");
    await Promise.all([page.waitForNavigation({ timeout: 5000 }).catch(() => null), page.click("#pick-close")]);
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
    // Un AUTRE jeu que celui qui tourne: celui-là se relance, il n'est pas grisé.
    await page.evaluate(() => document.querySelector("#item-shelf-wii")?.click());
    if (!(await jusqua(() => page.$("#item-game2").then(Boolean), 3000)))
      throw new Precondition("le dossier Wii ne montre pas le jeu");
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
