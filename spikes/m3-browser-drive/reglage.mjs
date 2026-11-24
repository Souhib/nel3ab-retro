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

/** Tenu en main sans bande (une tablette en travers) : « La salle », puis
 * « Touches et manettes » à mi-hauteur quand sa rangée tient, sinon « Toute
 * la salle » et le rang en tête de sa colonne. Rend vrai quand le réglage
 * est ouvert. Jusqu'au 24 novembre 2026, ce chemin touchait l'entrée
 * « manette » de la feuille, qui cache ou montre les touches à l'écran et
 * n'ouvre aucune vue : à 1024 × 768, l'étape tombait sur sa précondition. */
async function ouvrirParLaFeuille(page) {
  if (!(await toucher(page, "#laSalle")) && !(await toucher(page, "#laSalleCote"))) return false;
  if (!(await jusqua(() => page.evaluate(() => document.querySelector("#feuilleSalle")?.open === true), 3000)))
    return false;
  await sleep(300);
  const entree = '#feuilleSalle [data-entree="reglage"]';
  if (await page.$(entree)) await toucher(page, entree);
  else {
    if (!(await toucher(page, '#feuilleSalle [data-entree="toute-la-salle"]'))) return false;
    if (!(await jusqua(() => page.$("#feuilleSalle #touchesEtManettes").then(Boolean), 3000))) return false;
    await toucher(page, "#feuilleSalle #touchesEtManettes");
  }
  return jusqua(() => page.$(OUVERT).then(Boolean), 4000);
}

/** Ouvre le réglage comme une personne avec une manette : « Ta manette »
 * (ou « Vérifier les boutons » tenu en main), puis « Changer ». Sans l'un
 * ni l'autre, par la feuille « La salle » (`ouvrirParLaFeuille`). */
