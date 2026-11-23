// « Touches et manettes », prouvé dans un vrai navigateur. Lancé par
// `just reglage-navigateur`, et à rebours par `just reglage-navigateur-rouge`.
//
// Pourquoi ce pilote existe. Jusqu'au 23 novembre 2026, le réglage des
// touches était un dialogue modal de 1 120 × 850 px posé sur l'image : pendant
// qu'une personne changeait une touche, les autres ne voyaient plus le jeu.
// Le chantier manettes en fait un panneau qui prend la place des rangs de la
// colonne (`front/src/manettes/`). Ses essais jsdom n'ont ni mise en page, ni
// vrai focus, ni vraie manette : ce pilote vérifie ce que le navigateur en
// fait, sur la page COMMITTÉE et le banc des parcours (`parcours-banc.mjs`),
// sans rien de vivant.
//
//   node reglage.mjs --page <index.html> --flux <flux.h264> [--port 5482]
//        [--etapes a,b] [--captures dossier] [--rouge-attendu a,b]
//
// Sans `--rouge-attendu`, sort en échec dès qu'une étape échoue. Avec, sort en
// succès seulement si CHACUNE des étapes nommées échoue sur son DÉFAUT, pas
// sur une précondition.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { Defaut, Precondition, gardeDeLImage } from "./cadre.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const puppeteer = (await import("puppeteer")).default;
const { demarrerParcours } = await import("./parcours-banc.mjs");
const args = process.argv.slice(2);
const option = (nom, defaut = null) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 ? args[i + 1] : defaut;
};
const PAGE = option("page");
const FLUX = option("flux");
if (!PAGE || !FLUX) throw new Error("usage: reglage.mjs --page <index.html> --flux <flux.h264>");
const PORT = Number(option("port", "5482"));
const CAPTURES = option("captures");
const ROUGE = option("rouge-attendu")?.split(",").filter(Boolean) ?? null;
const TOUT = ROUGE !== null;
if (CAPTURES) mkdirSync(CAPTURES, { recursive: true });

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

/** Une page neuve sur une salle remise à zéro, avec une manette Xbox
 * standard simulée : `window.__pad` est son état, que l'étape change pour
 * appuyer, et `navigator.getGamepads` la rend comme une vraie (focus.mjs et
 * cadre.mjs font de même). */
async function nouvelle(vue, { salle = {} } = {}) {
  banc.reinitialiser();
  banc.regler(salle);
  const page = await browser.newPage();
  await page.setViewport(vue);
  await page.evaluateOnNewDocument(() => {
    const pad = {
      id: "Manette du banc (STANDARD GAMEPAD Vendor: 045e Product: 0b13)",
      index: 0,
      connected: true,
      mapping: "standard",
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      timestamp: 0,
      vibrationActuator: null,
    };
    window.__pad = pad;
    /** Appuie ou relâche le bouton `n` ; l'horodatage avance comme celui
     * d'une vraie manette, que la boucle lit pour savoir qu'elle parle. */
    window.__bouton = (n, oui) => {
      pad.buttons[n] = { pressed: oui, touched: oui, value: oui ? 1 : 0 };
      pad.timestamp += 16;
    };
    Object.defineProperty(navigator, "getGamepads", { value: () => [pad, null, null, null] });
    try {
      if (!sessionStorage.getItem("banc-reglage")) {
        localStorage.clear();
        sessionStorage.setItem("banc-reglage", "1");
      }
      localStorage.setItem("nel3ab:name", "banc");
      // Les effets au niveau conseillé, sons coupés : ceux d'une première visite.
      localStorage.setItem("nel3ab:effets", JSON.stringify({ niveau: "conseille", sons: false }));
      localStorage.setItem("nel3ab:aide-clavier", "vue");
    } catch {
      // Un stockage refusé laisse la page sur ses réglages par défaut.
    }
  });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.protocol === "data:" || u.protocol === "blob:" || u.origin === banc.base) return req.continue();
    return req.abort();
  });
  page.on("pageerror", (e) => console.error(`[pageerror] ${e.message}`));
  return page;
}

