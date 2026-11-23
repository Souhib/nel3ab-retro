// Le cadre de la salle, prouvé dans un vrai navigateur: rien ne se pose sur
// l'image, rien ne la voile. Lancé par `just cadre-navigateur`.
//
// Pourquoi ce pilote existe. Jusqu'au 23 novembre 2026, sept calques se
// posaient sur l'image ou lui prenaient de la hauteur: la pile des avis du
// haut (manette branchée, fermeture proche, clavier en pause), l'avis du
// format réduit, les boutons de coin à 30 % d'une colonne repliée, la manette
// tactile, l'état de la liaison, la bande d'apprentissage. Le chantier salle
// leur donne un emplacement hors de l'image (`front/src/lib/cadre.ts`); ce
// pilote vérifie ce que le navigateur en fait.
//
// La garde de l'image (`gardeDeLImage`, offerte aux autres pilotes): à chaque
// image d'écran pendant `images` images, une grille de 20 × 20 points dans le
// rectangle de l'image, bords compris, doit rendre `#screen` ou
// `#zone-jeu` par `elementFromPoint`, et `#screen` doit s'afficher avec
// opacity 1, filter none et transform none, ses ancêtres sans opacité ni
// filtre. Une grille de 9 × 9 laissait passer les boutons de coin d'avant, qui
// tenaient dans les 40 premiers pixels.
//
// Le banc est celui des parcours (`parcours-banc.mjs`): la page COMMITTÉE, un
// salon et une salle simulés, le flux H.264 réel, un port de 5400 à 5499.
// Rien de vivant n'est touché.
//
//   node cadre.mjs --page <index.html> --flux <flux.h264> [--port 5478]
//        [--etapes a,b] [--captures dossier] [--rouge-attendu a,b]
//
// Sans `--rouge-attendu`, sort en échec dès qu'une étape échoue. Avec, sort en
// succès seulement si CHACUNE des étapes nommées échoue sur son DÉFAUT, pas
// sur une précondition.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export class Defaut extends Error {}
export class Precondition extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * La garde de l'image. Rend la liste de ses fautes, vide quand rien ne touche
 * l'image. Sans image peinte, elle le dit: une garde qui ne voit pas d'image
 * ne prouve rien.
 */
export async function gardeDeLImage(page, { images = 30 } = {}) {
  return page.evaluate(async (n) => {
    const fautes = new Set();
    const nom = (el) => {
      if (!el) return "rien";
      const id = el.id ? `#${el.id}` : "";
      const classes = typeof el.className === "string" && el.className ? `.${el.className.split(/\s+/)[0]}` : "";
      const texte = (el.textContent ?? "").trim().slice(0, 40);
      const parent = el.id ? null : el.parentElement?.closest("[id]");
      const dans = parent ? ` dans #${parent.id}` : "";
      return `${el.tagName.toLowerCase()}${id}${classes}${dans}${texte ? ` « ${texte} »` : ""}`;
    };
    let vues = 0;
    for (let i = 0; i < n; i += 1) {
      await new Promise((r) => requestAnimationFrame(() => r()));
      const toile = document.querySelector("#screen");
      const zone = document.querySelector("#zone-jeu");
      if (!toile || !zone) {
        fautes.add("pas de #screen ni de #zone-jeu");
        continue;
      }
      const peintes = globalThis.nel3abTest?.counters?.().painted ?? 0;
      const r = toile.getBoundingClientRect();
      if (peintes === 0 || r.width < 2 || r.height < 2) continue;
      vues += 1;
      const style = getComputedStyle(toile);
      if (style.opacity !== "1") fautes.add(`#screen à opacity ${style.opacity}`);
      if (style.filter !== "none") fautes.add(`#screen filtré (${style.filter})`);
      if (style.transform !== "none") fautes.add(`#screen transformé (${style.transform})`);
      for (let el = toile.parentElement; el; el = el.parentElement) {
        const s = getComputedStyle(el);
        if (s.opacity !== "1") fautes.add(`${nom(el)} à opacity ${s.opacity} au-dessus de l'image`);
        if (s.filter !== "none") fautes.add(`${nom(el)} filtré au-dessus de l'image`);
      }
      const gauche = Math.max(0, r.left);
      const haut = Math.max(0, r.top);
      const droite = Math.min(innerWidth, r.right);
      const bas = Math.min(innerHeight, r.bottom);
      const pas = 20;
      for (let a = 0; a < pas; a += 1) {
        for (let b = 0; b < pas; b += 1) {
          const x = gauche + 1 + ((droite - gauche - 2) * a) / (pas - 1);
          const y = haut + 1 + ((bas - haut - 2) * b) / (pas - 1);
          const ici = document.elementFromPoint(x, y);
          if (ici !== toile && ici !== zone) fautes.add(`${nom(ici)} sur l'image`);
        }
      }
      // La grille laisse passer un élément plus petit que son pas (les
      // boutons de coin d'avant tenaient dans 32 px). Chaque élément dont la
      // boîte coupe l'image est donc touché au milieu de l'intersection.
      for (const el of document.body.querySelectorAll("*")) {
        if (el === toile || el === zone || el.contains(toile)) continue;
        const b = el.getBoundingClientRect();
        const x0 = Math.max(b.left, gauche);
        const x1 = Math.min(b.right, droite);
        const y0 = Math.max(b.top, haut);
        const y1 = Math.min(b.bottom, bas);
        if (x1 - x0 < 1 || y1 - y0 < 1) continue;
        const ici = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
        if (ici && (ici === el || el.contains(ici)) && ici !== toile && ici !== zone)
          fautes.add(`${nom(ici)} sur l'image`);
      }
    }
    if (vues === 0) return ["aucune image peinte pendant la garde"];
    return [...fautes];
  }, images);
}