async function ouvrirParLaManette(page) {
  if (!(await toucher(page, "#verifierManette")) && !(await toucher(page, "#taManette"))) {
    if (await ouvrirParLaFeuille(page)) {
      await sleep(500);
      return;
    }
    throw new Precondition("ni « Ta manette », ni « Vérifier les boutons », ni « Touches et manettes » par la feuille");
  }
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

  /** Changement 1 et constat 4 de la relecture : tenu en main, le panneau a
   * sa place sous l'image tenu droit et à droite d'elle en travers
   * (`Geometrie.reglage`, `lib/cadre`). Jusqu'au 24 novembre 2026, il vivait
   * dans la feuille agrandie, qui couvrait l'image : l'étape était rouge et
   * hors de la porte. La tablette de 1024 × 768 n'a pas de bande, donc pas de
   * « Vérifier les boutons » : elle passe par la feuille. */
  async "place-tenu"() {
    await placer([
      { width: 390, height: 844, isMobile: true, hasTouch: true },
      { width: 844, height: 390, isMobile: true, hasTouch: true },
      { width: 1024, height: 768, isMobile: true, hasTouch: true },
    ]);
  },

  /** Le rang « Touches et manettes » en tête de la colonne, juste sous
   * Signaler : un vrai clic ouvre le panneau sur l'onglet Manette, le focus
   * entre, et Échap le ferme en rendant le focus au rang. Le jumeau : le
   * rang n'est pas en double, et Signaler reste premier (K25). */
  async rang() {
    const fautes = [];
    const page = await nouvelle({ width: 1280, height: 720 });
    await entrer(page);
    const ordre = await page.evaluate(() =>
      [...document.querySelectorAll("#side nav [data-rang]")].map((un) => un.dataset.rang),
    );
    if (!ordre.includes("signaler")) throw new Precondition(`la colonne n'a pas Signaler (${ordre.join(", ")})`);
    if (!(await page.$("#touchesEtManettes"))) throw new Defaut(`pas de rang « Touches et manettes » (${ordre.join(", ")})`);
    if (ordre.indexOf("reglage") !== ordre.indexOf("signaler") + 1)
      fautes.push(`le rang n'est pas juste sous Signaler : ${ordre.join(", ")}`);
    if (ordre[0] !== "signaler") fautes.push(`Signaler n'est plus premier : ${ordre.join(", ")}`);
    if ((await page.$$("#touchesEtManettes")).length !== 1) fautes.push("deux rangs « Touches et manettes »");
    // Un vrai clic au centre de ce qui le reçoit (`toucher`) : sous le pied
    // collé de la colonne, il tomberait sur « Plus bas ».
    await toucher(page, "#touchesEtManettes");
    if (!(await jusqua(() => page.$("[data-reglage]").then(Boolean), 3000)))
      throw new Defaut("le rang n'ouvre pas le panneau");
    await sleep(300);
    const lu = () =>
      page.evaluate(() => ({
        onglet: document.querySelector('[role="tab"][aria-selected="true"]')?.id ?? null,
        dedans: document.activeElement?.closest("[data-reglage]") !== null,
        focusId: document.activeElement?.id ?? "",
        dansLaColonne: document.querySelector("[data-reglage]")?.closest("#side") !== null,
      }));
    let etat = await lu();
    if (etat.onglet !== "onglet-manette") fautes.push(`le rang ouvre ${etat.onglet}`);
    if (!etat.dedans) fautes.push(`le focus reste hors du panneau (${etat.focusId})`);
    if (!etat.dansLaColonne) fautes.push("le panneau n'est pas dans la colonne");
    await capture(page, "rang");
    await page.keyboard.press("Escape");
    if (!(await jusqua(() => page.$("[data-reglage]").then((un) => un === null), 2000)))
      fautes.push("Échap ne ferme pas le panneau");
    else {
      await sleep(200);
      etat = await lu();
      if (etat.focusId !== "touchesEtManettes") fautes.push(`après Échap, le focus est sur « ${etat.focusId} »`);
    }
    await page.close();
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
  },

  /** L4 (D7) : ton étiquette tapée dans la légende de « Ta manette », le
   * numéro de ta place et ton nom, à côté du dessin. Le jumeau : le dessin
   * de ce que le jeu reçoit n'en a pas, et elle n'est jamais dans un dessin. */
  async etiquette() {
    const fautes = [];
    const page = await nouvelle({ width: 1280, height: 720 });
    await entrer(page);
    await ouvrirParLaManette(page);
    if (!(await page.$("[data-reglage]"))) throw new Precondition("le panneau ne s'ouvre pas");
    const lu = await page.evaluate(() => {
      const figures = [...document.querySelectorAll("#reglage .n3-dessins figure.n3-controller")];
      const legende = (f) => f?.querySelector("figcaption")?.textContent ?? "";
      const tienne = figures.find((f) => legende(f).includes("Ta manette"));
      const jeu = figures.find((f) => legende(f).includes("Ce que le jeu reçoit"));
      const etiquette = tienne?.querySelector("figcaption .n3-etiquette");
      const r = etiquette?.getBoundingClientRect();
      return {
        figures: figures.length,
        place: etiquette?.getAttribute("data-place") ?? null,
        nom: etiquette?.querySelector(".sr-only")?.textContent ?? null,
        legende: legende(tienne),
        dansUnDessin: document.querySelector("#reglage svg .n3-etiquette") !== null,
        surLeJeu: jeu !== undefined && jeu.querySelector(".n3-etiquette") !== null,
        visible: r ? r.width > 0 && r.height > 0 : false,
      };
    });
    if (lu.figures !== 2) throw new Precondition(`${lu.figures} dessins dans le panneau`);
    if (!lu.place) throw new Defaut(`« Ta manette » n'a pas d'étiquette (« ${lu.legende} »)`);
    if (!lu.visible) fautes.push("l'étiquette n'a pas de taille");
    if (!lu.legende.includes(`${lu.place}P`)) fautes.push(`la légende ne dit pas « ${lu.place}P » (« ${lu.legende} »)`);
    if (!lu.nom) fautes.push("l'étiquette n'a pas de nom");
    if (lu.dansUnDessin) fautes.push("l'étiquette est posée dans un dessin");
    if (lu.surLeJeu) fautes.push("le dessin de ce que le jeu reçoit a une étiquette");
    await capture(page, "etiquette");
    await page.close();
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
  },

  /** Tenu droit, la feuille « La salle » porte « Touches et manettes » juste
   * après le menu quand sa rangée tient (390 × 844) : un toucher ferme la
   * feuille et ouvre le panneau à sa place, sous l'image. Le jumeau : à
   * 375 × 667 pendant une partie, quatre rangées feraient défiler la feuille,
   * l'entrée n'y est pas et la salle entière la porte. */
  async "feuille-reglage"() {
    const fautes = [];
    for (const [vue, voulue] of [
      [{ width: 390, height: 844, isMobile: true, hasTouch: true }, true],
      [{ width: 375, height: 667, isMobile: true, hasTouch: true }, false],
    ]) {
      const ici = `${vue.width}×${vue.height}`;
      const page = await nouvelle(vue);
      await entrer(page);
      if (!(await toucher(page, "#laSalle")) && !(await toucher(page, "#laSalleCote")))
        throw new Precondition(`${ici}: pas de « La salle »`);
      if (!(await jusqua(() => page.evaluate(() => document.querySelector("#feuilleSalle")?.open === true), 3000)))
        throw new Precondition(`${ici}: la feuille ne s'ouvre pas`);
      await sleep(400);
      const entrees = await page.evaluate(() =>
        [...document.querySelectorAll("#feuilleSalle [data-entree]")].map((e) => e.dataset.entree),
      );
      if (!entrees.includes("menu")) throw new Precondition(`${ici}: la feuille n'a pas le menu (${entrees.join(", ")})`);
      if (!voulue) {
        if (entrees.includes("reglage")) fautes.push(`${ici}: l'entrée tient dans une feuille trop basse`);
        await page.close();
        continue;
      }
      if (!entrees.includes("reglage"))
        throw new Defaut(`${ici}: la feuille n'a pas « Touches et manettes » (${entrees.join(", ")})`);
      if (entrees.indexOf("reglage") !== entrees.indexOf("menu") + 1)
        fautes.push(`${ici}: l'entrée n'est pas après le menu (${entrees.join(", ")})`);
      await toucher(page, '#feuilleSalle [data-entree="reglage"]');
      if (!(await jusqua(() => page.$("#reglageTenu [data-reglage]").then(Boolean), 3000))) {
        fautes.push(`${ici}: l'entrée n'ouvre pas le panneau à sa place`);
      } else {
        await sleep(400);
        if (await page.evaluate(() => document.querySelector("#feuilleSalle")?.open === true))
          fautes.push(`${ici}: la feuille reste ouverte sur le panneau`);
        const m = await mesurer(page);
        if (m.surImage > 0) fautes.push(`${ici}: le panneau couvre ${m.surImage} px² de l'image`);
      }
      await capture(page, "feuille-reglage");
      await page.close();
    }
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
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

  /** Changement 12 : pendant un « Changer », la pièce attendue reste à
   * l'écran. À 1280 × 720 et au téléphone, changer la DERNIÈRE ligne de la
   * table fait défiler les dessins hors de la vue : la ligne porte alors une
   * vignette de 64 px de la pièce encadrée. Le jumeau, à 1440 × 900 sur la
   * PREMIÈRE ligne : les dessins restent en vue, aucune vignette n'est
   * montée, et c'est la pièce encadrée du dessin qui se voit. */
  async "changer-visible"() {
    const fautes = [];
    const cas = [
      { vue: { width: 1280, height: 720 }, ligne: "last", vignette: true },
      { vue: { width: 390, height: 844, isMobile: true, hasTouch: true }, ligne: "last", vignette: true },
      { vue: { width: 1440, height: 900 }, ligne: "first", vignette: false },
    ];
    for (const { vue, ligne, vignette } of cas) {
      const ici = `${vue.width}×${vue.height}`;
      const page = await nouvelle(vue);
      await entrer(page);
      await ouvrirParLaManette(page);
      if (!(await page.$("[data-reglage]"))) throw new Defaut(`${ici}: « Changer » n'ouvre pas le panneau de la colonne`);
      await sleep(300);
      const cle = await page.evaluate(
        (quelle) => {
          const lignes = [...document.querySelectorAll("#page-manette table.n3-correspondances tbody tr[data-cle]")];
          return (quelle === "last" ? lignes.at(-1) : lignes[0])?.dataset.cle ?? null;
        },
        ligne,
      );
      if (!cle) throw new Precondition(`${ici}: la table de la manette n'a aucune ligne`);
      // Le vrai geste sur « Changer » (`toucher` fait défiler la ligne en vue).
      // Par attribut : une clé de commande n'est pas toujours un identifiant CSS.
      if (!(await toucher(page, `#reglage [id="pad-${cle.replaceAll('"', '\\"')}"]`)))
        throw new Precondition(`${ici}: pas de « Changer » pour ${cle}`);
      if (!(await jusqua(() => page.$('#reglage tr[data-attend="oui"]').then(Boolean), 2000)))
        throw new Precondition(`${ici}: « Changer » de ${cle} ne lance aucun changement`);
      await sleep(400);
      const lu = await page.evaluate(() => {
        /** La part visible d'un élément : sa boîte rognée par la fenêtre et
         * par chaque ancêtre qui coupe ce qui dépasse, et ce que reçoit le
         * point en son centre. */
        const vue = (el) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          const r = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
          for (let p = el.parentElement; p; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (s.overflowX === "visible" && s.overflowY === "visible") continue;
            const a = p.getBoundingClientRect();
            r.left = Math.max(r.left, a.left);
            r.top = Math.max(r.top, a.top);
            r.right = Math.min(r.right, a.right);
            r.bottom = Math.min(r.bottom, a.bottom);
          }
          r.left = Math.max(r.left, 0);
          r.top = Math.max(r.top, 0);
          r.right = Math.min(r.right, innerWidth);
          r.bottom = Math.min(r.bottom, innerHeight);
          const visible = Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
          const cx = b.left + b.width / 2;
          const cy = b.top + b.height / 2;
          const point = cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight ? document.elementFromPoint(cx, cy) : null;
          return {
            haut: Math.round(b.top),
            bas: Math.round(b.bottom),
            aire: Math.round(b.width * b.height),
            visible: Math.round(visible),
            recu: point !== null && (point === el || el.contains(point)),
          };
        };
        const ligne = document.querySelector('#reglage tr[data-attend="oui"]');
        const petite = ligne?.querySelector(".n3-vignette") ?? null;
        /** Ce que la vignette peint HORS de sa boîte : sa boîte dit 64 px,
         * mais un `svg` qui laisse déborder son dessin couvre les lignes
         * voisines (premier essai du 24 novembre 2026). Huit points à 6 px
         * autour d'elle ne doivent rendre aucun de ses éléments. */
        const deborde = () => {
          if (!petite) return [];
          const b = petite.getBoundingClientRect();
          const [g, d, h, bas] = [b.left - 6, b.right + 6, b.top - 6, b.bottom + 6];
          const mx = b.left + b.width / 2;
          const my = b.top + b.height / 2;
          return [
            [g, h], [mx, h], [d, h], [g, my], [d, my], [g, bas], [mx, bas], [d, bas],
          ]
            .filter(([x, y]) => x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight)
            .filter(([x, y]) => petite.contains(document.elementFromPoint(x, y)))
            .map(([x, y]) => `${Math.round(x)},${Math.round(y)}`);
        };
        return {
          cle: ligne?.dataset.cle ?? null,
          piece: vue(document.querySelector('#reglage .n3-dessins [data-padmap] [data-attendue="oui"]')),
          vignette: vue(petite),
          consigne: vue(ligne?.querySelector('[role="status"]')),
          deborde: deborde(),
          vignettes: document.querySelectorAll(".n3-vignette").length,
          hauteur: innerHeight,
        };
      });
      if (!lu.piece || lu.piece.aire < 1) throw new Precondition(`${ici}: la pièce de ${cle} n'est pas encadrée sur le dessin`);
      const entiere = (b) => b !== null && b.aire > 0 && b.visible >= b.aire - 1 && b.recu;
      const dit = (b) => (b ? `de ${b.haut} à ${b.bas} px, ${b.visible} px² visibles sur ${b.aire}` : "absente");
      if (vignette) {
        if (entiere(lu.piece)) throw new Precondition(`${ici}: les dessins restent en vue après « Changer » de ${cle}, rien à prouver`);
        if (!entiere(lu.vignette))
          fautes.push(`${ici}: pendant « Changer » de ${cle}, la pièce attendue sort de l'écran (${dit(lu.piece)}, fenêtre de ${lu.hauteur} px) et la ligne n'a pas de vignette entière (${dit(lu.vignette)})`);
        else if (Math.round(lu.vignette.bas - lu.vignette.haut) !== 64)
          fautes.push(`${ici}: la vignette fait ${lu.vignette.bas - lu.vignette.haut} px de haut, 64 attendus`);
        // La consigne (« Appuie sur… ») reste lisible à côté de la vignette :
        // la ligne qui grandit ne la pousse pas sous le bord.
        if (!entiere(lu.consigne))
          fautes.push(`${ici}: la consigne de ${cle} n'est pas entière à l'écran (${dit(lu.consigne)})`);
        if (lu.deborde.length)
          fautes.push(`${ici}: la vignette peint hors de sa boîte, en ${lu.deborde.join(" ; ")}`);
      } else {
        if (!entiere(lu.piece)) fautes.push(`${ici}: la pièce attendue de ${cle} n'est pas entière à l'écran (${dit(lu.piece)})`);
        if (lu.vignettes !== 0) fautes.push(`${ici}: ${lu.vignettes} vignette montée alors que les dessins sont en vue`);
      }
      await capture(page, `changer-${ligne}`);
      await page.close();
    }
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
  },

  /** Changement 20 : « Les nombres de ta manette », ouverts d'un vrai clic,
   * disent ce que la manette annonce. Le bouton 6 posé à 0,65 se lit
   * « 0.65 » et l'horodatage suit celui de la manette. Jusqu'au 24 novembre
   * 2026, le banc vivait hors de la racine que la boucle peignait, et il
   * restait à « 0.00 » quoi qu'on presse. */
  async nombres() {
    const page = await nouvelle({ width: 1440, height: 900 });
    await entrer(page);
    await ouvrirParLaManette(page);
    if (!(await page.$("#reglage .n3-nombres > summary")))
      throw new Precondition("le panneau n'a pas « Les nombres de ta manette »");
    await toucher(page, "#reglage .n3-nombres > summary");
    if (!(await page.evaluate(() => document.querySelector("#reglage .n3-nombres").open)))
      throw new Precondition("le clic n'ouvre pas les nombres");
    await page.evaluate(() => {
      window.__pad.buttons[6] = { pressed: true, touched: true, value: 0.65 };
      window.__pad.timestamp = 98765;
    });
    const lu = () =>
      page.evaluate(() => ({
        b6: document.querySelector('#reglage [data-gauge="b6"] .n3-value')?.textContent ?? null,
        horodatage: document.querySelector('#reglage [data-gauge="stamp"] .n3-value')?.textContent ?? null,
      }));
    const bon = await jusqua(async () => {
      const ici = await lu();
      return ici.b6 === "0.65" && ici.horodatage === "98765";
    }, 2000);
    await capture(page, "nombres");
    const vu = await lu();
    await page.close();
    if (vu.b6 === null) throw new Precondition("les nombres ouverts n'ont pas de jauge b6");
    if (!bon)
      throw new Defaut(`la manette annonce b6 = 0.65 et l'horodatage 98765 ; les nombres disent « ${vu.b6} » et « ${vu.horodatage} »`);
  },

  /** Changement 13 et touches-switch-xbox 3 : à l'appui, des coins encadrent
   * ta pièce et une ligne pointillée la relie à la commande, pendant que
   * l'étape suivante se cadre. Lu à chaque image (`requestAnimationFrame`),
   * pas après coup : jusqu'au 24 novembre 2026, l'étape suivante, émise dans
   * le même appel que la réponse, retirait coins et ligne avant toute
   * peinture. Un bouton d'abord, puis le stick gauche. */
  async marques() {
    const fautes = [];
    const page = await nouvelle({ width: 1440, height: 900 });
    await entrer(page);
    await ouvrirParLaManette(page);
    if (!(await toucher(page, "#learnPad"))) throw new Precondition("pas de « Régler pas à pas »");
    if (!(await jusqua(() => page.$("#commencerLecon").then(Boolean), 2000)))
      throw new Precondition("pas de « Commencer »");
    await toucher(page, "#commencerLecon");
    const attendue = () =>
      page.evaluate(() => document.querySelector("#reglage [data-attendue]")?.getAttribute("data-part") ?? null);
    if (!(await jusqua(async () => (await attendue()) === "A", 3000)))
      throw new Precondition(`la première étape n'attend pas A (${await attendue()})`);
    // Le relevé : à chaque image, les pièces qui portent des coins (et leur
    // stick), la ligne, et les pièces cadrées.
    const relever = () =>
      page.evaluate(() => {
        cancelAnimationFrame(window.__releve ?? 0);
        window.__vues = [];
        const lire = () => {
          const r = document.querySelector("#reglage");
          if (r)
            window.__vues.push({
              coins: [...r.querySelectorAll('[data-marque="coins"]')].map(
                (p) => `${p.getAttribute("data-part")}${p.dataset.stick ? `/${p.dataset.stick}` : ""}`,
              ),
              ligne: r.querySelector(".n3-liaison line") !== null,
              cadre: [...r.querySelectorAll('[data-marque="cadre"]')].map((p) => p.getAttribute("data-part")),
            });
          window.__releve = requestAnimationFrame(lire);
        };
        lire();
      });
    const vues = () => page.evaluate(() => window.__vues);
    await relever();
    await page.evaluate(() => window.__bouton(0, true));
    await sleep(300);
    await page.evaluate(() => window.__bouton(0, false));
    const apresBouton = await vues();
    if (apresBouton.length < 5) throw new Precondition(`seulement ${apresBouton.length} images relevées`);
    const peintes = apresBouton.filter((v) => v.coins.includes("b0"));
    if (!peintes.length) fautes.push(`aucune image ne peint les coins de b0 après l'appui (${apresBouton.length} images)`);
    else if (!peintes.some((v) => v.ligne)) fautes.push("les coins de b0 sont peints sans la ligne qui les relie à A");
    else if (!peintes.some((v) => v.cadre.length && !v.cadre.includes("A")))
      fautes.push("pendant les coins, l'étape suivante n'est pas cadrée");
    // Le stick gauche : passer jusqu'à l'étape qui l'attend, puis le pousser.
    await sleep(400);
    for (let i = 0; i < 20 && (await attendue()) !== "x"; i += 1) {
      await page.click("#passerEtape");
      await sleep(150);
    }
    if ((await attendue()) !== "x") throw new Precondition("aucune étape n'attend le stick");
    await sleep(200);
    await relever();
    await page.evaluate(() => {
      window.__pad.axes[0] = 0.95;
      window.__pad.timestamp += 16;
    });
    await sleep(300);
    await page.evaluate(() => {
      window.__pad.axes[0] = 0;
      window.__pad.timestamp += 16;
    });
    const apresStick = await vues();
    if (!apresStick.some((v) => v.coins.some((c) => c.endsWith("/a0") && v.ligne)))
      fautes.push(`aucune image ne peint les coins du stick a0 et sa ligne après la poussée (${apresStick.length} images)`);
    await page.evaluate(() => cancelAnimationFrame(window.__releve ?? 0));
    await capture(page, "marques");
    await page.close();
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
  },

  /** Le focus du pas à pas au clavier seul (Entrée, Échap), comme une
   * personne sans souris : après « Régler pas à pas », après « Commencer »,
   * et Échap qui remonte d'un cran à la fois (l'invite, puis le pas à pas,
   * puis le panneau). Jusqu'au 24 novembre 2026, le focus tombait sur le
   * document : l'invite ne se fermait pas, et un pas à pas arrêté laissait
   * le panneau ouvert. */
  async "focus-pas"() {
    const fautes = [];
    const page = await nouvelle({ width: 1440, height: 900 });
    await entrer(page);
    await ouvrirParLaManette(page);
    const focus = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        return {
          ou: `${a?.tagName.toLowerCase() ?? "rien"}${a?.id ? `#${a.id}` : ""}`,
          id: a?.id ?? "",
          dans: a?.closest?.("[data-reglage]") != null,
          pas: a?.closest?.("[data-pas-a-pas]") != null,
        };
      });
    const la = (sel) => page.$(sel).then(Boolean);
    if (!(await la("#learnPad"))) throw new Precondition("pas de « Régler pas à pas »");
    await page.focus("#learnPad");
    await page.keyboard.press("Enter");
    await sleep(300);
    if (!(await la("#commencerLecon"))) throw new Precondition("Entrée sur « Régler pas à pas » n'ouvre pas l'invite");
    let f = await focus();
    if (f.id !== "commencerLecon") fautes.push(`après « Régler pas à pas », le focus est sur ${f.ou}`);
    await page.keyboard.press("Escape");
    await sleep(300);
    f = await focus();
    const invite = await la("#commencerLecon");
    const ouvert = await la("[data-reglage]");
    if (invite || !ouvert || f.id !== "learnPad")
      fautes.push(
        `Échap sur l'invite : invite ${invite ? "toujours là" : "fermée"}, panneau ${ouvert ? "ouvert" : "fermé"}, focus sur ${f.ou}`,
      );
    if (!(await la("[data-reglage]"))) throw new Precondition("le panneau s'est fermé avant le pas à pas");
    if (!(await la("#commencerLecon"))) {
      await page.focus("#learnPad");
      await page.keyboard.press("Enter");
      await sleep(300);
    }
    await page.focus("#commencerLecon");
    await page.keyboard.press("Enter");
    if (!(await jusqua(() => la("[data-pas-a-pas]"), 2000)))
      throw new Precondition("Entrée sur « Commencer » ne lance pas le pas à pas");
    await sleep(300);
    f = await focus();
    if (!f.pas) fautes.push(`après « Commencer », le focus est sur ${f.ou}`);
    await page.keyboard.press("Escape");
    await sleep(400);
    f = await focus();
    const pas = await la("[data-pas-a-pas]");
    if (pas || !(await la("[data-reglage]")) || !f.dans)
      fautes.push(`premier Échap au pas à pas : ${pas ? "il continue" : "il s'arrête"}, focus sur ${f.ou}`);
    await page.keyboard.press("Escape");
    await sleep(400);
    if (await la("[data-reglage]")) fautes.push(`le second Échap ne ferme pas le panneau (focus sur ${(await focus()).ou})`);
    await capture(page, "focus-pas");
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

/** Hors de la porte : rien depuis le 24 novembre 2026. La place tenue en
 * main y attendait la géométrie du cadre ; elle y est entrée avec elle. */
const HORS_PORTE = new Set([]);
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