async function jusqua(test, ms, pas = 100) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await test()) return true;
    if (Date.now() > fin) return false;
    await sleep(pas);
  }
}

const peintes = (page) => page.evaluate(() => globalThis.nel3abTest?.counters?.().painted ?? 0);

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
  if (!(await jusqua(async () => (await peintes(page)) >= 30, 20000)))
    throw new Precondition("la page n'a pas peint 30 images en 20 s");
  // Le navigateur ne montre une manette qu'après un premier appui.
  await page.evaluate(() => window.__bouton(0, true));
  await sleep(150);
  await page.evaluate(() => window.__bouton(0, false));
  const vue = () =>
    page.evaluate(() => /connectée/.test(document.querySelector("#controller-status")?.textContent ?? ""));
  if (!(await jusqua(vue, 5000))) throw new Precondition("la page n'a pas vu la manette simulée");
}

/** Un vrai geste : un toucher sur une page tactile, un clic sinon. */
async function toucher(page, selecteur) {
  const el = await page.$(selecteur);
  if (!el) return false;
  // Ce qui reçoit le point au centre : un geste sur un élément couvert
  // toucherait l'autre (CLAUDE.md, « A box does not prove what receives the
  // point »).
  const recu = await page.evaluate((sel) => {
    const cible = document.querySelector(sel);
    cible.scrollIntoView({ block: "nearest" });
    const r = cible.getBoundingClientRect();
    const ici = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return ici === cible || cible.contains(ici) ? null : ici ? `${ici.tagName.toLowerCase()}#${ici.id}.${ici.className}` : "rien";
  }, selecteur);
  if (recu) throw new Precondition(`${selecteur} est couvert par ${recu}`);
  if (page.viewport().hasTouch) await el.tap();
  else await el.click();
  return true;
}

/** Ce que la page ouvre pour régler les touches : le panneau, ou un
 * dialogue ouvert (la page d'avant). */
const OUVERT = "#reglage, dialog[open]";

/** Ouvre le réglage comme une personne avec une manette : « Ta manette »
 * (ou « Vérifier les boutons » tenu en main, ou l'entrée « manette » de la
 * feuille « La salle » quand la bande manque), puis « Changer ». */
async function ouvrirParLaManette(page) {
  const parLaFeuille = async () => {
    if (!(await toucher(page, "#laSalle")) && !(await toucher(page, "#laSalleCote"))) return false;
    const entree = '#feuilleSalle [data-entree="manette"]';
    if (!(await jusqua(() => page.$(entree).then(Boolean), 3000))) return false;
    return toucher(page, entree);
  };
  if (
    !(await toucher(page, "#verifierManette")) &&
    !(await toucher(page, "#taManette")) &&
    !(await parLaFeuille())
  )
    throw new Precondition("ni « Ta manette », ni « Vérifier les boutons », ni la feuille « La salle »");
  if (!(await jusqua(() => page.$("#changerTouches").then(Boolean), 4000))) {
    const vu = await page.evaluate(() =>
      JSON.stringify({
        dialogues: [...document.querySelectorAll("dialog[open]")].map((d) => d.id),
        feuilles: [...document.querySelectorAll("dialog")].map((d) => `${d.id}:${d.open}`),
        vue: document.querySelector("#vueTouches") !== null,
        verifier: document.querySelector("#verifierManette") !== null,
      }),
    );
    throw new Precondition(`la vue de la manette n'a pas de « Changer » (${vu})`);
  }
  await toucher(page, "#changerTouches");
  if (!(await jusqua(() => page.$(OUVERT).then(Boolean), 4000)))
    throw new Precondition("« Changer » n'ouvre rien");
  await sleep(500);
}