/** Les fautes de la garde, préfixées; « aucune image » est une précondition. */
async function garder(page, quand) {
  const fautes = await gardeDeLImage(page);
  if (fautes.length === 1 && fautes[0].startsWith("aucune image"))
    throw new Precondition(`${quand}: aucune image peinte`);
  return fautes.map((f) => `${quand}: ${f}`);
}

/** Échoue sur le défaut, avec toutes les fautes vues. */
function verdict(fautes) {
  if (fautes.length > 0) throw new Defaut(fautes.join(" ; "));
}

/* ── Le pilote ─────────────────────────────────────────────────────────── */

async function principal() {
  const puppeteer = (await import("puppeteer")).default;
  const { demarrerParcours } = await import("./parcours-banc.mjs");
  const args = process.argv.slice(2);
  const option = (nom, defaut = null) => {
    const i = args.indexOf(`--${nom}`);
    return i >= 0 ? args[i + 1] : defaut;
  };
  const PAGE = option("page");
  const FLUX = option("flux");
  if (!PAGE || !FLUX) throw new Error("usage: cadre.mjs --page <index.html> --flux <flux.h264>");
  const PORT = Number(option("port", "5478"));
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

  /** Les sept tailles de bureau de la garde. */
  const BUREAUX = [
    { width: 1024, height: 640 },
    { width: 1280, height: 720 },
    { width: 1280, height: 800 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1680, height: 1050 },
    { width: 1920, height: 1080 },
  ];

  async function capture(page, nom) {
    if (!CAPTURES) return;
    const vue = page.viewport();
    await page.screenshot({ path: `${CAPTURES}/${vue.width}x${vue.height}-${nom}.png` });
  }

  /** Une page neuve sur une salle remise à zéro, effets au niveau « tout ».
   * Les sockets de la page sont retenues, pour qu'une étape puisse rejouer un
   * message de la salle (la fermeture proche, que le banc n'envoie pas). */
  async function nouvelle(vue, { salle = {} } = {}) {
    banc.reinitialiser();
    banc.regler(salle);
    const page = await browser.newPage();
    await page.setViewport(vue);
    await page.evaluateOnNewDocument(() => {
      try {
        // Un onglet neuf part d'un stockage vide: la colonne repliée par une
        // étape précédente (le repli est retenu) ne doit pas suivre.
        if (!sessionStorage.getItem("banc-cadre")) {
          localStorage.clear();
          sessionStorage.setItem("banc-cadre", "1");
        }
        localStorage.setItem("nel3ab:name", "banc");
        localStorage.setItem("nel3ab:effets", '{"niveau":"tout","sons":false}');
      } catch {
        // Un stockage refusé laisse la page sur ses réglages par défaut.
      }
      const Avant = window.WebSocket;
      window.__sockets = [];
      window.WebSocket = class extends Avant {
        constructor(...args) {
          super(...args);
          window.__sockets.push(this);
        }
      };
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
  }

  /** La salle annonce une fermeture dans `minutes`: le message de salle de la
   * socket d'entrée, rejoué avec son octet de fermeture. */
  async function annoncerFermeture(page, minutes) {
    const fait = await page.evaluate((m) => {
      const ws = window.__sockets.find((s) => new URL(s.url).pathname.endsWith("/input") && s.readyState === 1);
      if (!ws) return false;
      // [4, place, decide, fermeture, quatre places tenues, 0]: la place 1,
      // tenue par cette page.
      const octets = new Uint8Array([4, 1, 1, m, 1, 0, 0, 0, 0]);
      ws.dispatchEvent(new MessageEvent("message", { data: octets.buffer }));
      return true;
    }, minutes);
    if (!fait) throw new Precondition("pas de socket d'entrée ouverte pour annoncer la fermeture");
  }

  const ETAPES = {
    /** La garde elle-même: un calque posé exprès sur l'image, puis un filtre
     * sur la toile, doivent être vus. Sans ce jumeau, une garde muette
     * passerait toutes les autres étapes. */
    async "garde-voit"() {
      const page = await nouvelle({ width: 1440, height: 900 });
      await entrer(page);
      // Pas de garde avant le leurre: cette étape prouve que la garde VOIT,
      // et doit pouvoir le prouver sur la page d'avant aussi, qui a ses
      // propres défauts (le contrôle rouge les attend).
      await page.evaluate(() => {
        const leurre = document.createElement("div");
        leurre.id = "leurre-cadre";
        Object.assign(leurre.style, {
          position: "fixed",
          left: "40%",
          top: "40%",
          width: "60px",
          height: "60px",
          zIndex: "50",
        });
        document.body.append(leurre);
      });
      const vues = await gardeDeLImage(page, { images: 5 });
      if (!vues.some((f) => f.includes("leurre-cadre"))) throw new Defaut(`le leurre n'est pas vu: ${vues}`);
      await page.evaluate(() => {
        document.getElementById("leurre-cadre")?.remove();
        document.querySelector("#screen").style.filter = "brightness(0.5)";
      });
      const filtre = await gardeDeLImage(page, { images: 5 });
      if (!filtre.some((f) => f.includes("filtré"))) throw new Defaut(`le filtre n'est pas vu: ${filtre}`);
      await page.close();
    },

    /** Rien sur l'image, à sept tailles de bureau, au niveau d'effets « tout »:
     * en partie, puis avec la fermeture proche annoncée, puis avec le clavier
     * rendu à la colonne. Contre la page de 03b21c0, la pile des avis se pose
     * en haut de l'image. */
    async "rien-sur-image"() {
      for (const vue of BUREAUX) {
        const page = await nouvelle(vue);
        await entrer(page);
        // Toutes les phases d'abord, le verdict ensuite: une page d'avant
        // doit montrer chacun de ses défauts, pas seulement le premier.
        const fautes = await garder(page, `${vue.width}×${vue.height} en partie`);
        await annoncerFermeture(page, 2);
        if (!(await jusqua(() => page.$("#closingNotice").then(Boolean), 4000)))
          throw new Precondition(`${vue.width}×${vue.height}: l'avis de fermeture ne s'affiche pas`);
        fautes.push(...(await garder(page, `${vue.width}×${vue.height} avec la fermeture proche`)));
        // Le focus quitte l'image pour un bouton de la colonne.
        await page.click("#zone-jeu");
        await page.evaluate(() => document.querySelector("#side button")?.focus());
        if (!(await jusqua(() => page.$("#clavierEnPause").then(Boolean), 4000)))
          throw new Precondition(`${vue.width}×${vue.height}: l'avis du clavier ne s'affiche pas`);
        fautes.push(...(await garder(page, `${vue.width}×${vue.height} avec le clavier en pause`)));
        await capture(page, "rien-sur-image");
        await page.close();
        verdict(fautes);
      }
    },

    /** Ctrl agrandit l'image: la colonne s'efface, et rien ne se pose sur
     * l'image. Contre la page de 03b21c0, les boutons de coin à 30 %
     * (« montrer (Ctrl) ») restent posés sur elle. */
    async agrandie() {
      // Deux tailles où l'image 4:3 du banc est bornée par la largeur: elle
      // doit donc grandir quand la colonne s'efface.
      for (const vue of [
        { width: 1440, height: 900 },
        { width: 1366, height: 1024 },
      ]) {
        const page = await nouvelle(vue);
        await entrer(page);
        const avant = await page.evaluate(() => document.querySelector("#screen").getBoundingClientRect().width);
        await page.click("#zone-jeu");
        await page.keyboard.down("Control");
        await page.keyboard.up("Control");
        if (!(await jusqua(async () => (await page.$("#side")) === null, 3000)))
          throw new Precondition(`${vue.width}×${vue.height}: Ctrl ne replie pas la colonne`);
        await sleep(300);
        const apres = await page.evaluate(() => document.querySelector("#screen").getBoundingClientRect().width);
        if (!(apres > avant)) throw new Precondition(`l'image ne grandit pas (${avant} puis ${apres} px)`);
        await page.mouse.move(vue.width / 2, vue.height / 2);
        verdict(await garder(page, `${vue.width}×${vue.height} agrandie`));
        await capture(page, "agrandie");
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal();