/** Les mesures du réglage ouvert, en nombres (un DOMRect revient vide). */
const mesurer = (page) =>
  page.evaluate((sel) => {
    const ouvert = document.querySelector(sel);
    // La part VISIBLE du réglage : sa boîte rognée par chaque ancêtre qui
    // coupe ce qui dépasse (la colonne qui défile).
    const b = ouvert.getBoundingClientRect();
    const r = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    for (let el = ouvert.parentElement; el; el = el.parentElement) {
      const s = getComputedStyle(el);
      if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      const a = el.getBoundingClientRect();
      r.left = Math.max(r.left, a.left);
      r.top = Math.max(r.top, a.top);
      r.right = Math.min(r.right, a.right);
      r.bottom = Math.min(r.bottom, a.bottom);
    }
    r.width = Math.max(0, r.right - r.left);
    r.height = Math.max(0, r.bottom - r.top);
    const z = document.querySelector("#zone-jeu").getBoundingClientRect();
    const t = document.querySelector("#screen").getBoundingClientRect();
    const l = Math.max(0, Math.min(r.right, t.right) - Math.max(r.left, t.left));
    const h = Math.max(0, Math.min(r.bottom, t.bottom) - Math.max(r.top, t.top));
    const lz = Math.max(0, Math.min(r.right, z.right) - Math.max(r.left, z.left));
    const hz = Math.max(0, Math.min(r.bottom, z.bottom) - Math.max(r.top, z.top));
    const centre = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2);
    return {
      quoi: ouvert.id ? `#${ouvert.id}` : ouvert.tagName.toLowerCase(),
      boite: { x: r.left, y: r.top, w: r.width, h: r.height },
      image: { w: t.width, h: t.height },
      surImage: Math.round(l * h),
      surZone: Math.round(lz * hz),
      centre: centre?.id || centre?.tagName.toLowerCase() || "rien",
    };
  }, OUVERT);

/** Ouvre le réglage à chaque taille et relève ce qu'il couvre. Toutes les
 * tailles sont mesurées avant le verdict : une précondition à une taille
 * n'efface pas le défaut d'une autre. */
async function placer(tailles) {
  const fautes = [];
  const preconditions = [];
  const seules = option("tailles")?.split(",") ?? null;
  for (const vue of tailles.filter((t) => !seules || seules.includes(`${t.width}x${t.height}`))) {
    const ici = `${vue.width}×${vue.height}`;
    const page = await nouvelle(vue);
    try {
      await entrer(page);
      await ouvrirParLaManette(page);
      const m = await mesurer(page);
      if (m.boite.w < 1 || m.boite.h < 1) throw new Precondition(`${m.quoi} sans taille`);
      if (m.image.w < 2 || m.image.h < 2) throw new Precondition("pas d'image à côté du réglage");
      if (m.surImage > 0 || m.surZone > 0)
        fautes.push(`${ici}: le réglage recouvre l'image (${m.quoi}, ${m.surImage} px² sur l'image, ${m.surZone} sur la zone)`);
      // Au bureau, le panneau élargit la colonne (K24, `largeurPanneau`) :
      // au moins 560 px, et jamais plus de la moitié de la fenêtre.
      if (vue.width >= 900 && !vue.hasTouch && m.quoi === "#reglage" && m.boite.w < Math.min(560, vue.width / 2) - 40)
        fautes.push(`${ici}: le panneau n'a que ${Math.round(m.boite.w)} px de large`);
      if (m.centre !== "screen" && m.centre !== "zone-jeu")
        fautes.push(`${ici}: le centre de l'image rend ${m.centre}`);
      const garde = await gardeDeLImage(page);
      if (garde.length === 1 && garde[0].startsWith("aucune image"))
        throw new Precondition("aucune image peinte pendant la garde");
      // Les six premières fautes de la garde suffisent à nommer ce qui couvre.
      fautes.push(...garde.slice(0, 6).map((f) => `${ici}: ${f}`));
      if (garde.length > 6) fautes.push(`${ici}: et ${garde.length - 6} autres fautes de la garde`);
      await capture(page, "place");
    } catch (erreur) {
      if (!(erreur instanceof Precondition)) throw erreur;
      preconditions.push(`${ici}: ${erreur.message}`);
    }
    await page.close();
  }
  if (fautes.length) throw new Defaut(fautes.join(" ; "));
  if (preconditions.length) throw new Precondition(preconditions.join(" ; "));
}

const ETAPES = {
  /** Changement 0 du plan : le réglage ouvert ne touche pas l'image, au
   * bureau et en fenêtre étroite (la colonne passe sous l'image). La boîte
   * du réglage et celle de l'image (et de la zone de jeu) se coupent sur
   * 0 px², le centre de l'image rend l'image, et la garde de l'image
   * (`cadre.mjs`) ne voit rien dessus pendant 30 images. */
  async place() {
    await placer([
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
      { width: 860, height: 900 },
    ]);
  },

  /** Changement 1 : tenu en main, le panneau vit dans la feuille agrandie de
   * la salle, qui couvre l'image (`lib/cadre`, `FeuilleSalle`). La place
   * sous l'image et à droite en travers demande la géométrie du cadre, au
   * chantier salle : cette étape est ROUGE et hors de la porte tant qu'il
   * ne l'a pas posée. À 1024 × 768 tactile, « Vérifier les boutons » n'ouvre
   * aucune feuille, sur la page d'avant le chantier comme sur celle-ci. */
  async "place-tenu"() {
    await placer([
      { width: 390, height: 844, isMobile: true, hasTouch: true },
      { width: 844, height: 390, isMobile: true, hasTouch: true },
      { width: 1024, height: 768, isMobile: true, hasTouch: true },
    ]);
  },

  /** Changement 3 : « Toutes les touches » ouvre l'onglet Clavier, le focus
   * entre dans le panneau, Échap ferme et rend le focus à l'ouvreur. Une
   * seconde ouverture change l'onglet sans monter un second panneau. */
  async entrees() {
    const fautes = [];
    const page = await nouvelle({ width: 1280, height: 720 });
    await entrer(page);
    if (!(await page.$("#toutesLesTouches")))
      throw new Defaut("pas de « Toutes les touches » au bout du panneau de commande");
    await page.click("#toutesLesTouches");
    if (!(await jusqua(() => page.$("[data-reglage]").then(Boolean), 3000)))
      throw new Defaut("« Toutes les touches » n'ouvre pas le panneau");
    await sleep(300);
    const lu = () =>
      page.evaluate(() => ({
        panneaux: document.querySelectorAll("[data-reglage]").length,
        onglet: document.querySelector('[role="tab"][aria-selected="true"]')?.id ?? null,
        focus: document.activeElement?.closest("[data-reglage]") !== null,
        focusId: document.activeElement?.id ?? "",
      }));
    let etat = await lu();
    if (etat.onglet !== "onglet-clavier") fautes.push(`« Toutes les touches » ouvre ${etat.onglet}, pas le clavier`);
    if (!etat.focus) fautes.push(`le focus reste hors du panneau (${etat.focusId})`);
    await capture(page, "entrees-clavier");
    await page.keyboard.press("Escape");
    const ferme = await jusqua(() => page.$("[data-reglage]").then((un) => un === null), 2000);
    if (!ferme) fautes.push("Échap ne ferme pas le panneau");
    else {
      await sleep(200);
      etat = await lu();
      if (etat.focusId !== "toutesLesTouches") fautes.push(`après Échap, le focus est sur « ${etat.focusId} »`);
      // Échap a fermé le panneau sans ouvrir le menu par-dessus.
      if (await page.$("dialog[open]")) fautes.push("Échap qui ferme le panneau ouvre aussi un dialogue");
    }
    // Par la manette, puis « Toutes les touches » sur le panneau ouvert.
    await ouvrirParLaManette(page);
    etat = await lu();
    if (etat.onglet !== "onglet-manette") fautes.push(`« Changer » de la manette ouvre ${etat.onglet}`);
    await page.click("#toutesLesTouches");
    await sleep(300);
    etat = await lu();
    if (etat.panneaux !== 1) fautes.push(`${etat.panneaux} panneaux après une seconde ouverture`);
    if (etat.onglet !== "onglet-clavier") fautes.push(`la seconde ouverture laisse ${etat.onglet}`);
    // « Fermer » rend le focus à « Changer » de la vue remontée.
    await page.click("#fermerReglage");
    if (!(await jusqua(() => page.$("[data-reglage]").then((un) => un === null), 2000)))
      fautes.push("« Fermer » ne ferme pas le panneau");
    await sleep(200);
    etat = await lu();
    if (etat.focusId !== "changerTouches") fautes.push(`après « Fermer », le focus est sur « ${etat.focusId} »`);
    await page.close();
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
  },

  /** K34 : dans une salle Xbox 360, la vue de la manette suit la trame Pro.
   * Ses lignes ont une case (la trame envoyée dit ce qu'elle porte), et A
   * appuyé sur la manette coche UNE ligne, celle de A ; B en coche une
   * deuxième. La vue est une liste à cocher : une ligne cochée le reste. Le
   * jumeau : rien n'est coché avant le premier appui. */
  async "activite-pro"() {
    const fautes = [];
    const page = await nouvelle({ width: 1280, height: 720 }, { salle: { jeu: 1 } });
    await entrer(page);
    if (!(await toucher(page, "#taManette"))) throw new Precondition("pas de « Ta manette »");
    if (!(await jusqua(() => page.$("#vueTouches").then(Boolean), 3000)))
      throw new Precondition("la vue de la manette ne s'ouvre pas");
    await sleep(300);
    const lignes = () =>
      page.evaluate(() => {
        const toutes = [...document.querySelectorAll("#vueTouches .n3-ligne-touche")];
        return {
          total: toutes.length,
          suivies: toutes.filter((l) => l.hasAttribute("data-suivie")).length,
          cochees: [...document.querySelectorAll("#vueTouches .n3-case[data-cochee]")].length,
        };
      });
    const avant = await lignes();
    if (avant.total === 0) throw new Precondition("la vue de la manette n'a aucune ligne");
    if (avant.suivies === 0) fautes.push(`aucune des ${avant.total} lignes n'a de case en trame Pro`);
    if (avant.cochees !== 0) fautes.push(`${avant.cochees} cases cochées avant tout appui`);
    const appuyer = async (n) => {
      await page.evaluate((b) => window.__bouton(b, true), n);
      await sleep(300);
      await page.evaluate((b) => window.__bouton(b, false), n);
      await sleep(300);
    };
    await appuyer(0);
    const apresA = await lignes();
    if (avant.suivies > 0 && apresA.cochees !== 1) fautes.push(`A appuyé coche ${apresA.cochees} lignes au lieu d'une`);
    await appuyer(1);
    const apresB = await lignes();
    if (avant.suivies > 0 && apresB.cochees !== 2) fautes.push(`A puis B cochent ${apresB.cochees} lignes au lieu de deux`);
    await capture(page, "activite-pro");
    await page.close();
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
  },

  /** Changement 9 : à la souris, chaque pièce cliquable du dessin du jeu a
   * sa zone de clic, posée hors de React à la taille rendue. Une petite
   * pièce reçoit le clic à 10 px de son centre, au-delà de son bord ; aucune
   * zone ne rend une autre pièce que la sienne. */
  async zones() {
    const fautes = [];
    const page = await nouvelle({ width: 1440, height: 900 });
    await entrer(page);
    await ouvrirParLaManette(page);
    if (!(await page.$("[data-reglage]"))) throw new Defaut("« Changer » n'ouvre pas le panneau de la colonne");
    await sleep(300);
    const lu = await page.evaluate(() => {
      const jeu = document.querySelector("#reglage [data-padmap]");
      if (!jeu) return null;
      const cercles = [...jeu.querySelectorAll("circle.n3-zone")];
      const elargies = cercles.filter((c) => Number(c.getAttribute("r")) > Number(c.dataset.r) + 0.01);
      const ratees = [];
      for (const c of elargies) {
        const piece = c.closest("[data-part]");
        const b = c.getBoundingClientRect();
        // À droite du centre, au bord de la zone moins 1 px.
        const x = b.left + b.width / 2 + Math.min(10, b.width / 2 - 1);
        const y = b.top + b.height / 2;
        const ici = document.elementFromPoint(x, y)?.closest("[data-part]");
        if (ici !== piece) ratees.push(`${piece.getAttribute("data-part")} rend ${ici?.getAttribute("data-part") ?? "rien"}`);
      }
      return { cercles: cercles.length, elargies: elargies.length, ratees };
    });
    if (!lu) throw new Precondition("pas de dessin du jeu dans le panneau");
    if (lu.cercles === 0) fautes.push("le dessin du jeu n'a aucune zone de clic");
    else if (lu.elargies === 0) fautes.push(`aucune des ${lu.cercles} zones n'est élargie à la taille rendue`);
    fautes.push(...lu.ratees);
    await page.close();
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
  },

  /** Le pas à pas d'une salle GameCube, par la vraie boucle : la ligne
   * attendue est marquée, un appui la fait passer à la suivante, et une
   * seconde après, aucune animation ne tourne plus dans le panneau (rien ne
   * tourne entre deux gestes). Les autres étapes passées, la fin compte
   * l'appui retenu. */
  async "pas-a-pas"() {
    const fautes = [];
    const page = await nouvelle({ width: 1440, height: 900 });
    await entrer(page);
    await ouvrirParLaManette(page);
    if (!(await page.$("[data-reglage]"))) throw new Defaut("« Changer » n'ouvre pas le panneau de la colonne");
    if (!(await toucher(page, "#learnPad"))) throw new Precondition("pas de « Régler pas à pas »");
    if (!(await jusqua(() => page.$("#commencerLecon").then(Boolean), 2000)))
      throw new Precondition("pas de « Commencer »");
    await page.click("#commencerLecon");
    // L'étape en cours, lue sur la jauge (« Étape 1 sur 16 ») ; la table des
    // correspondances se cache pendant le pas à pas.
    const attendue = () =>
      page.evaluate(() => document.querySelector('#reglage [role="progressbar"]')?.getAttribute("aria-label") ?? null);
    if (!(await jusqua(() => attendue().then(Boolean), 3000)))
      throw new Precondition("aucune étape après « Commencer »");
    const premiere = await attendue();
    const marquee = await page.evaluate(
      () => document.querySelector("#reglage [data-attendue]") !== null,
    );
    if (!marquee) fautes.push("la commande attendue n'est pas marquée sur le dessin");
    await page.evaluate(() => window.__bouton(0, true));
    await sleep(200);
    await page.evaluate(() => window.__bouton(0, false));
    const suivante = await jusqua(async () => {
      const ici = await attendue();
      return ici !== null && ici !== premiere;
    }, 3000);
    if (!suivante) fautes.push(`un appui laisse « ${premiere} »`);
    await capture(page, "pas-a-pas");
    await sleep(1000);
    const tournent = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running" && a.effect?.target?.closest?.("#reglage"))
        .map((a) => a.animationName ?? a.constructor.name),
    );
    if (tournent.length) fautes.push(`une seconde après l'appui, ${tournent.length} animations tournent (${tournent.join(", ")})`);
    // Les quinze autres étapes passées : la fin compte l'appui retenu, et
    // nomme les commandes passées, qui gardent leur réglage d'avant (C4).
    // « Arrêter », lui, abandonne : le réglage d'avant reste entier.
    for (let i = 0; i < 30 && (await page.$("#passerEtape")); i += 1) {
      await page.click("#passerEtape");
      await sleep(120);
    }
    const fin = () => page.evaluate(() => document.querySelector("#reglage [data-fin-lecon]")?.textContent ?? null);
    if (!(await jusqua(() => fin().then(Boolean), 2000))) fautes.push("le pas à pas passé jusqu'au bout ne dit pas sa fin");
    else if (!/^1 commande réglée/.test(await fin())) fautes.push(`la fin dit « ${await fin()} » après un seul appui retenu`);
    await capture(page, "pas-a-pas-fin");
    await page.close();
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
  },
};

/** Hors de la porte : la place tenue en main attend la géométrie du cadre
 * (chantier salle), et se lance par `--etapes place-tenu`. */
const HORS_PORTE = new Set(["place-tenu"]);
const choisies =
  option("etapes")?.split(",").filter(Boolean) ?? Object.keys(ETAPES).filter((nom) => !HORS_PORTE.has(nom));
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
      for (const p of await browser.pages())
        if (p.url() !== "about:blank") await capture(p, `${nom}-echec`).catch(() => {});
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
