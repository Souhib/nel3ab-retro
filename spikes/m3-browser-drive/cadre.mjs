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
// tenaient dans les 40 premiers pixels. `elementFromPoint` ne voit que ce qui
// prend le pointeur : un élément visible sans pointeur dont la boîte coupe
// l'image le reçoit le temps d'un test de touche (relecture du 23 novembre
// 2026 : un voile plein écran à `pointer-events: none` passait la garde).
//
// Le banc est celui des parcours (`parcours-banc.mjs`): la page COMMITTÉE, un
// salon et une salle simulés, le flux H.264 réel, un port de 5400 à 5599.
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
    const transparent = (couleur) => couleur === "transparent" || /^rgba\(.*,\s*0\)$/.test(couleur);
    /** L'élément peint-il quelque chose de lui-même : un fond, un bord, une
     * ombre, un contour, un texte à lui, un élément remplacé (toile, image,
     * dessin), un pseudo-élément, ou un mélange avec ce qui est dessous ? */
    const peint = (el, s) => {
      if (/^(canvas|img|svg|video|iframe|picture|object|embed|input|select|textarea)$/i.test(el.tagName)) return true;
      if (!transparent(s.backgroundColor) || s.backgroundImage !== "none") return true;
      if (s.boxShadow !== "none" || s.backdropFilter !== "none" || s.mixBlendMode !== "normal") return true;
      if (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) return true;
      for (const cote of ["Top", "Right", "Bottom", "Left"])
        if (s[`border${cote}Style`] !== "none" && parseFloat(s[`border${cote}Width`]) > 0 && !transparent(s[`border${cote}Color`]))
          return true;
      for (const enfant of el.childNodes)
        if (enfant.nodeType === Node.TEXT_NODE && enfant.textContent.trim() !== "") return true;
      for (const pseudo of ["::before", "::after"]) {
        const contenu = getComputedStyle(el, pseudo).content;
        if (contenu !== "none" && contenu !== "normal") return true;
      }
      return false;
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
        // Les deux passes d'avant ne voient que ce qui prend le pointeur.
        // Un calque décoratif n'en prend pas (`pointer-events: none`) : la
        // neige, un voile, la mascotte, le décor de borne. Il reçoit le
        // pointeur le temps d'un test de touche, en neuf points de
        // l'intersection : s'il revient au-dessus de l'image, il la couvre.
        // Un élément sous l'image, ou rogné par un ancêtre qui défile, ne
        // revient pas : la toile passe devant lui. Rien n'est peint entre la
        // pose et le retrait, qui se font dans la même tâche.
        // Une boîte qui ne peint rien ne couvre rien : la boîte de la manette
        // tenue en main prend toute la largeur, image comprise, et seules ses
        // touches, dans les bandes, se voient. Ses enfants sont jugés un par
        // un.
        const s = getComputedStyle(el);
        if (s.pointerEvents !== "none" || s.visibility !== "visible" || !peint(el, s)) continue;
        let opacite = 1;
        for (let a = el; a && opacite > 0; a = a.parentElement) opacite *= Number(getComputedStyle(a).opacity);
        if (opacite === 0) continue;
        const valeur = el.style.getPropertyValue("pointer-events");
        const priorite = el.style.getPropertyPriority("pointer-events");
        el.style.setProperty("pointer-events", "auto", "important");
        try {
          for (const fx of [0.1, 0.5, 0.9]) {
            for (const fy of [0.1, 0.5, 0.9]) {
              const sous = document.elementFromPoint(x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy);
              if (sous && (sous === el || el.contains(sous))) fautes.add(`${nom(el)} sur l'image, sans pointeur`);
            }
          }
        } finally {
          if (valeur) el.style.setProperty("pointer-events", valeur, priorite);
          else el.style.removeProperty("pointer-events");
        }
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
  // `--clair jour` ou `--clair nuit` : la préférence du système, pour les
  // captures de nuit et de jour (étape 8). Sans elle, celle de Chrome.
  const CLAIR = option("clair");
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
    const clair = CLAIR ? `-${CLAIR}` : "";
    await page.screenshot({ path: `${CAPTURES}/${vue.width}x${vue.height}-${nom}${clair}.png` });
  }

  /** Une page neuve sur une salle remise à zéro, effets au niveau « tout ».
   * Les sockets de la page sont retenues, pour qu'une étape puisse rejouer un
   * message de la salle (la fermeture proche, que le banc n'envoie pas). */
  async function nouvelle(vue, { salle = {}, niveau = "tout", manette = false, stockage = {} } = {}) {
    banc.reinitialiser();
    banc.regler(salle);
    const page = await browser.newPage();
    await page.setViewport(vue);
    if (CLAIR)
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: CLAIR === "jour" ? "light" : "dark" }]);
    // Une vraie manette, simulée : une manette Xbox standard que la boucle
    // d'entrée lit par `navigator.getGamepads`, comme focus.mjs. Elle se
    // branche et se débranche par `window.__brancher(oui)`.
    if (manette)
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
        let branchee = true;
        window.__brancher = (oui) => {
          branchee = oui;
        };
        Object.defineProperty(navigator, "getGamepads", {
          value: () => [branchee ? pad : null, null, null, null],
        });
      });
    await page.evaluateOnNewDocument((niveau) => {
      try {
        // Un onglet neuf part d'un stockage vide: la colonne repliée par une
        // étape précédente (le repli est retenu) ne doit pas suivre.
        if (!sessionStorage.getItem("banc-cadre")) {
          localStorage.clear();
          sessionStorage.setItem("banc-cadre", "1");
        }
        localStorage.setItem("nel3ab:name", "banc");
        localStorage.setItem("nel3ab:effets", JSON.stringify({ niveau, sons: false }));
        // La vue des touches de la première visite prend la place des rangs
        // (étape 6) ; le cadre se vérifie sur une vue déjà lue.
        localStorage.setItem("nel3ab:aide-clavier", "vue");
      } catch {
        // Un stockage refusé laisse la page sur ses réglages par défaut.
      }
      const Avant = window.WebSocket;
      window.__sockets = [];
      window.WebSocket = class extends Avant {
        constructor(...args) {
          super(...args);
          window.__sockets.push(this);
          // `window.__geler = true` change chaque image de la salle en
          // message vide, celui que le worker envoie pour dire qu'il est là
          // sans rien de nouveau (media/video.ts) : l'image s'arrête, la
          // liaison reste entendue, et la page voit une image figée. Posé
          // avant les écouteurs de la page, il passe avant eux.
          this.addEventListener("message", (e) => {
            if (!window.__geler || !new URL(this.url).pathname.endsWith("/video")) return;
            if (!(e.data instanceof ArrayBuffer) || e.data.byteLength === 0) return;
            e.stopImmediatePropagation();
            this.dispatchEvent(new MessageEvent("message", { data: new ArrayBuffer(0) }));
          });
        }
      };
    }, niveau);
    // Après le stockage vidé de l'onglet neuf : les réglages de l'étape.
    await page.evaluateOnNewDocument((stockage) => {
      try {
        for (const [cle, valeur] of Object.entries(stockage)) localStorage.setItem(cle, valeur);
      } catch {
        // Sans stockage, la page garde ses réglages par défaut.
      }
    }, stockage);
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

  /**
   * Où se lit ta place, place 1 tenue au doigt : sur la rangée du panneau
   * (`#port1` visible), ou sur ton étiquette (`#etiquetteManette`), jamais
   * les deux, jamais aucun. `cas.panneau` et `cas.lieu` disent ce que la
   * taille doit montrer ; un écart est un défaut. L'étiquette et l'étiquette
   * de ta place START doivent se lire : on leur rend le pointeur le temps
   * du test de touche (`elementFromPoint` ignore un élément sans pointeur),
   * et rien d'autre ne doit être au-dessus d'elles.
   */
  async function verifierEtiquette(cas) {
    const fautes = [];
    const page = await nouvelle({ ...cas.vue, isMobile: true, hasTouch: true }, { salle: cas.salle });
    await entrer(page);
    if (!(await jusqua(() => page.$(".n3-pave").then(Boolean), 4000)))
      throw new Precondition(`${cas.nom}: la manette à l'écran n'est pas montée`);
    await sleep(400);
    const lu = await page.evaluate(() => {
      const boite = (x) => {
        const r = x.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      };
      const ecart = (a, b) =>
        Math.hypot(Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)));
      const coupe = (a, b) =>
        Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
      /** Ce qui reçoit le doigt sur ce que `el` montre : ses lignes de texte
       * et ses boîtes rendues (un `Range`, car le texte peut déborder de la
       * boîte de `el` : à 390×844, « AMI » sortait de ta place et passait
       * sous « 2P »), cinq points sur le milieu de chacune, pointeur rendu à
       * `el` et à ses enfants le temps du test. `lignes` compte ce qui a été
       * lu : zéro, c'est que rien ne se montre. */
      const lecture = (el) => {
        const touches = [el, ...el.querySelectorAll("*")];
        const avant = touches.map((x) => x.style.pointerEvents);
        for (const x of touches) x.style.pointerEvents = "auto";
        const plage = document.createRange();
        plage.selectNodeContents(el);
        const lignes = [...plage.getClientRects()].filter((r) => r.width > 2 && r.height > 2);
        const vus = [];
        for (const r of lignes)
          for (let i = 0; i < 5; i += 1)
            vus.push(document.elementFromPoint(r.left + 1 + ((r.width - 2) * (i + 0.5)) / 5, r.top + r.height / 2));
        touches.forEach((x, i) => {
          x.style.pointerEvents = avant[i];
        });
        return { lignes: lignes.length, vus };
      };
      const nomDe = (x) => {
        if (!x) return "rien";
        const id = x.closest("[id]")?.id;
        return `${x.tagName.toLowerCase()}.${String(x.className).split(" ")[0]}${id ? ` dans #${id}` : ""} « ${(x.textContent ?? "").trim().slice(0, 30)} »`;
      };
      const ecran = document.querySelector("#screen");
      const image = ecran ? boite(ecran) : null;
      const port1 = document.querySelector("#port1");
      const r1 = port1 ? boite(port1) : null;
      const panneau = r1 !== null && r1.w > 0 && r1.h > 0;
      // L'étiquette de ta place START : rien d'une autre place ni de la
      // phrase d'aide au-dessus. Ce qui vient de ta place même (« toi ») est
      // noté à part : c'est la place de personnes.
      let place = null;
      if (panneau) {
        const etiquette = port1.querySelector(".n3-etiquette");
        const lu = etiquette ? lecture(etiquette) : { lignes: 0, vus: [] };
        place = {
          lignes: lu.lignes,
          dehors: [...new Set(lu.vus.filter((x) => !x?.closest("#port1")).map(nomDe))],
          dedans: [...new Set(lu.vus.filter((x) => x?.closest("#port1") && !etiquette.contains(x)).map(nomDe))],
        };
      }
      const toutes = [...document.querySelectorAll("#etiquetteManette")];
      const el = toutes[0];
      if (!el) return { n: 0, panneau, place, image };
      const e = boite(el);
      const salle = document.querySelector("#laSalleCote");
      const s = salle ? boite(salle) : null;
      const pieces = [...document.querySelectorAll(".n3-pave > :not(#etiquetteManette), #laSalleCote")]
        .map((p) => ({ nom: p.dataset.touche ?? p.dataset.geste ?? p.id ?? p.className, r: boite(p) }))
        .filter((p) => p.r.w > 0);
      const proche = pieces.map((p) => ({ nom: p.nom, d: ecart(e, p.r) })).sort((a, b) => a.d - b.d)[0];
      const lieu = el.closest(".n3-manette-boite")
        ? "fente"
        : el.closest("#bande")
          ? "bande"
          : el.classList.contains("n3-etiquette-cote")
            ? "cote"
            : "ailleurs";
      return {
        n: toutes.length,
        panneau,
        place,
        image,
        lieu,
        rect: e,
        vue: e.w > 0 && e.h > 0 && getComputedStyle(el).visibility !== "hidden",
        dansLaFenetre: e.x >= 0 && e.y >= 0 && e.x + e.w <= innerWidth && e.y + e.h <= innerHeight,
        coupe: image !== null && coupe(e, image),
        sousLaSalle: s !== null && e.y >= s.y + s.h && Math.min(e.x + e.w, s.x + s.w) - Math.max(e.x, s.x) > 0,
        proche,
        lu: (() => {
          const { lignes, vus } = lecture(el);
          return { lignes, dessus: [...new Set(vus.filter((x) => !el.contains(x)).map(nomDe))] };
        })(),
        texte: el.textContent ?? "",
      };
    });
    console.log(JSON.stringify({ note: `etiquette ${cas.nom}: ${JSON.stringify(lu)}` }));
    if (!lu.image || lu.image.w < 1 || lu.image.h < 1) throw new Precondition(`${cas.nom}: pas d'image à l'écran`);
    if (lu.panneau !== cas.panneau)
      fautes.push(`${cas.nom}: ${lu.panneau ? "la rangée du panneau est là" : "la rangée du panneau manque"}, attendu ${cas.panneau ? "la rangée" : "sans rangée"}`);
    // Ton nom sur ta place START : tenu droit, la rangée le montre. En
    // travers, le panneau est « petit » et le garde pour la feuille
    // (`places.css`) : `cas.nomSurLaPlace` le dit, la page ne le choisit pas.
    if (cas.panneau && cas.nomSurLaPlace) {
      if (!lu.place || lu.place.lignes === 0) fautes.push(`${cas.nom}: ton nom ne se montre pas sur ta place START`);
      else {
        if (lu.place.dehors.length) fautes.push(`${cas.nom}: ton nom sur ta place START est couvert par ${lu.place.dehors.join(", ")}`);
        if (lu.place.dedans.length)
          console.log(JSON.stringify({ note: `${cas.nom}: dans ta place START, au-dessus de ton nom (personnes) : ${lu.place.dedans.join(", ")}` }));
      }
    }
    const voulues = cas.lieu ? 1 : 0;
    if (lu.n !== voulues)
      fautes.push(
        `${cas.nom}: ${lu.n} étiquette(s) hors du panneau, ${voulues} attendue${cas.lieu ? ` (${cas.lieu})` : " : la rangée porte ta place, une chose, une fois"}`,
      );
    else if (cas.lieu) {
      if (lu.lieu !== cas.lieu) fautes.push(`${cas.nom}: l'étiquette est posée « ${lu.lieu} », attendu « ${cas.lieu} »`);
      if (!lu.vue) fautes.push(`${cas.nom}: l'étiquette n'est pas visible`);
      if (!lu.dansLaFenetre) fautes.push(`${cas.nom}: l'étiquette sort de la fenêtre`);
      if (lu.coupe) fautes.push(`${cas.nom}: l'étiquette coupe l'image`);
      if (cas.lieu !== "fente" && !lu.sousLaSalle) fautes.push(`${cas.nom}: l'étiquette n'est pas sous « La salle »`);
      if (lu.proche && lu.proche.d < 6) fautes.push(`${cas.nom}: l'étiquette est à ${lu.proche.d.toFixed(1)} px de ${lu.proche.nom}`);
      if (lu.lu.lignes === 0) fautes.push(`${cas.nom}: l'étiquette ne montre rien`);
      if (lu.lu.dessus.length) fautes.push(`${cas.nom}: l'étiquette est couverte par ${lu.lu.dessus.join(", ")}`);
      if (!lu.texte.includes("1P")) fautes.push(`${cas.nom}: l'étiquette ne dit pas le numéro (« ${lu.texte} »)`);
      fautes.push(...(await garder(page, `${cas.nom} étiquette`)));
    }
    await capture(page, `etiquette-${cas.nom.replace(/[^0-9a-zA-Z]+/g, "-")}`);
    await page.close();
    return fautes;
  }

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

  /** Une salle au repos: pas d'image à attendre, l'écran éteint suffit. */
  async function entrerAuRepos(page) {
    await page.goto(banc.url, { waitUntil: "domcontentloaded" });
    try {
      // `#menu` aussi: une page d'avant ouvrait son menu d'office au repos,
      // et le contrôle rouge doit tomber sur ce défaut, pas attendre ici.
      await page.waitForSelector("#enter, #idle-room, #menu", { timeout: 15000 });
      if (await page.$("#enter")) {
        await page.click("#enter");
        await page.waitForSelector("#idle-room, #menu", { timeout: 15000 });
      }
    } catch (e) {
      throw new Precondition(`la salle au repos ne montre pas son écran: ${e.message}`);
    }
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

  /**
   * La sonde d'Aïn, posée avant la page : à chaque image d'écran, PENDANT et
   * HORS d'une scène, la boîte serrée de chaque sprite visible (`data-serre`)
   * contre l'image peinte, chaque contrôle, chaque mot marqué (`data-texte`)
   * et les mots de l'écran éteint (`#idle-room h2, #idle-room p`, même sans
   * marque). Un contrôle ou un mot compte seulement là où il se voit : un
   * point de la part commune au sprite et à lui doit le toucher
   * (`elementFromPoint`, qui ne voit pas le calque d'Aïn). Ce qui défile
   * sous le pied collé de la colonne ne se voit pas. C'est une autre façon
   * de lire que celle du planificateur (`moteur.ts` coupe les rectangles
   * par l'abri de la maison) : la sonde ne partage pas son angle mort.
   * Une sonde qui ne regardait que pendant `[data-scene]` n'a jamais vu
   * la bulle « Z » restée sur l'image agrandie (relecture du 24 novembre
   * 2026).
   */
  const SONDE_AIN = () => {
    const etat = { images: 0, hors: 0, scenes: {}, lieux: {}, fautes: {} };
    window.__mascotte = etat;
    const coupe = (a, b) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    const AUTRES =
      'button, a[href], input, select, summary, [role="button"], #liaison, #fronton, #mesures, [data-texte], #idle-room h2, #idle-room p';
    /** Un point de la part commune au sprite et à `o` le touche-t-il ? */
    const seVoit = (o, r, b) => {
      const x0 = Math.max(r.left, b.left);
      const x1 = Math.min(r.right, b.right);
      const y0 = Math.max(r.top, b.top);
      const y1 = Math.min(r.bottom, b.bottom);
      for (let i = 0; i <= 4; i += 1)
        for (let j = 0; j <= 4; j += 1) {
          const x = x0 + ((x1 - x0) * (i + 0.5)) / 5.5;
          const y = y0 + ((y1 - y0) * (j + 0.5)) / 5.5;
          if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
          const ici = document.elementFromPoint(x, y);
          if (ici && (o === ici || o.contains(ici))) return true;
        }
      return false;
    };
    const tour = () => {
      const maison = document.querySelector(".rt-mascotte[data-scene]");
      const nom = maison ? maison.dataset.scene : "(hors scène)";
      let vus = 0;
      for (const s of document.querySelectorAll(".rt-ain-sprite")) {
        if (s.hidden || !s.dataset.serre) continue;
        vus += 1;
        const c = s.getBoundingClientRect();
        const [x0, y0, x1, y1] = s.dataset.serre.split(" ").map(Number);
        const r = { left: c.left + x0, top: c.top + y0, right: c.left + x1, bottom: c.top + y1 };
        const qui = `${nom} (${s.dataset.acteur})`;
        const toile = document.querySelector("#screen");
        const peintes = globalThis.nel3abTest?.counters?.().painted ?? 0;
        const cadre = document.querySelector("[data-cadre]");
        const image = cadre?.getAttribute("data-sans-image") !== "oui" && peintes > 0;
        if (toile && image && coupe(r, toile.getBoundingClientRect())) etat.fautes[`${qui} sur l'image`] = 1;
        for (const o of document.querySelectorAll(AUTRES)) {
          if (o.closest("[data-hote]")) continue;
          const b = o.getBoundingClientRect();
          if (b.width < 1 || b.height < 1 || o.closest("details:not([open]) > :not(summary)")) continue;
          if (coupe(r, b) && seVoit(o, r, b)) {
            const nomO = o.id ? `#${o.id}` : o.tagName.toLowerCase();
            etat.fautes[`${qui} sur ${nomO} « ${(o.textContent ?? "").trim().slice(0, 30)} »`] = 1;
          }
        }
      }
      if (maison) {
        etat.scenes[nom] = (etat.scenes[nom] ?? 0) + 1;
        const lieu = `#${maison.closest("[id]")?.id ?? "?"}`;
        etat.lieux[lieu] = (etat.lieux[lieu] ?? 0) + 1;
        etat.images += 1;
      } else if (vus > 0) etat.hors += 1;
      requestAnimationFrame(tour);
    };
    requestAnimationFrame(tour);
  };

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
      await page.evaluate(() => document.getElementById("leurre-cadre")?.remove());
      // Les calques décoratifs ne prennent pas le pointeur (la neige, un
      // voile, la mascotte, le décor de borne). Une garde qui ne lit que
      // `elementFromPoint` ne les voit pas (relecture du 23 novembre 2026) :
      // un leurre d'une demi-image sans pointeur, puis un voile noir à 50 %
      // sur toute la fenêtre, doivent être vus chacun.
      for (const [id, style] of [
        ["leurre-sans-pointeur", { left: "30%", top: "30%", width: "30%", height: "30%", background: "red" }],
        ["voile-plein", { left: "0", top: "0", width: "100vw", height: "100vh", background: "black", opacity: "0.5" }],
      ]) {
        await page.evaluate(
          (id, style) => {
            const calque = document.createElement("div");
            calque.id = id;
            Object.assign(calque.style, { position: "fixed", zIndex: "50", pointerEvents: "none" }, style);
            document.body.append(calque);
          },
          id,
          style,
        );
        const sans = await gardeDeLImage(page, { images: 5 });
        if (!sans.some((f) => f.includes(id))) throw new Defaut(`${id} (sans pointeur) n'est pas vu: ${sans}`);
        await page.evaluate((id) => document.getElementById(id)?.remove(), id);
      }
      // Une boîte qui ne peint rien (celle de la manette tenue en main) ne
      // couvre pas l'image ; l'enfant peint qu'elle pose dessus, si.
      await page.evaluate(() => {
        const boite = document.createElement("div");
        boite.id = "boite-vide";
        Object.assign(boite.style, { position: "fixed", inset: "0", zIndex: "50", pointerEvents: "none" });
        const enfant = document.createElement("div");
        enfant.id = "enfant-peint";
        Object.assign(enfant.style, { position: "absolute", left: "45%", top: "45%", width: "40px", height: "40px", background: "red" });
        boite.append(enfant);
        document.body.append(boite);
      });
      const boite = await gardeDeLImage(page, { images: 5 });
      if (!boite.some((f) => f.includes("enfant-peint"))) throw new Defaut(`l'enfant peint n'est pas vu: ${boite}`);
      if (boite.some((f) => f.includes("boite-vide"))) throw new Defaut(`une boîte qui ne peint rien est vue: ${boite}`);
      await page.evaluate(() => document.getElementById("boite-vide")?.remove());
      await page.evaluate(() => {
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
        // L'avis de fermeture de 03b21c0, ou la pastille d'état qui le
        // remplace depuis le 24 novembre 2026 (ADR D40).
        const ferme = '#closingNotice, #pastilleEtat[data-etat="fermeture"]';
        if (!(await jusqua(() => page.$(ferme).then(Boolean), 4000)))
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

    /** colonne.1 et en-jeu-clavier.6: le panneau de commande est sous l'image
     * quand le cadre l'y met (`data-panneau="sous"`), au pied de la colonne
     * sinon. Sous l'image, il ne la touche pas, prend toute la largeur de
     * l'écran et la hauteur que le cadre lui donne, et l'image peinte a la
     * taille que le cadre a calculée sans lui. Le jumeau: les deux formes
     * doivent apparaître dans le balayage, sinon il ne prouve rien. */
    async "meuble-place"() {
      const vues = new Set();
      const fautes = [];
      for (const vue of BUREAUX) {
        const page = await nouvelle(vue);
        await entrer(page);
        await sleep(300);
        const lu = await page.evaluate(() => {
          const racine = document.querySelector("[data-cadre]");
          const forme = racine?.dataset.panneau ?? null;
          const v = (nom) => Number.parseFloat(getComputedStyle(racine).getPropertyValue(nom)) || 0;
          const panneau = document.querySelector("#panneau");
          const image = document.querySelector("#screen").getBoundingClientRect();
          const p = panneau?.getBoundingClientRect() ?? null;
          const main = document.querySelector("main").getBoundingClientRect();
          return {
            forme,
            dansMain: Boolean(panneau?.closest("main")),
            dansColonne: Boolean(panneau?.closest("#side")),
            formeDuPanneau: panneau?.dataset.forme ?? null,
            image: { x: image.left, y: image.top, w: image.width, h: image.height },
            attendue: {
              w: v("--cadre-image-largeur"),
              h: v("--cadre-image-hauteur"),
              p: v("--cadre-panneau-hauteur"),
            },
            p: p ? { x: p.left, y: p.top, w: p.width, h: p.height } : null,
            main: { x: main.left, w: main.width, bas: main.bottom },
          };
        });
        const ici = `${vue.width}×${vue.height}`;
        vues.add(lu.forme);
        if (lu.forme === "sous") {
          if (!lu.dansMain || lu.formeDuPanneau !== "sous") fautes.push(`${ici}: panneau « sous » hors de l'écran`);
          else {
            if (lu.p.y < lu.image.y + lu.image.h - 0.5) fautes.push(`${ici}: le panneau monte sur l'image`);
            if (Math.abs(lu.p.w - lu.main.w) > 1) fautes.push(`${ici}: panneau de ${lu.p.w} px pour un écran de ${lu.main.w}`);
            if (Math.abs(lu.p.h - lu.attendue.p) > 1) fautes.push(`${ici}: panneau de ${lu.p.h} px, le cadre en donne ${lu.attendue.p}`);
            if (Math.abs(lu.p.y + lu.p.h - lu.main.bas) > 1) fautes.push(`${ici}: le panneau n'est pas au pied de l'écran`);
          }
        } else if (lu.forme === "colonne") {
          if (!lu.dansColonne || lu.formeDuPanneau !== "colonne")
            fautes.push(`${ici}: panneau « colonne » absent de la colonne`);
        } else fautes.push(`${ici}: forme inattendue ${lu.forme}`);
        if (Math.abs(lu.image.w - lu.attendue.w) > 1 || Math.abs(lu.image.h - lu.attendue.h) > 1)
          fautes.push(`${ici}: image de ${lu.image.w}×${lu.image.h}, le cadre l'attend à ${lu.attendue.w}×${lu.attendue.h}`);
        await capture(page, `meuble-${lu.forme}`);
        await page.close();
      }
      // Les fautes d'abord: une page sans panneau du tout doit tomber sur son
      // défaut, pas sur le jumeau.
      verdict(fautes);
      if (!vues.has("sous") || !vues.has("colonne"))
        throw new Precondition(`le balayage ne montre pas les deux formes: ${[...vues].join(", ")}`);
    },

    /** colonne.6: une chose, une fois. Quitter, le bloc de rôle, chaque place,
     * Signaler et les mesures n'existent qu'une fois dans la page, et un
     * identifiant n'est porté que par un élément. */
    async "une-fois"() {
      const fautes = [];
      for (const vue of [
        { width: 1280, height: 800 },
        { width: 1440, height: 900 },
      ]) {
        const page = await nouvelle(vue);
        await entrer(page);
        const lu = await page.evaluate(() => {
          const compte = (sel) => document.querySelectorAll(sel).length;
          const ids = {};
          for (const el of document.querySelectorAll("[id]")) ids[el.id] = (ids[el.id] ?? 0) + 1;
          const visibles = (texte) =>
            [...document.querySelectorAll("button, a, summary")].filter(
              (el) => el.getClientRects().length > 0 && (el.textContent ?? "").trim() === texte,
            ).length;
          return {
            doubles: Object.entries(ids).filter(([, n]) => n > 1).map(([id]) => id),
            quitter: compte("#leaveRoom"),
            quitterTexte: visibles("Quitter la salle"),
            seat: compte("#seat"),
            places: [1, 2, 3, 4].map((n) => compte(`#port${n}`)),
            signaler: [...document.querySelectorAll("button")].filter(
              (b) => b.getClientRects().length > 0 && /^Signaler/.test((b.textContent ?? "").trim()),
            ).length,
            mesures: compte("#mesures"),
            onglets: compte("#mode-details, #mode-normal"),
          };
        });
        const ici = `${vue.width}×${vue.height}`;
        if (lu.doubles.length) fautes.push(`${ici}: identifiants portés deux fois: ${lu.doubles.join(", ")}`);
        if (lu.quitter !== 1 || lu.quitterTexte !== 1) fautes.push(`${ici}: Quitter ${lu.quitter} fois (${lu.quitterTexte} visibles)`);
        if (lu.seat !== 1) fautes.push(`${ici}: bloc de rôle ${lu.seat} fois`);
        if (lu.places.some((n) => n !== 1)) fautes.push(`${ici}: places ${lu.places.join("/")}`);
        if (lu.signaler > 1) fautes.push(`${ici}: Signaler visible ${lu.signaler} fois`);
        if (lu.mesures !== 1) fautes.push(`${ici}: ligne des mesures ${lu.mesures} fois`);
        if (lu.onglets !== 0) fautes.push(`${ici}: les onglets essentiel et mesures sont encore là`);
        await page.close();
      }
      verdict(fautes);
    },

    /** en-jeu-clavier.7: un seul bouton plein par vue. Le joueur en partie
     * n'en a aucun dans la colonne; le spectateur en a exactement un,
     * « Prendre une place ». */
    async "un-plein"() {
      const pleins = (page) =>
        page.evaluate(() =>
          [...document.querySelectorAll(".rt-bouton-plein")]
            .filter((el) => el.getClientRects().length > 0)
            .map((el) => (el.textContent ?? "").trim()),
        );
      const fautes = [];
      const joueur = await nouvelle({ width: 1440, height: 900 });
      await entrer(joueur);
      const vusJoueur = await pleins(joueur);
      if (vusJoueur.length > 1) fautes.push(`joueur: ${vusJoueur.length} boutons pleins (${vusJoueur.join(", ")})`);
      // Rendre sa place, et regarder: le bloc de rôle offre alors la sienne.
      // Centrés avant le clic, pour deux raisons nées le 23 novembre 2026.
      // Depuis les places START (chantier personnes), la colonne déborde à
      // 1440 × 900, et l'avis « Le jeu ne reçoit plus tes touches », né du
      // premier clic, pousse la colonne de 110 px entre le calcul du point et
      // le clic : le clic tombait à côté de « Rendre ma place ». Depuis que la
      // maison d'Aïn agrandit le coin (chantier mascotte), le résumé arrive au
      // pied de la colonne, là où « Plus bas » est collé, et le clic ne
      // l'ouvrait plus (« Node is either not clickable » sur #watchOnly).
      // Sans le centrage, l'étape échouait sur sa précondition.
      for (const cible of ["#autresReglages > summary", "#watchOnly"]) {
        await joueur.$eval(cible, (e) => e.scrollIntoView({ block: "center" }));
        await sleep(200);
        await joueur.click(cible);
      }
      if (!(await jusqua(() => joueur.$("#takePad").then(Boolean), 5000)))
        throw new Precondition("après « Rendre ma place », pas de « Prendre une place »");
      const vusSpectateur = await pleins(joueur);
      if (vusSpectateur.length !== 1) fautes.push(`spectateur: ${vusSpectateur.length} boutons pleins (${vusSpectateur.join(", ")})`);
      await capture(joueur, "un-plein-spectateur");
      await joueur.close();
      verdict(fautes);
    },

    /** salle-repos.1: une salle sans jeu n'ouvre rien d'office. Pour qui
     * choisit: 3 s après l'entrée, aucun dialogue ouvert, le focus sur
     * « Choisir un jeu », et Entrée ouvre le menu. Le jumeau, pour qui ne
     * choisit pas: aucun « Choisir un jeu », et l'écran nomme qui choisit. */
    async "repos-sans-menu"() {
      const fautes = [];
      const page = await nouvelle({ width: 1440, height: 900 }, { salle: { jeu: null, chef: "moi", decide: true } });
      await entrerAuRepos(page);
      await sleep(3000);
      const lu = await page.evaluate(() => ({
        ouverts: [...document.querySelectorAll("dialog[open]")].map((d) => d.id || d.className),
        menu: document.querySelector("#menu") !== null,
        focus: document.activeElement?.id ?? "",
        // Le rayonnage du chantier menus prend le focus d'entrée sur sa
        // première cartouche, à la place de « Choisir un jeu » (K23).
        cartouche: document.activeElement === document.querySelector("#rayonnage [data-jeu]"),
        titre: document.querySelector("#idle-room h2")?.textContent ?? "",
      }));
      if (lu.ouverts.length > 0 || lu.menu) fautes.push(`au repos, un dialogue s'ouvre seul: ${lu.ouverts.join(", ") || "#menu"}`);
      if (lu.focus !== "choisirJeu" && !lu.cartouche)
        fautes.push(`le focus d'entrée est sur « ${lu.focus || "body"} », ni sur la première cartouche ni sur « Choisir un jeu »`);
      if (!/Pas encore de jeu/.test(lu.titre)) fautes.push(`l'écran éteint ne dit pas « Pas encore de jeu »: « ${lu.titre.slice(0, 60)} »`);
      await capture(page, "repos-choisit");
      if (lu.focus === "choisirJeu") {
        await page.keyboard.press("Enter");
        if (!(await jusqua(() => page.$("#menu").then(Boolean), 3000))) fautes.push("Entrée sur « Choisir un jeu » n'ouvre pas le menu");
      } else if (lu.cartouche) {
        await page.keyboard.press("Enter");
        if (!(await jusqua(() => page.$("#ficheJeu").then(Boolean), 3000))) fautes.push("Entrée sur la première cartouche n'ouvre pas sa fiche");
      }
      await page.close();
      const autre = await nouvelle({ width: 1440, height: 900 }, { salle: { jeu: null, chef: "bo", decide: false } });
      await entrerAuRepos(autre);
      await sleep(1500);
      const vu = await autre.evaluate(() => {
        // salle-repos.3: une chose, une fois. Les textes rendus qui disent qui
        // choisit, et le titre de l'écran éteint, comptés par nœud de texte.
        const fois = (motif) => {
          const marche = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n = 0;
          for (let t = marche.nextNode(); t; t = marche.nextNode())
            if (motif.test(t.textContent ?? "") && t.parentElement?.getClientRects().length) n += 1;
          return n;
        };
        return {
          bouton: document.querySelector("#choisirJeu") !== null,
          phrase: document.querySelector("#idle-room")?.textContent ?? "",
          chef: fois(/choisit le jeu/),
          titre: fois(/Pas encore de jeu/),
        };
      });
      if (vu.chef !== 1) fautes.push(`« choisit le jeu » rendu ${vu.chef} fois au repos`);
      if (vu.titre !== 1) fautes.push(`« Pas encore de jeu » rendu ${vu.titre} fois au repos`);
      if (vu.bouton) fautes.push("qui ne choisit pas voit « Choisir un jeu »");
      if (!/Bo choisit le jeu/.test(vu.phrase)) fautes.push(`l'écran ne nomme pas qui choisit: « ${vu.phrase.slice(0, 80)} »`);
      await capture(autre, "repos-regarde");
      await autre.close();
      verdict(fautes);
    },

    /** salle-repos.6: la scène « attente » joue sur le plateau, puis s'arrête.
     * Vers 3 s, la mascotte est sur le plateau; à 20 s, plus aucune animation
     * n'y tourne. Le jumeau est la première mesure: sans elle, un plateau
     * vide passerait la seconde. */
    async "repos-attention"() {
      const page = await nouvelle({ width: 1440, height: 900 }, { salle: { jeu: null, chef: "moi", decide: true } });
      const debut = Date.now();
      await entrerAuRepos(page);
      // Aucun geste pendant l'étape: un pointeur ou une touche arrête la boucle.
      // La scène d'Aïn se lit sur sa maison (`data-scene`), le temps qu'elle
      // joue ; hors scène, rien ne doit tourner.
      const plateau = () =>
        page.evaluate(() => {
          const p = document.querySelector('[data-hote="plateau"]');
          if (!p) return null;
          const vivantes = p.getAnimations({ subtree: true }).filter((a) => a.playState === "running");
          const sprites = [...document.querySelectorAll(".rt-ain-sprite")].filter((s) => !s.hidden).length;
          return {
            enfants: p.children.length,
            // Une scène d'Aïn : sa maison dit son nom tant qu'elle joue.
            scene: p.querySelector("[data-scene]") ? 1 : 0,
            sprites,
            css: vivantes.map((a) => a.animationName ?? "animation"),
          };
        });
      let pendant = null;
      const vue = await jusqua(async () => {
        pendant = await plateau();
        return (pendant?.scene ?? 0) > 0;
      }, 6000, 50);
      if (!vue) throw new Precondition(`la scène « attente » ne joue jamais sur le plateau (${JSON.stringify(pendant)})`);
      const fin = debut + 20000 - Date.now();
      if (fin > 0) await sleep(fin);
      const apres = await plateau();
      if (apres === null) throw new Precondition("le plateau a disparu");
      await capture(page, "repos-attention");
      await page.close();
      if (apres.scene > 0) throw new Defaut("une scène joue encore sur le plateau à 20 s");
      // Aïn ne tourne que pendant une scène (K15 levé avec la pièce) : à
      // 20 s, ni animation, ni sprite dehors.
      if (apres.css.length > 0) throw new Defaut(`animations encore vivantes à 20 s: ${apres.css.join(", ")}`);
      if (apres.sprites > 0) throw new Defaut(`${apres.sprites} sprites d'Aïn encore visibles à 20 s`);
    },

    /** L'effet « fronton » : le titre du jeu dans la bande noire du haut
     * quand elle fait 40 px ou plus, jamais sur l'image, son bas à 2 px au
     * moins au-dessus d'elle. Le jumeau: sans bande, aucun #fronton et le nom
     * du jeu une fois dans l'en-tête de la colonne. Les deux cas doivent
     * apparaître dans le balayage. */
    async "fronton-bande"() {
      const fautes = [];
      const vus = { avec: 0, sans: 0 };
      for (const vue of [...BUREAUX, { width: 1024, height: 768 }, { width: 1366, height: 1024 }]) {
        const page = await nouvelle(vue);
        await entrer(page);
        // Une toile sans taille (vue une fois à 1920×1080, le temps d'une
        // pose) n'a pas de bande à mesurer: une précondition, pas un verdict.
        const posee = () => page.evaluate(() => document.querySelector("#screen").getBoundingClientRect().height > 0);
        if (!(await jusqua(posee, 3000))) throw new Precondition(`${vue.width}×${vue.height}: la toile n'a pas de taille`);
        await sleep(400);
        const lu = await page.evaluate(() => {
          const r = (el) => {
            const b = el.getBoundingClientRect();
            return { x: b.left, y: b.top, w: b.width, h: b.height };
          };
          const fronton = document.querySelector("#fronton");
          const image = r(document.querySelector("#screen"));
          const zone = r(document.querySelector("#zone-jeu"));
          const tete = document.querySelector("#side header")?.textContent ?? "";
          return {
            fronton: fronton ? { ...r(fronton), texte: fronton.textContent ?? "" } : null,
            image,
            dessus: image.y - zone.y,
            tete,
            avis: document.querySelector("#avisDuCadre")?.getBoundingClientRect().height ?? 0,
            // L'ancre de l'annonce du socle : une seule, sur la ligne du titre.
            ancres: [...document.querySelectorAll('[data-ancre="annonce"]')].map((a) =>
              a.closest("#fronton") ? "fronton" : a.closest("#side header") ? "colonne" : (a.closest("[id]")?.id ?? "?"),
            ),
          };
        });
        const ici = `${vue.width}×${vue.height}`;
        const ancre = lu.fronton ? "fronton" : "colonne";
        if (lu.ancres.join() !== ancre)
          fautes.push(`${ici}: ancres de l'annonce [${lu.ancres.join(", ")}], attendu [${ancre}]`);
        if (lu.fronton) {
          vus.avec += 1;
          const f = lu.fronton;
          const coupe = f.x < lu.image.x + lu.image.w && lu.image.x < f.x + f.w && f.y < lu.image.y + lu.image.h && lu.image.y < f.y + f.h;
          if (coupe) fautes.push(`${ici}: le fronton coupe l'image`);
          if (f.y + f.h > lu.image.y - 2 + 0.5) fautes.push(`${ici}: le bas du fronton (${f.y + f.h}) est à moins de 2 px de l'image (${lu.image.y})`);
          if (!/Mario Party 4/.test(f.texte)) fautes.push(`${ici}: le fronton ne dit pas le jeu (« ${f.texte} »)`);
          if (/Mario Party 4/.test(lu.tete)) fautes.push(`${ici}: le nom du jeu est aussi dans l'en-tête de la colonne`);
        } else if (lu.dessus >= 40 && lu.avis === 0) {
          fautes.push(`${ici}: ${Math.round(lu.dessus)} px au-dessus de l'image et pas de fronton (${JSON.stringify(lu.image)})`);
        } else if (lu.dessus < 40) {
          vus.sans += 1;
          const fois = (lu.tete.match(/Mario Party 4/g) ?? []).length;
          if (fois !== 1) fautes.push(`${ici}: sans fronton, l'en-tête dit le jeu ${fois} fois`);
        }
        if (lu.fronton) await capture(page, "fronton");
        await page.close();
      }
      // Les fautes d'abord: une page sans l'effet n'a aucun cas « avec », et
      // doit rougir sur son défaut, pas sur le jumeau.
      verdict(fautes);
      if (vus.avec === 0 || vus.sans === 0)
        throw new Precondition(`le balayage n'a pas vu les deux cas (avec ${vus.avec}, sans ${vus.sans})`);
    },

    /** L'effet « credit » (K02) : « places libres N » au bout du panneau, et
     * N baisse d'un en moins d'une seconde quand une autre page prend une
     * place. */
    async "credit-compte"() {
      const page = await nouvelle({ width: 1440, height: 900 });
      await entrer(page);
      const lire = () =>
        page.evaluate(() => {
          const el = document.querySelector("#credit");
          return el ? { texte: el.textContent ?? "", cache: el.getAttribute("aria-hidden"), dansPanneau: Boolean(el.closest("#panneau")) } : null;
        });
      const avant = await lire();
      if (avant === null) throw new Defaut("aucun crédit dans le panneau");
      if (!avant.dansPanneau) throw new Defaut("le crédit n'est pas dans le panneau de commande");
      if (avant.cache !== "true") throw new Defaut("le crédit n'est pas caché au lecteur d'écran");
      const n = Number(avant.texte.match(/(\d+)/)?.[1] ?? Number.NaN);
      if (!Number.isFinite(n)) throw new Defaut(`le crédit ne dit pas de nombre: « ${avant.texte} »`);
      const autre = await browser.newPage();
      await autre.setViewport({ width: 1280, height: 800 });
      await autre.goto(banc.url, { waitUntil: "domcontentloaded" });
      await autre.waitForSelector("#enter, #screen", { timeout: 15000 });
      if (await autre.$("#enter")) await autre.click("#enter");
      const pris = Date.now();
      const baisse = await jusqua(async () => (await lire())?.texte.includes(String(n - 1)) ?? false, 6000, 50);
      if (!baisse) throw new Defaut(`le crédit reste à ${n} après l'arrivée d'une autre page`);
      const ms = Date.now() - pris;
      await capture(page, "credit");
      await autre.close();
      console.log(JSON.stringify({ note: `credit-compte: ${n} puis ${n - 1} en ${ms} ms après l'entrée de l'autre page` }));
    },

    /** Le temps de jeu au bout du panneau, tiré de l'âge que le salon
     * publie (`Room.partie.depuis_s`, ADR D43) : l'afficheur dit 00:12:3x,
     * le texte caché dit « 12 min de jeu », et l'horloge bat. Les jumeaux :
     * un salon sans jalons, puis un worker qui sert son menu, ne montrent
     * aucun temps (un temps compté depuis l'arrivée de la page mentirait). */
    async "temps-de-jeu"() {
      const lire = (page) =>
        page.evaluate(() => {
          const el = document.querySelector("#tempsDeJeu");
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            valeur: el.querySelector(".rt-afficheur-valeur")?.textContent ?? "",
            lisible: el.querySelector(".sr-only")?.textContent ?? "",
            cache: el.querySelector(".rt-afficheur")?.closest("[aria-hidden='true']") !== null,
            dansPanneau: Boolean(el.closest("#panneau")),
            vu: r.width > 0 && r.height > 0,
          };
        });
      for (const [nom, partie] of [
        ["salon sans jalons", null],
        ["worker au menu", { lance: false, image: false, depuis_s: 754 }],
      ]) {
        const page = await nouvelle({ width: 1440, height: 900 }, { salle: { partie } });
        await entrer(page);
        await sleep(1200);
        if ((await lire(page)) !== null) throw new Defaut(`${nom}: un temps de jeu est affiché`);
        await page.close();
      }
      const page = await nouvelle({ width: 1440, height: 900 }, { salle: { partie: { lance: true, image: true, depuis_s: 754 } } });
      await entrer(page);
      if (!(await jusqua(async () => (await lire(page)) !== null, 4000)))
        throw new Defaut("aucun temps de jeu alors que le salon publie l'âge de la partie");
      const lu = await lire(page);
      if (!lu.dansPanneau || !lu.vu) throw new Defaut("le temps de jeu n'est pas visible dans le panneau de commande");
      if (!/^00:1[23]:\d\d$/.test(lu.valeur)) throw new Defaut(`l'afficheur dit « ${lu.valeur} », pas 00:12:3x`);
      if (!lu.cache) throw new Defaut("l'afficheur n'est pas caché au lecteur d'écran");
      if (!/^1[23] min de jeu$/.test(lu.lisible)) throw new Defaut(`le texte lisible dit « ${lu.lisible} »`);
      if (!(await jusqua(async () => (await lire(page))?.valeur !== lu.valeur, 2500)))
        throw new Defaut(`l'horloge ne bat pas : « ${lu.valeur} » pendant 2,5 s`);
      verdict(await garder(page, "1440×900 temps de jeu"));
      await capture(page, "temps-de-jeu");
      await page.close();
    },

    /** L'effet « tramage » : la zone de jeu porte la trame, la toile a son
     * fond opaque, et rien de la trame ne se voit dans le rectangle de
     * l'image. */
    async "tramage-hors-image"() {
      const page = await nouvelle({ width: 1024, height: 768 });
      await entrer(page);
      const lu = await page.evaluate(() => ({
        trame: getComputedStyle(document.querySelector("#zone-jeu")).backgroundImage,
        toile: getComputedStyle(document.querySelector("#screen")).backgroundColor,
      }));
      if (!/conic-gradient/.test(lu.trame)) throw new Defaut(`la zone de jeu ne porte pas la trame (${lu.trame})`);
      if (!/^rgb\(/.test(lu.toile) || /rgba\(.*, 0\)/.test(lu.toile))
        throw new Defaut(`la toile n'a pas de fond opaque (${lu.toile})`);
      verdict(await garder(page, "1024×768 tramage"));
      await page.close();
    },

    /** L'effet « borne » (niveau tout) : le décor dans les bandes latérales
     * de 72 px ou plus, jamais dans l'image, et l'image a la même taille avec
     * et sans lui. Le jumeau: sans bande assez large, aucun décor. */
    /** Étape 4 : la salle tenue en main. Au doigt, tenue droite puis en
     * travers, et une tablette tenue droite, avec la manette à l'écran :
     * rien ne se pose sur l'image, et aucune pièce de la manette ne la
     * coupe. Contre la page de cf3bba1, la manette se pose PAR-DESSUS
     * l'écran, et sa croix tombe sur l'image d'une tablette de 768×1024
     * (vu le 23 novembre 2026). La précondition : la manette montée, et
     * l'image peinte. */
    async "tenu-rien-sur-image"() {
      const fautes = [];
      for (const vue of [
        { width: 390, height: 844, isMobile: true, hasTouch: true },
        { width: 844, height: 390, isMobile: true, hasTouch: true },
        { width: 768, height: 1024, isMobile: true, hasTouch: true },
      ]) {
        const page = await nouvelle(vue);
        await entrer(page);
        if (!(await jusqua(() => page.$(".n3-pave").then(Boolean), 4000)))
          throw new Precondition(`${vue.width}×${vue.height}: la manette à l'écran n'est pas montée`);
        await sleep(400);
        fautes.push(...(await garder(page, `${vue.width}×${vue.height} tenue en main`)));
        const coupes = await page.evaluate(() => {
          const t = document.querySelector("#screen").getBoundingClientRect();
          return [...document.querySelectorAll(".n3-pave > *, [data-geste]")]
            .map((el) => {
              const r = el.getBoundingClientRect();
              const w = Math.min(r.right, t.right) - Math.max(r.left, t.left);
              const h = Math.min(r.bottom, t.bottom) - Math.max(r.top, t.top);
              return w > 0.5 && h > 0.5 ? (el.dataset.touche ?? el.dataset.geste ?? el.id) : null;
            })
            .filter(Boolean);
        });
        if (coupes.length) fautes.push(`${vue.width}×${vue.height}: sur l'image : ${coupes.join(", ")}`);
        // L'ancre de l'annonce : une seule, dans la barre, sinon la bande ;
        // aucune en travers avec la manette, où ni l'une ni l'autre n'existe.
        const ancres = await page.evaluate(() =>
          [...document.querySelectorAll('[data-ancre="annonce"]')].map((a) => a.closest("[id]")?.id ?? "?"),
        );
        const attendue = (await page.$("#barreSalle")) ? "barreSalle" : (await page.$("#bande")) ? "bande" : "";
        if (ancres.join() !== attendue)
          fautes.push(`${vue.width}×${vue.height}: ancres de l'annonce [${ancres.join(", ")}], attendu [${attendue}]`);
        await capture(page, "tenu-rien-sur-image");
        await page.close();
      }
      verdict(fautes);
    },

    /** en-jeu-tactile.5, tenu droit : sans panneau, ton étiquette tapée se
     * pose dans le creux de la manette (375×548, GameCube puis Xbox 360) :
     * visible, dans la boîte de la manette, hors de l'image, à 6 px au moins
     * de chaque touche et de « La salle », avec ton numéro, rien au-dessus
     * d'elle. Les jumeaux, à 390×844 et 360×740 : le panneau porte tes
     * places, aucune étiquette n'est dans la manette (une chose, une fois),
     * et l'étiquette de ta place START se lit, sans rien d'une autre place
     * ni de la phrase d'aide par-dessus (relecture du 24 novembre 2026 : la
     * phrase écrasait la rangée, et « 2P » couvrait ton nom). Le panneau de
     * chaque cas est affirmé, pas lu pour choisir quoi vérifier. */
    async "etiquette-manette"() {
      const fautes = [];
      for (const cas of [
        { nom: "375×548 GameCube", vue: { width: 375, height: 548 }, salle: {}, panneau: false, lieu: "fente" },
        { nom: "375×548 Xbox 360", vue: { width: 375, height: 548 }, salle: { jeu: 1 }, panneau: false, lieu: "fente" },
        { nom: "390×844", vue: { width: 390, height: 844 }, salle: {}, panneau: true, nomSurLaPlace: true, lieu: null },
        { nom: "360×740", vue: { width: 360, height: 740 }, salle: {}, panneau: true, nomSurLaPlace: true, lieu: null },
      ])
        fautes.push(...(await verifierEtiquette(cas)));
      verdict(fautes);
    },

    /** en-jeu-tactile.5, en travers : la relecture du 24 novembre 2026 n'y
     * voyait ni panneau ni étiquette à 568×320, 667×375 et 740×360 en
     * GameCube, et à 932×430 en Xbox 360. Chaque taille dit où se lit ta
     * place sur le banc (image 4:3) : sous « La salle » au-dessus de la
     * grappe gauche (« cote »), en tête de la bande quand le panneau n'a que
     * ses lampes (« bande »), ou sur la rangée du panneau (aucune étiquette).
     * 568×320 en Xbox 360 n'y est pas : la manette Pro y demande deux grappes
     * de 308 px, et le cadre n'y laisse aucune image (défaut à part,
     * remonté le même jour). */
    async "etiquette-travers"() {
      const fautes = [];
      const travers = (width, height) => ({ width, height });
      for (const cas of [
        { nom: "568×320 GameCube", vue: travers(568, 320), salle: {}, panneau: false, lieu: "bande" },
        { nom: "667×375 GameCube", vue: travers(667, 375), salle: {}, panneau: false, lieu: "bande" },
        { nom: "667×375 Xbox 360", vue: travers(667, 375), salle: { jeu: 1 }, panneau: true, nomSurLaPlace: false, lieu: null },
        { nom: "740×360 GameCube", vue: travers(740, 360), salle: {}, panneau: false, lieu: "cote" },
        { nom: "740×360 Xbox 360", vue: travers(740, 360), salle: { jeu: 1 }, panneau: true, nomSurLaPlace: false, lieu: null },
        { nom: "844×390 GameCube", vue: travers(844, 390), salle: {}, panneau: false, lieu: "cote" },
        { nom: "844×390 Xbox 360", vue: travers(844, 390), salle: { jeu: 1 }, panneau: true, nomSurLaPlace: false, lieu: null },
        { nom: "932×430 GameCube", vue: travers(932, 430), salle: {}, panneau: false, lieu: "cote" },
        { nom: "932×430 Xbox 360", vue: travers(932, 430), salle: { jeu: 1 }, panneau: false, lieu: "cote" },
      ])
        fautes.push(...(await verifierEtiquette(cas)));
      verdict(fautes);
    },

    /** K13 : « Quitter la salle » part par la transition « sortir-salle »
     * (mosaïque au niveau « tout », fondu en « sobre »), et l'image est
     * cachée AVANT que la transition ne commence : rien ne passe sur une
     * image vivante. Le jumeau : en mouvement réduit, la page part d'un coup,
     * sans transition. Jusqu'à la relecture du 23 novembre 2026, Quitter
     * partait sans transition. Ce qui se voit est écrit dans le stockage de
     * session à chaque changement : la sortie peut recharger la page. */
    async "sortir-salle"() {
      const fautes = [];
      for (const cas of [
        { niveau: "tout", attendu: "filtre" },
        { niveau: "sobre", attendu: "voile" },
        { niveau: "tout", attendu: "rien", reduit: true },
      ]) {
        const nom = `${cas.niveau}${cas.reduit ? ", mouvement réduit" : ""}`;
        const page = await nouvelle({ width: 1440, height: 900 }, { niveau: cas.niveau });
        if (cas.reduit) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
        await entrer(page);
        await page.evaluate(() => {
          sessionStorage.removeItem("sortie");
          const vus = [];
          const lire = () => {
            const zone = document.querySelector("[data-zone-jeu]");
            const filtre = [document.body, document.querySelector("#root")].some((el) => el && /url\(/.test(el.style.filter));
            const voile = document.querySelector(".rt-voile, .rt-tuiles") !== null;
            const cachee = zone === null || getComputedStyle(zone).visibility === "hidden";
            const ici = `${filtre ? "filtre" : ""}${voile ? "voile" : ""}|${cachee ? "cachee" : "vue"}`;
            if (vus.at(-1) !== ici) {
              vus.push(ici);
              sessionStorage.setItem("sortie", JSON.stringify(vus));
            }
          };
          new MutationObserver(lire).observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["style", "data-transition-image", "class"],
          });
          lire();
        });
        await page.click("#leaveRoom");
        // La page quitte la salle : l'avant-salle, ou le salon du banc.
        const partie = await jusqua(
          () => page.evaluate(() => document.querySelector("[data-zone-jeu]") === null).catch(() => false),
          5000,
        );
        await sleep(800);
        if (!partie) throw new Precondition(`${nom}: Quitter ne quitte pas la salle`);
        const vus = JSON.parse((await page.evaluate(() => sessionStorage.getItem("sortie"))) ?? "[]");
        console.log(JSON.stringify({ sortie: nom, vus }));
        const transition = vus.filter((v) => !v.startsWith("|"));
        if (cas.attendu === "rien") {
          if (transition.length) fautes.push(`${nom}: une transition en mouvement réduit (${transition.join(", ")})`);
        } else {
          if (!transition.some((v) => v.startsWith(cas.attendu)))
            fautes.push(`${nom}: Quitter part sans la transition « sortir-salle » (${vus.join(" → ")})`);
          const surImage = transition.filter((v) => v.endsWith("|vue"));
          if (surImage.length) fautes.push(`${nom}: la transition passe sur l'image visible (${surImage.join(", ")})`);
        }
        await page.close();
      }
      verdict(fautes);
    },

    /** La manette à l'écran réglée sur « toujours », à la souris. Jusqu'à
     * la relecture du 23 novembre 2026, elle se posait par-dessus l'image
     * vivante au bureau et en fenêtre étroite : onze pièces sur elle à
     * 1280×720, contre la règle du propriétaire (« jamais rien sur une image
     * vivante »). Le cadre lui réserve sa place hors de l'image, comme au
     * doigt. À trois tailles : la garde de l'image, aucune pièce sur elle,
     * une pose sans faute, et « La salle » parmi les touches (il déplie la
     * colonne repliée, salle-telephone partie 13). La précondition : la
     * manette montée. */
    async "souris-toujours"() {
      const fautes = [];
      for (const vue of [
        { width: 1280, height: 720 },
        { width: 1440, height: 900 },
        { width: 820, height: 900 },
      ]) {
        const nom = `${vue.width}×${vue.height}`;
        const page = await nouvelle(vue, { stockage: { "nel3ab:touchpad": "on" } });
        await entrer(page);
        if (!(await jusqua(() => page.$("#touchpad, .n3-pave").then(Boolean), 4000)))
          throw new Precondition(`${nom}: la manette « toujours » n'est pas montée`);
        await sleep(400);
        fautes.push(...(await garder(page, `${nom} manette « toujours »`)));
        const lu = await page.evaluate(() => {
          const t = document.querySelector("#screen").getBoundingClientRect();
          const pave = document.querySelector("#touchpad, .n3-pave");
          return {
            coupes: [...pave.querySelectorAll(":scope > *, [data-geste]")]
              .map((el) => {
                const r = el.getBoundingClientRect();
                const w = Math.min(r.right, t.right) - Math.max(r.left, t.left);
                const h = Math.min(r.bottom, t.bottom) - Math.max(r.top, t.top);
                return w > 0.5 && h > 0.5 ? (el.dataset.touche ?? el.dataset.geste ?? el.id ?? el.className) : null;
              })
              .filter(Boolean),
            degradee: pave.dataset.degradee ?? null,
            salle: pave.querySelector('[data-geste="feuille"]') !== null,
            image: `${Math.round(t.width)}×${Math.round(t.height)}`,
          };
        });
        console.log(JSON.stringify({ souris: nom, image: lu.image }));
        if (lu.coupes.length) fautes.push(`${nom}: sur l'image : ${lu.coupes.join(", ")}`);
        if (lu.degradee) fautes.push(`${nom}: la pose de la manette est dégradée (${lu.degradee})`);
        if (!lu.salle) fautes.push(`${nom}: « La salle » manque parmi les touches`);
        await capture(page, "souris-toujours");
        await page.close();
      }
      verdict(fautes);
    },

    /** en-jeu-manette.2 (audit N1) : une vraie manette branchée à 390×844,
     * les touches à l'écran gardées (« toujours »). Pendant 6 s depuis que la
     * page a vu la manette, le centre de L rend L : l'avis de branchement de
     * la page d'avant le couvrait cinq secondes. La bande dit ensuite quelle
     * manette joue, et à quelle place. */
    async "manette-branchee"() {
      const fautes = [];
      const page = await nouvelle(
        { width: 390, height: 844, isMobile: true, hasTouch: true },
        { manette: true, stockage: { "nel3ab:touchpad": "on" } },
      );
      await entrer(page);
      const L = '.n3-pave [data-touche="L"]';
      if (!(await jusqua(() => page.$(L).then(Boolean), 4000)))
        throw new Precondition("la touche L n'est pas montée");
      const vue = () =>
        page.evaluate(() => /connectée/.test(document.querySelector("#controller-status")?.textContent ?? ""));
      if (!(await jusqua(vue, 4000))) throw new Precondition("la page n'a pas vu la manette simulée");
      const dessus = new Set();
      let tours = 0;
      const fin = Date.now() + 6000;
      while (Date.now() < fin) {
        tours += 1;
        const ici = await page.evaluate((sel) => {
          const l = document.querySelector(sel);
          const r = l.getBoundingClientRect();
          const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          if (el && (el === l || l.contains(el))) return null;
          const lieu = el?.closest("[id]");
          return el ? `${el.tagName.toLowerCase()}${lieu ? ` dans #${lieu.id}` : ""}` : "rien";
        }, L);
        if (ici) dessus.add(ici);
        await sleep(100);
      }
      if (tours < 20) throw new Precondition(`seulement ${tours} relevés de L en 6 s`);
      if (dessus.size) fautes.push(`L couverte par ${[...dessus].join(", ")}`);
      const bande = await page.evaluate(() => document.querySelector("#bande")?.textContent ?? "");
      if (!/manette Xbox joue à la place \d/.test(bande))
        fautes.push(`la bande ne dit pas quelle manette joue (« ${bande.slice(0, 80)} »)`);
      await capture(page, "manette-branchee");
      // Le câblage des deux gestes de la bande, touchés pour de vrai. Les
      // touches à l'écran, réglées sur « toujours », se cachent (et
      // reviennent à l'automatique, que la manette branchée efface).
      // Chaque geste absent est une faute : derrière un `if`, deux gestes
      // retirés laissaient l'étape verte (relecture du 23 novembre 2026).
      if (!(await page.$("#manetteTactile"))) fautes.push("la bande n'a pas le bouton des commandes tactiles");
      else {
        await page.tap("#manetteTactile");
        if (!(await jusqua(() => page.$(".n3-pave").then((un) => un === null), 3000)))
          fautes.push("« Les commandes tactiles » ne cache pas les touches à l'écran");
      }
      // « Vérifier les boutons » ouvre la vue de la manette dans la salle
      // entière.
      if (!(await page.$("#verifierManette"))) fautes.push("la bande n'a pas « Vérifier les boutons »");
      else {
        await page.tap("#verifierManette");
        const ouverte = await jusqua(
          () =>
            page.evaluate(
              () =>
                document.querySelector('#feuilleSalle[data-hauteur="agrandie"] #vueTouches')?.textContent?.includes(
                  "manette Xbox",
                ) ?? false,
            ),
          3000,
        );
        if (!ouverte) fautes.push("« Vérifier les boutons » n'ouvre pas la vue de la manette dans la feuille agrandie");
      }
      await page.close();
      verdict(fautes);
    },

    /** en-jeu-manette.4 : une vraie manette, les touches à l'écran en
     * automatique. Tenu droit (390×844) : aucune touche à l'écran, l'image
     * sur toute la largeur, le conseil de tourner le téléphone. En travers
     * (844×390) : l'image sur toute la hauteur, le panneau dans la bande
     * gauche, sans conseil. Le jumeau : la même page, manette débranchée,
     * monte ses touches et retire le conseil. */
    async "manette-vraie"() {
      const fautes = [];
      for (const vue of [
        { width: 390, height: 844, isMobile: true, hasTouch: true },
        { width: 844, height: 390, isMobile: true, hasTouch: true },
      ]) {
        const nom = `${vue.width}×${vue.height}`;
        const droit = vue.height > vue.width;
        const page = await nouvelle(vue, { manette: true });
        await entrer(page);
        const vue2 = () =>
          page.evaluate(() => /connectée/.test(document.querySelector("#controller-status")?.textContent ?? ""));
        if (!(await jusqua(vue2, 4000))) throw new Precondition(`${nom}: la page n'a pas vu la manette simulée`);
        await sleep(600);
        const lire = () =>
          page.evaluate(() => {
            const t = document.querySelector("#screen").getBoundingClientRect();
            const p = document.querySelector(".n3-panneau-tenu")?.getBoundingClientRect() ?? null;
            return {
              pave: document.querySelector(".n3-pave") !== null,
              conseil: document.querySelector("#tourneTelephone") !== null,
              bande: document.querySelector("#manetteBande") !== null,
              x: t.x,
              w: t.width,
              h: t.height,
              panneauDroite: p ? p.right : null,
              W: innerWidth,
              H: innerHeight,
            };
          });
        const lu = await lire();
        if (lu.pave) fautes.push(`${nom}: des touches à l'écran avec une vraie manette`);
        if (!lu.bande) fautes.push(`${nom}: la bande ne dit pas la manette`);
        if (droit) {
          if (Math.abs(lu.w - lu.W) > 1) fautes.push(`${nom}: image de ${lu.w} px de large sur ${lu.W}`);
          if (!lu.conseil) fautes.push(`${nom}: pas de conseil de tourner le téléphone`);
        } else {
          if (Math.abs(lu.h - lu.H) > 1) fautes.push(`${nom}: image de ${lu.h} px de haut sur ${lu.H}`);
          if (lu.conseil) fautes.push(`${nom}: conseil de tourner un téléphone déjà en travers`);
          if (lu.panneauDroite === null || lu.panneauDroite > lu.x + 0.5)
            fautes.push(`${nom}: le panneau n'est pas dans la bande gauche (${lu.panneauDroite} contre ${lu.x})`);
        }
        await capture(page, "manette-vraie");
        // Le jumeau : débranchée, les touches reviennent, le conseil part.
        await page.evaluate(() => window.__brancher(false));
        const revenue = await jusqua(
          () => lire().then((un) => un.pave && !un.conseil && !un.bande),
          4000,
        );
        if (!revenue) fautes.push(`${nom}: manette débranchée, les touches ne reviennent pas (${JSON.stringify(await lire())})`);
        await page.close();
      }
      verdict(fautes);
    },

    /** Le ▶ du socle dans la feuille à mi-hauteur : devant chaque entrée
     * visée, sans couvrir aucune entrée ni sortir de la feuille, deux
     * colonnes tenues droit jusqu'à 360 px, une en travers. Jusqu'au
     * 24 novembre 2026, la grille n'avait que 4 px entre deux entrées et la
     * feuille n'avait pas de ▶. Le jumeau : le focus sur « Fermer », hors
     * des entrées, cache le ▶. */
    async "feuille-curseur"() {
      const fautes = [];
      for (const vue of [
        { width: 390, height: 844, isMobile: true, hasTouch: true },
        { width: 360, height: 740, isMobile: true, hasTouch: true },
        { width: 844, height: 390, isMobile: true, hasTouch: true },
      ]) {
        const nom = `${vue.width}×${vue.height}`;
        const page = await nouvelle(vue);
        await entrer(page);
        const ouvre = (await page.$("#laSalle")) ? "#laSalle" : "#laSalleCote";
        if (!(await page.$(ouvre))) throw new Precondition(`${nom}: pas de bouton « La salle »`);
        await page.tap(ouvre);
        if (!(await jusqua(() => page.$('#feuilleSalle[data-hauteur="mi"]').then(Boolean), 3000)))
          throw new Precondition(`${nom}: la feuille ne s'ouvre pas à mi-hauteur`);
        const entrees = await page.$$eval("#feuilleSalle .n3-feuille-entree", (els) => els.length);
        if (entrees < 2) throw new Precondition(`${nom}: ${entrees} entrée à mi-hauteur`);
        const colonnes = await page.$$eval("#feuilleSalle .n3-feuille-entree", (els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
        if (vue.height > vue.width && colonnes !== 2) fautes.push(`${nom}: ${colonnes} colonne(s) d'entrées, deux attendues`);
        for (let i = 0; i < entrees; i++) {
          await page.$$eval("#feuilleSalle .n3-feuille-entree", (els, i) => els[i].focus(), i);
          await sleep(200);
          const lu = await page.evaluate((i) => {
            const boite = (el) => {
              const r = el.getBoundingClientRect();
              return { x: r.left, y: r.top, w: r.width, h: r.height };
            };
            const coupe = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
            const fleche = document.querySelector("#feuilleSalle .rt-curseur");
            const els = [...document.querySelectorAll("#feuilleSalle .n3-feuille-entree")];
            const visee = boite(els[i]);
            const f = fleche ? boite(fleche) : null;
            const vue = f !== null && fleche.hasAttribute("data-visible") && f.w > 0;
            const d = boite(document.querySelector("#feuilleSalle"));
            return {
              titre: els[i].textContent,
              vue,
              devant: vue && f.x + f.w <= visee.x + 0.5 && f.x + f.w >= visee.x - 12 && f.y + f.h / 2 > visee.y && f.y + f.h / 2 < visee.y + visee.h,
              sur: vue ? els.filter((e) => coupe(f, boite(e))).map((e) => e.textContent) : [],
              dedans: vue && f.x >= d.x - 0.5 && f.x + f.w <= d.x + d.w + 0.5,
            };
          }, i);
          if (i === 1) await capture(page, "feuille-curseur-seconde");
          const ici = `${nom}, « ${lu.titre} »`;
          if (!lu.vue) fautes.push(`${ici}: pas de ▶`);
          else {
            if (!lu.devant) fautes.push(`${ici}: le ▶ n'est pas devant l'entrée visée`);
            if (lu.sur.length) fautes.push(`${ici}: le ▶ couvre ${lu.sur.join(", ")}`);
            if (!lu.dedans) fautes.push(`${ici}: le ▶ sort de la feuille`);
          }
        }
        // Le jumeau : le focus sur « Fermer », hors des entrées, et le ▶ se cache.
        await page.focus("#fermerFeuille");
        await sleep(200);
        const reste = await page.evaluate(() => document.querySelector("#feuilleSalle .rt-curseur")?.hasAttribute("data-visible") ?? false);
        if (reste) fautes.push(`${nom}: le ▶ reste quand le focus quitte les entrées`);
        await capture(page, "feuille-curseur");
        await page.close();
      }
      verdict(fautes);
    },

    /** feuille-du-bas.2 : pendant une partie, la feuille à mi-hauteur d'un
     * téléphone tenu droit garde les 45 dernières secondes à un toucher, sur
     * une cible de 44 px hors de l'image. Le toucher atteint le geste du clip
     * (le banc ne sert pas de clip : l'entrée dit alors qu'il a raté). Le
     * jumeau : en travers, la feuille n'a pas l'entrée, qui la faisait
     * défiler. */
    async "feuille-clip"() {
      const fautes = [];
      for (const vue of [
        { width: 390, height: 844, isMobile: true, hasTouch: true },
        { width: 844, height: 390, isMobile: true, hasTouch: true },
      ]) {
        const nom = `${vue.width}×${vue.height}`;
        const page = await nouvelle(vue);
        await entrer(page);
        const ouvre = (await page.$("#laSalle")) ? "#laSalle" : "#laSalleCote";
        if (!(await page.$(ouvre))) throw new Precondition(`${nom}: pas de bouton « La salle »`);
        await page.tap(ouvre);
        if (!(await jusqua(() => page.$('#feuilleSalle[data-hauteur="mi"]').then(Boolean), 3000)))
          throw new Precondition(`${nom}: la feuille ne s'ouvre pas à mi-hauteur`);
        const lu = await page.evaluate(() => {
          const e = document.querySelector('#feuilleSalle [data-entree="clip"]');
          if (!e) return null;
          const r = e.getBoundingClientRect();
          const t = document.querySelector("#screen").getBoundingClientRect();
          const dessus = Math.min(r.bottom, t.bottom) - Math.max(r.top, t.top) > 0.5 &&
            Math.min(r.right, t.right) - Math.max(r.left, t.left) > 0.5;
          const ici = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { h: r.height, dessus, touche: ici === e || e.contains(ici), texte: e.textContent };
        });
        if (vue.height > vue.width) {
          if (!lu) fautes.push(`${nom}: pas d'entrée du clip à mi-hauteur`);
          else {
            if (lu.h < 44) fautes.push(`${nom}: entrée du clip de ${lu.h} px`);
            if (lu.dessus) fautes.push(`${nom}: l'entrée du clip est sur l'image`);
            if (!lu.touche) fautes.push(`${nom}: l'entrée du clip ne reçoit pas son appui`);
            if (!/45 dernières secondes/.test(lu.texte)) fautes.push(`${nom}: l'entrée dit « ${lu.texte} »`);
            await page.tap('#feuilleSalle [data-entree="clip"]');
            const repondu = await jusqua(
              () =>
                page.evaluate(
                  () => !/45 dernières/.test(document.querySelector('#feuilleSalle [data-entree="clip"]')?.textContent ?? "45 dernières"),
                ),
              5000,
            );
            if (!repondu) fautes.push(`${nom}: toucher l'entrée du clip ne demande rien`);
          }
        } else if (lu) fautes.push(`${nom}: une entrée du clip dans la feuille en travers`);
        await capture(page, "feuille-clip");
        await page.close();
      }
      verdict(fautes);
    },

    /** colonne.2 : pendant chaque scène que la mascotte joue dans le cadre,
     * à chaque image d'écran, sa boîte ne coupe ni l'image, ni un contrôle,
     * ni la ligne d'état. Quatre cas : premiere-image au bureau (deux
     * tailles) et au téléphone, attente au repos. Le jumeau : une mascotte
     * posée sur l'image par l'essai est vue. */
    /** Aïn (ADR D46) joue chaque scène de la salle dans le vrai cadre, sur
     * l'hôte que la mise en page lui donne : le logo du coin au bureau, la
     * tête dans la barre ou dans « La salle » au téléphone, le plateau de
     * l'écran noir au repos. Image par image, la boîte serrée de chaque
     * sprite (`data-serre`, celle que le planificateur a vérifiée) ne touche
     * ni l'image peinte, ni un contrôle, ni un mot, pendant les scènes et
     * entre elles (`SONDE_AIN`). Au bureau, la maison doit être en vue avant
     * la première scène : au pied d'une colonne qui débordait, elle était
     * sous le bas de la fenêtre, et les deux cas du bureau ne pouvaient pas
     * échouer (relecture du 24 novembre 2026). Au repos, le plateau joue
     * pour qui choisit le jeu (un bouton) et pour qui le regarde choisir
     * (une phrase). Deux jumeaux rouges : l'image glissée sous le logo
     * pendant une scène, et un sprite posé sur la phrase de l'écran éteint
     * hors de toute scène ; la sonde doit voir les deux. */
    async "mascotte-hors-image"() {
      const sonde = SONDE_AIN;
      const lire = (page) => page.evaluate(() => window.__mascotte);
      const SALLE = [
        "arrivee", "spectateur", "depart", "attente", "attente-chargement", "chercher", "rebrancher",
        "arret", "hoquet", "coupe", "decroche", "redemarre", "endort", "pret", "fier", "dort",
      ];
      /** Joue chaque scène l'une après l'autre, chacune jusqu'à sa fin. */
      let refus = {};
      const jouerTout = async (page, hote) => {
        refus = {};
        const versions = {};
        for (const scene of SALLE) {
          versions[scene] = await page.evaluate(
            (s, h) => window.nel3abAin?.jouer(s, h, { joueur: "2", mode: "tous" }) ?? "sans-crochet",
            scene,
            hote,
          );
          await jusqua(() => page.evaluate(() => !document.querySelector(".rt-mascotte[data-scene]")), 4000, 30);
          refus[scene] = await page.evaluate(
            (h) => document.querySelector(`[data-hote="${h}"] .rt-mascotte, [data-hote="coin"] > .rt-mascotte`)?.dataset.refus ?? "",
            hote,
          );
          await sleep(60);
        }
        return versions;
      };
      const fautes = [];
      let sansCrochet = false;
      const telephone = { width: 390, height: 844, isMobile: true, hasTouch: true };
      const cas = [
        { nom: "1280×720", vue: { width: 1280, height: 720 }, salle: {}, hote: "coin" },
        { nom: "1440×900", vue: { width: 1440, height: 900 }, salle: {}, hote: "coin" },
        { nom: "390×844", vue: telephone, salle: {}, hote: "barre" },
        // Sans barre, la tête passe dans « La salle » : seul en travers
        // (#laSalleCote), parmi les touches tenu droit sur un écran court
        // (#laSalleManette).
        { nom: "844×390", vue: { width: 844, height: 390, isMobile: true, hasTouch: true }, salle: {}, hote: "barre", exige: "#laSalleCote" },
        { nom: "375×548", vue: { width: 375, height: 548, isMobile: true, hasTouch: true }, salle: {}, hote: "barre", exige: "#laSalleManette" },
        { nom: "1440×900 au repos", vue: { width: 1440, height: 900 }, salle: { jeu: null, chef: "moi", decide: true }, hote: "plateau", repos: true },
        { nom: "1440×900 au repos, qui regarde", vue: { width: 1440, height: 900 }, salle: { jeu: null, chef: "bo", decide: false }, hote: "plateau", repos: true, phrase: true },
      ];
      for (const un of cas) {
        const page = await nouvelle(un.vue, { salle: un.salle });
        await page.evaluateOnNewDocument(sonde);
        if (un.repos) await entrerAuRepos(page);
        else await entrer(page);
        if (un.exige) {
          if (await page.$("#barreSalle")) throw new Precondition(`${un.nom}: la barre est montée`);
          if (!(await page.$(un.exige))) throw new Precondition(`${un.nom}: ${un.exige} n'est pas monté`);
          // Sans hôte, aucune scène ne jouait (relecture du 23 novembre
          // 2026) : c'est le défaut que la page de référence rouge montre.
          if (!(await page.$(`${un.exige} [data-hote="barre"]`))) {
            fautes.push(`${un.nom}: pas de tête d'Aïn dans ${un.exige}, aucune scène n'y joue`);
            await page.close();
            continue;
          }
        }
        if (!(await page.$(`[data-hote="${un.hote}"]`))) throw new Precondition(`${un.nom}: pas d'hôte « ${un.hote} »`);
        if (un.phrase && !(await page.$("#idle-room p"))) throw new Precondition(`${un.nom}: l'écran éteint n'a pas de phrase`);
        if (un.hote === "coin") {
          await sleep(300);
          const vue = await page.evaluate(() => {
            const logo = document.querySelector('[data-hote="coin"] > canvas');
            if (!logo) return null;
            const r = logo.getBoundingClientRect();
            const side = document.querySelector("#side")?.getBoundingClientRect();
            const dans = r.top >= 0 && r.bottom <= innerHeight && (!side || (r.top >= side.top && r.bottom <= side.bottom));
            return { dans, haut: Math.round(r.top), bas: Math.round(r.bottom), fenetre: innerHeight };
          });
          if (vue && !vue.dans)
            fautes.push(`${un.nom}: la maison d'Aïn est hors de vue (logo ${vue.haut} à ${vue.bas}, fenêtre ${vue.fenetre})`);
        }
        const versions = await jouerTout(page, un.hote);
        if (Object.values(versions).includes("sans-crochet")) {
          // Une page d'avant Aïn : rien à jouer ici, mais les hôtes se
          // vérifient quand même (la page de référence rouge).
          sansCrochet = true;
          await page.close();
          continue;
        }
        const lu = await lire(page);
        if (un.exige) {
          // La tête vit dans le bouton « La salle » : ses mots ne se couvrent
          // pas, donc Aïn n'en sort pas en sprite. Le planificateur doit
          // l'avoir refusé à cause de ce bouton (et non joué ailleurs).
          if (!Object.values(refus).some((r) => r.includes(un.exige)))
            fautes.push(`${un.nom}: le planificateur n'a jamais vu ${un.exige} (${JSON.stringify(refus)})`);
          if (lu?.images && !lu.lieux[un.exige])
            fautes.push(`${un.nom}: la scène joue dans ${Object.keys(lu.lieux).join(", ")}, pas dans ${un.exige}`);
        } else if (!lu || lu.images === 0) fautes.push(`${un.nom}: aucune scène vue sur l'hôte « ${un.hote} »`);
        console.log(JSON.stringify({ cas: un.nom, scenes: Object.keys(lu?.scenes ?? {}).length, images: lu?.images, lieux: lu?.lieux }));
        if (process.env.N3_AIN_REFUS) console.log(JSON.stringify({ cas: un.nom, versions, refus }));
        fautes.push(...Object.keys(lu?.fautes ?? {}).map((f) => `${un.nom}: ${f}`));
        await capture(page, `mascotte-${un.repos ? "repos" : un.nom}`);
        await page.close();
      }
      if (sansCrochet) {
        if (fautes.length === 0) throw new Precondition("la page n'expose pas nel3abAin");
        verdict(fautes);
        return;
      }
      // Le jumeau rouge : l'image glisse sous le logo pendant une scène ;
      // la sonde doit voir Aïn dessus.
      const page = await nouvelle({ width: 1440, height: 900 });
      await page.evaluateOnNewDocument(sonde);
      await entrer(page);
      await page.evaluate(() => window.nel3abAin?.jouer("fier", "coin", {}));
      await sleep(250);
      await page.evaluate(() => {
        const logo = document.querySelector('[data-hote="coin"] > canvas').getBoundingClientRect();
        const t = document.querySelector("#screen");
        Object.assign(t.style, { position: "fixed", left: `${logo.left - 40}px`, top: `${logo.top - 120}px`, width: "400px", height: "240px" });
      });
      await sleep(400);
      const essai = await lire(page);
      await page.close();
      if (!Object.keys(essai?.fautes ?? {}).some((f) => f.includes("sur l'image")))
        throw new Precondition(`la sonde ne voit pas Aïn posé sur l'image (${JSON.stringify(essai)})`);
      // Le second jumeau : hors de toute scène, un sprite posé à la main sur
      // la phrase de l'écran éteint. La sonde regarde aussi entre deux scènes,
      // et les mots de l'écran même sans marque.
      const mots = await nouvelle({ width: 1440, height: 900 }, { salle: { jeu: null, chef: "bo", decide: false } });
      await mots.evaluateOnNewDocument(sonde);
      await entrerAuRepos(mots);
      await sleep(300);
      const pose = await mots.evaluate(() => {
        const p = document.querySelector("#idle-room p")?.getBoundingClientRect();
        const s = document.querySelector(".rt-ain-sprite");
        if (!p || !s || document.querySelector("[data-scene]")) return false;
        Object.assign(s, { hidden: false, width: 20, height: 20 });
        s.dataset.serre = "0 0 20 20";
        s.style.transform = `translate(${p.left + p.width / 2}px, ${p.top}px)`;
        return true;
      });
      if (!pose) throw new Precondition("jumeau des mots : pas de phrase ou pas de sprite hors scène");
      await sleep(300);
      const vuMot = await mots.evaluate(() => window.__mascotte);
      await mots.close();
      if (!Object.keys(vuMot?.fautes ?? {}).some((f) => f.startsWith("(hors scène)") && f.includes(" sur p ")))
        throw new Precondition(`la sonde ne voit pas un sprite posé sur la phrase hors scène (${JSON.stringify(vuMot?.fautes)})`);
      verdict(fautes);
    },

    /** Rien ne tourne entre deux scènes d'Aïn, dans la vraie page (ADR
     * D46). Au repos, hors scène, deux secondes sans aucun appel à
     * requestAnimationFrame et sans animation en cours dans une maison
     * d'Aïn ou son calque. La page en fait d'autres au repos : la pompe des
     * manettes (`pumpOnRefresh`, 62 par seconde mesurés le 23 novembre
     * 2026). Un appel est donc compté pour Aïn par le texte de son rappel,
     * qui nomme la boucle d'une scène (`.tick(`) ou le regard qui suit le
     * pointeur (`.regarder(`) : des noms de méthode, que le minifieur garde.
     * Le jumeau dit si ce tri voit encore la boucle. Une fenêtre où une
     * scène commence est jetée (le plateau
     * joue « attente » à 2,5 s, 8,5 s et 14,5 s). Le jumeau : pendant une
     * scène, le compteur monte. La planche mesure la même chose sur chaque
     * maison (`just planche-garde`, mesure « immobile »). */
    async "ain-immobile"() {
      const compteur = () => {
        const etat = { appels: 0, autres: 0, scenes: 0 };
        window.__raf = etat;
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (f) => {
          if (/\.(tick|regarder)\(/.test(String(f))) etat.appels += 1;
          else etat.autres += 1;
          return raf(f);
        };
        // Chaque scène qui commence : sa maison reçoit `data-scene`.
        new MutationObserver((ms) => {
          for (const m of ms) if (m.target.hasAttribute?.("data-scene")) etat.scenes += 1;
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-scene"] });
      };
      const page = await nouvelle({ width: 1440, height: 900 }, { salle: { jeu: null, chef: "moi", decide: true } });
      await page.evaluateOnNewDocument(compteur);
      await entrerAuRepos(page);
      const lire = () =>
        page.evaluate(() => ({
          appels: window.__raf.appels,
          scenes: window.__raf.scenes,
          joue: !!document.querySelector("[data-scene]"),
          css: document
            .getAnimations()
            .filter((a) => a.playState === "running" && a.effect?.target?.closest?.("[data-hote], .rt-ain-calque"))
            .map((a) => a.animationName ?? String(a.effect.target.className)),
        }));
      /** Une fenêtre de deux secondes sans scène, mesurée. */
      const fenetre = async (nom) => {
        for (let essai = 0; essai < 8; essai += 1) {
          await jusqua(async () => !(await lire()).joue, 6000, 50);
          await sleep(300);
          await page.evaluate(() => {
            window.__raf.appels = 0;
            window.__raf.autres = 0;
          });
          const avant = await lire();
          await sleep(2000);
          const apres = await lire();
          if (apres.scenes !== avant.scenes || apres.joue) continue;
          const autres = await page.evaluate(() => window.__raf.autres);
          console.log(JSON.stringify({ etape: "ain-immobile", fenetre: nom, appels: apres.appels, autres, css: apres.css }));
          return apres;
        }
        throw new Precondition(`${nom} : aucune fenêtre de deux secondes sans scène`);
      };
      const fautes = [];
      const juger = (nom, f) => {
        if (f.appels > 0) fautes.push(`${nom} : ${f.appels} appels à requestAnimationFrame en 2 s hors scène`);
        if (f.css.length > 0) fautes.push(`${nom} : animations en cours hors scène (${[...new Set(f.css)].join(", ")})`);
      };
      juger("au repos", await fenetre("au repos"));
      // Une page qui tourne déjà sans scène tombe ici, sur son défaut.
      verdict(fautes);
      // Le jumeau : une scène d'Aïn, et le compteur monte. Une scène qui
      // cède (deux images à plus de 50 ms, sous la charge) finit avant
      // 400 ms : on attend la suivante, le plateau en joue trois.
      let pendant = null;
      for (let essai = 0; essai < 3; essai += 1) {
        const vue = await jusqua(async () => (await lire()).joue, 12000, 20);
        if (!vue) throw new Precondition("aucune scène ne joue au repos en 12 s");
        await page.evaluate(() => {
          window.__raf.appels = 0;
        });
        await sleep(400);
        pendant = await lire();
        if (pendant.joue || pendant.appels >= 10) break;
        await jusqua(async () => !(await lire()).joue, 6000, 50);
      }
      if (pendant.appels < 10)
        throw new Precondition(`pendant une scène, ${pendant.appels} appels en 400 ms : le compteur ne voit pas la boucle`);
      juger("après une scène", await fenetre("après une scène"));
      await page.close();
      // Le jumeau de la mesure : la même page, où la boucle d'une scène se
      // redemande sans fin (le défaut qu'un essai du lecteur et la planche
      // attrapent aussi, rouge le 23 novembre 2026 avec un lecteur mutant).
      // La fenêtre d'après doit compter ses appels.
      const mutante = await nouvelle({ width: 1440, height: 900 }, { salle: { jeu: null, chef: "moi", decide: true } });
      await mutante.evaluateOnNewDocument(compteur);
      await mutante.evaluateOnNewDocument(() => {
        // Dès la première scène, une boucle qui rappelle la dernière image
        // demandée, à chaque image d'écran, pour toujours.
        const compte = window.requestAnimationFrame;
        let derniere = null;
        const encore = (t) => {
          derniere?.(t);
          compte(encore);
        };
        encore.toString = () => "() => this.tick(n)";
        window.requestAnimationFrame = (f) => {
          if (!/\.tick\(/.test(String(f))) return compte(f);
          if (derniere === null) compte(encore);
          derniere = f;
          return 0;
        };
      });
      await entrerAuRepos(mutante);
      const lireM = () => mutante.evaluate(() => ({ joue: !!document.querySelector("[data-scene]") }));
      if (!(await jusqua(async () => (await lireM()).joue, 12000, 20)))
        throw new Precondition("jumeau : aucune scène ne joue au repos en 12 s");
      await jusqua(async () => !(await lireM()).joue, 6000, 50);
      await sleep(300);
      const vus = await mutante.evaluate(async () => {
        window.__raf.appels = 0;
        await new Promise((r) => setTimeout(r, 1000));
        return window.__raf.appels;
      });
      await mutante.close();
      if (vus < 10) throw new Precondition(`jumeau : une boucle qui ne s'arrête pas donne ${vus} appels en 1 s`);
      console.log(JSON.stringify({ etape: "ain-immobile", jumeau: "boucle sans fin", appels_en_1_s: vus }));
      verdict(fautes);
    },

    /** La maison d'Aïn en vue (ADR D46, K26) : aux sept tailles de bureau,
     * à l'entrée, colonne défilée en bas puis remontée, le logo du coin tient
     * en entier dans la fenêtre et dans la colonne, et reçoit le point de son
     * centre (rien ne le couvre). Au pied d'une colonne qui défilait, il était
     * hors de vue à cinq tailles sur sept (relecture du 24 novembre 2026).
     * Le coin mesure `HAUTEUR_DU_COIN` (161 px), la marge de défilement que
     * la colonne garde pour lui, et « Autres réglages » ouvert juste au-dessus
     * de lui ne laisse pas « Rendre ma place » dessous. Le jumeau : le pied
     * décollé par l'essai, le logo sort de la vue à 1440 × 900. */
    async "maison-en-vue"() {
      const lire = (page) =>
        page.evaluate(() => {
          const logo = document.querySelector('[data-hote="coin"] > canvas');
          if (!logo) return null;
          const r = logo.getBoundingClientRect();
          const side = document.querySelector("#side")?.getBoundingClientRect() ?? null;
          const dans =
            r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth &&
            (!side || (r.top >= side.top - 0.5 && r.bottom <= side.bottom + 0.5));
          const ici = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.6);
          const coin = document.querySelector("#coin")?.getBoundingClientRect();
          return {
            logo: [r.left, r.top, r.right, r.bottom].map(Math.round),
            dans,
            auPoint: ici === logo,
            coin: coin ? Math.round(coin.height) : null,
            deborde: (() => {
              const c = document.querySelector("#side");
              return c ? c.scrollHeight > c.clientHeight + 1 : false;
            })(),
          };
        });
      const defiler = (page, ou) =>
        page.evaluate((ou) => {
          const c = document.querySelector("#side");
          if (c) c.scrollTop = ou === "bas" ? c.scrollHeight : 0;
        }, ou);
      const fautes = [];
      let debordent = 0;
      for (const vue of BUREAUX) {
        const ici = `${vue.width}×${vue.height}`;
        const page = await nouvelle(vue);
        await entrer(page);
        await sleep(300);
        for (const quand of ["à l'entrée", "colonne en bas", "colonne remontée"]) {
          if (quand === "colonne en bas") await defiler(page, "bas");
          if (quand === "colonne remontée") await defiler(page, "haut");
          await sleep(150);
          const lu = await lire(page);
          if (!lu) {
            fautes.push(`${ici}: pas de logo au coin`);
            break;
          }
          if (quand === "à l'entrée" && lu.deborde) debordent += 1;
          if (!lu.dans) fautes.push(`${ici} ${quand}: le logo est hors de vue (${lu.logo.join(", ")})`);
          else if (!lu.auPoint) fautes.push(`${ici} ${quand}: le logo est couvert`);
          if (quand === "à l'entrée" && lu.coin !== 161)
            fautes.push(`${ici}: le coin mesure ${lu.coin} px, la colonne en garde 161 (HAUTEUR_DU_COIN)`);
        }
        // Le prix du pied collé : ce qui s'ouvre au bas de la colonne ne doit
        // pas rester dessous. « Autres réglages », amené juste au-dessus du
        // pied (le coin, et « Plus bas » quand il s'y pose) puis ouvert d'un
        // vrai clic : « Rendre ma place » reçoit le point de son centre
        // (un-plein, 24 novembre 2026).
        const resume = await page.$("#autresReglages > summary");
        if (resume) {
          await page.evaluate(() => {
            const s = document.querySelector("#autresReglages > summary");
            const c = document.querySelector("#side");
            const pied = document.querySelector("#coin")?.parentElement?.getBoundingClientRect();
            if (!s || !c || !pied) return;
            // Le résumé posé 8 px au-dessus du pied.
            c.scrollTop += s.getBoundingClientRect().bottom - (pied.top - 8);
          });
          await sleep(150);
          await page.click("#autresReglages > summary");
          await sleep(300);
          if (!(await page.$eval("#autresReglages", (d) => d.open)))
            throw new Precondition(`${ici}: le clic n'ouvre pas « Autres réglages »`);
          const recoit = await page.evaluate(() => {
            const b = document.querySelector("#watchOnly");
            if (!b) return null;
            const r = b.getBoundingClientRect();
            const ici = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { oui: ici === b || b.contains(ici), sous: ici?.id || ici?.className || null };
          });
          if (recoit && !recoit.oui) fautes.push(`${ici}: « Autres réglages » ouvert, « Rendre ma place » est sous ${recoit.sous}`);
        }
        await page.close();
      }
      // Sans colonne qui déborde, l'étape ne prouverait rien du pied collé.
      if (debordent === 0) throw new Precondition("aucune taille de bureau ne fait déborder la colonne");
      // Le jumeau : le pied décollé, le logo doit sortir de la vue.
      const page = await nouvelle({ width: 1440, height: 900 });
      await entrer(page);
      await page.addStyleTag({ content: ".n3-colonne-pied { position: static !important; }" });
      await sleep(200);
      const decolle = await lire(page);
      await page.close();
      if (!decolle || decolle.dans)
        throw new Precondition(`jumeau : pied décollé, la sonde voit encore le logo (${JSON.stringify(decolle)})`);
      console.log(JSON.stringify({ etape: "maison-en-vue", debordent, jumeau: decolle.logo }));
      verdict(fautes);
    },

    /** Aïn suit la mise en page (ADR D46). Après « endort » (sa bulle « Z »
     * chez lui) et « decroche » (lui dehors, devant le logo), hors de toute
     * scène : la colonne défile, la fenêtre rétrécit, Ctrl agrandit l'image
     * puis la rend. La sonde (`SONDE_AIN`) regarde à chaque image d'écran,
     * pendant et hors des scènes : rien d'Aïn sur l'image, un contrôle ou un
     * mot. Ses sprites sont posés en coordonnées de la fenêtre ; le
     * 24 novembre 2026, la bulle restait sur l'image agrandie, et Aïn hors
     * de la fenêtre rétrécie. Le jumeau : un sprite posé à la main sur
     * l'image, hors scène, est vu. */
    async "ain-mise-en-page"() {
      const fautes = [];
      for (const vue of [
        { width: 1680, height: 1050 },
        { width: 1440, height: 900 },
      ])
        for (const scene of ["endort", "decroche"]) {
          const ici = `${vue.width}×${vue.height} ${scene}`;
          const page = await nouvelle(vue);
          await page.evaluateOnNewDocument(SONDE_AIN);
          await entrer(page);
          await page.click("#zone-jeu");
          const v = await page.evaluate((s) => window.nel3abAin?.jouer(s, "coin", {}) ?? "sans-crochet", scene);
          if (v === "sans-crochet") throw new Precondition("la page n'expose pas nel3abAin");
          await jusqua(() => page.evaluate(() => !document.querySelector(".rt-mascotte[data-scene]")), 6000, 30);
          await sleep(200);
          const dehors = await page.evaluate(() =>
            [...document.querySelectorAll(".rt-ain-sprite")].filter((x) => !x.hidden).map((x) => x.dataset.acteur),
          );
          if (dehors.length === 0) throw new Precondition(`${ici}: rien d'Aïn ne reste hors du logo après la scène`);
          // La colonne défile (quand elle déborde), d'un bout à l'autre.
          await page.evaluate(() => {
            const c = document.querySelector("#side");
            if (c) c.scrollTop = c.scrollHeight;
          });
          await sleep(300);
          await page.evaluate(() => {
            const c = document.querySelector("#side");
            if (c) c.scrollTop = Math.max(0, c.scrollTop - 300);
          });
          await sleep(300);
          // La fenêtre rétrécit de 300 px, puis revient.
          await page.setViewport({ ...vue, width: vue.width - 300 });
          await sleep(500);
          await page.setViewport(vue);
          await sleep(500);
          // Ctrl agrandit l'image, puis la rend.
          await page.click("#zone-jeu");
          await page.keyboard.down("Control");
          await page.keyboard.up("Control");
          if (!(await jusqua(async () => (await page.$("#side")) === null, 3000)))
            throw new Precondition(`${ici}: Ctrl ne replie pas la colonne`);
          await sleep(600);
          await page.keyboard.down("Control");
          await page.keyboard.up("Control");
          await sleep(600);
          const lu = await page.evaluate(() => window.__mascotte);
          if (!lu || lu.hors === 0) throw new Precondition(`${ici}: la sonde n'a rien vu hors scène`);
          console.log(JSON.stringify({ etape: "ain-mise-en-page", cas: ici, hors: lu.hors, fautes: Object.keys(lu.fautes).length }));
          fautes.push(...Object.keys(lu.fautes).map((f) => `${ici}: ${f}`));
          await page.close();
        }
      // Le jumeau : hors de toute scène, un sprite posé sur l'image.
      const page = await nouvelle({ width: 1440, height: 900 });
      await page.evaluateOnNewDocument(SONDE_AIN);
      await entrer(page);
      await sleep(300);
      const pose = await page.evaluate(() => {
        const t = document.querySelector("#screen")?.getBoundingClientRect();
        const s = document.querySelector(".rt-ain-sprite");
        if (!t || !s || document.querySelector("[data-scene]")) return false;
        Object.assign(s, { hidden: false, width: 20, height: 20 });
        s.dataset.serre = "0 0 20 20";
        s.style.transform = `translate(${t.left + 40}px, ${t.top + 40}px)`;
        return true;
      });
      if (!pose) throw new Precondition("jumeau : pas d'image ou pas de sprite hors scène");
      await sleep(300);
      const vu = await page.evaluate(() => window.__mascotte);
      await page.close();
      if (!Object.keys(vu?.fautes ?? {}).some((f) => f.startsWith("(hors scène)") && f.includes("sur l'image")))
        throw new Precondition(`jumeau : la sonde ne voit pas un sprite posé sur l'image hors scène (${JSON.stringify(vu)})`);
      verdict(fautes);
    },

    /** La pose clé se voit en entier (ADR D46) : en mouvement réduit et au
     * niveau Sobre, elle se lit dans les PIXELS des sprites, pas dans
     * `data-version`. Au coin (1920 × 1080, maison en vue), la bulle de
     * chaque pose qui en a une est peinte au-dessus du logo. Sur le plateau
     * (écran noir), Aïn y est peint immobile, et le logo du coin montre sa
     * place en pointillés. Le 24 novembre 2026, les deux ne montraient rien
     * alors que le logo disait « cle ». Le jumeau : « attente » n'a pas de
     * pose clé, et la même lecture n'y trouve rien. */
    async "ain-pose-cle"() {
      const peints = (page) =>
        page.evaluate(() =>
          [...document.querySelectorAll(".rt-ain-sprite")]
            .filter((x) => !x.hidden)
            .map((x) => {
              // La boîte serrée (`data-serre`) : la toile a des marges vides.
              const r = x.getBoundingClientRect();
              const [x0, y0, x1, y1] = (x.dataset.serre || "0 0 0 0").split(" ").map(Number);
              let plein = 0;
              const d = x.getContext("2d")?.getImageData(0, 0, x.width, x.height).data ?? [];
              for (let i = 3; i < d.length; i += 4) if (d[i] > 0) plein += 1;
              return {
                acteur: x.dataset.acteur,
                plein,
                b: [r.left + x0, r.top + y0, r.left + x1, r.top + y1].map(Math.round),
              };
            }),
        );
      const fautes = [];
      for (const regle of [
        { nom: "mouvement réduit", reduit: true, niveau: "tout" },
        { nom: "Sobre", reduit: false, niveau: "sobre" },
      ]) {
        const page = await nouvelle({ width: 1920, height: 1080 }, { niveau: regle.niveau });
        if (regle.reduit) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
        await entrer(page);
        await sleep(300);
        // En mouvement réduit, `jouer` rend une lecture sans version : le
        // crochet se reconnaît à sa fonction, pas à ce qu'il rend.
        if (!(await page.evaluate(() => typeof window.nel3abAin?.jouer === "function")))
          throw new Precondition("la page n'expose pas nel3abAin");
        for (const scene of ["arrivee", "spectateur", "endort", "arret"]) {
          await page.evaluate((s) => window.nel3abAin.jouer(s, "coin", { joueur: "3" }), scene);
          await sleep(150);
          const logo = await page.evaluate(() => {
            const r = document.querySelector('[data-hote="coin"] > canvas').getBoundingClientRect();
            return [r.left, r.top, r.right, r.bottom];
          });
          const bulle = (await peints(page)).find((x) => x.acteur === "bulle");
          if (!bulle || bulle.plein === 0) fautes.push(`${regle.nom}, coin, ${scene}: pas de bulle peinte`);
          else if (bulle.b[3] > logo[1] + 2 || bulle.b[3] < logo[1] - 60 || bulle.b[0] < logo[0] || bulle.b[2] > logo[2])
            fautes.push(`${regle.nom}, coin, ${scene}: la bulle n'est pas au-dessus du logo (${bulle.b.join(", ")})`);
          await sleep(100);
        }
        await page.close();
        const repos = await nouvelle({ width: 1440, height: 900 }, { niveau: regle.niveau, salle: { jeu: null, chef: "moi", decide: true } });
        if (regle.reduit) await repos.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
        await entrerAuRepos(repos);
        await sleep(500);
        for (const scene of ["dort", "chercher", "arrivee", "attente"]) {
          await repos.evaluate((s) => window.nel3abAin?.jouer(s, "plateau", { joueur: "2" }), scene);
          await sleep(150);
          const vus = await peints(repos);
          const plateau = await repos.evaluate(() => {
            const r = document.querySelector('[data-hote="plateau"]').getBoundingClientRect();
            return { b: [r.left, r.top, r.right, r.bottom], dehors: document.querySelector('[data-hote="coin"] > canvas')?.hasAttribute("data-dehors") };
          });
          const ain = vus.find((x) => x.acteur === "ain");
          if (scene === "attente") {
            // Le jumeau : sans pose clé, rien.
            if (ain) throw new Precondition(`${regle.nom}: « attente » n'a pas de pose clé, et la lecture y voit Aïn`);
            continue;
          }
          if (!ain || ain.plein === 0) fautes.push(`${regle.nom}, plateau, ${scene}: Aïn n'est pas peint`);
          else if (ain.b[0] < plateau.b[0] - 4 || ain.b[2] > plateau.b[2] + 4 || ain.b[3] > plateau.b[3] + 4)
            fautes.push(`${regle.nom}, plateau, ${scene}: Aïn n'est pas sur le plateau (${ain.b.join(", ")} hors de ${plateau.b.map(Math.round).join(", ")})`);
          else if (!plateau.dehors) fautes.push(`${regle.nom}, plateau, ${scene}: le logo du coin garde Aïn aussi`);
        }
        await repos.close();
      }
      verdict(fautes);
    },

    /** Une image vivante, puis arrêtée, puis vivante : le cadre ne bouge
     * pas. À chaque image d'écran, le rectangle de #screen reste le même,
     * rien d'autre que l'image (et son aide cachée) ne vit dans
     * [data-zone-jeu], et aucune animation ne touche l'image ni ce qui la
     * contient. Le jumeau : la même surveillance voit deux pixels de
     * décalage posés par l'essai. Ce qui couvre une image ARRÊTÉE
     * appartient à etats (K20). */
    async "vit-figee-immobile"() {
      const fautes = [];
      for (const vue of [
        { width: 1280, height: 720 },
        { width: 390, height: 844, isMobile: true, hasTouch: true },
      ]) {
        const nom = `${vue.width}×${vue.height}`;
        const page = await nouvelle(vue);
        await entrer(page);
        await sleep(500);
        await page.evaluate(() => {
          window.__surveiller = () => {
            const toile = document.querySelector("#screen");
            const zone = document.querySelector("[data-zone-jeu]");
            const r0 = toile.getBoundingClientRect();
            const etat = { images: 0, etats: {}, fautes: {}, fin: false };
            window.__immobile = etat;
            const tour = () => {
              if (etat.fin) return;
              etat.images += 1;
              const e = document.querySelector("[data-cadre]")?.dataset.etat ?? "?";
              etat.etats[e] = (etat.etats[e] ?? 0) + 1;
              const r = toile.getBoundingClientRect();
              for (const k of ["x", "y", "width", "height"])
                if (Math.abs(r[k] - r0[k]) > 0.5) etat.fautes[`#screen ${k} ${r0[k]} → ${r[k]} (${e})`] = 1;
              for (const el of zone.querySelectorAll("*"))
                if (el !== toile && !el.closest("[hidden]"))
                  etat.fautes[`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} dans la zone de jeu (${e})`] = 1;
              for (const a of document.getAnimations()) {
                const cible = a.effect?.target;
                if (a.playState === "running" && cible && (cible.contains(toile) || zone.contains(cible)))
                  etat.fautes[`animation sur ${cible.id ? `#${cible.id}` : cible.tagName.toLowerCase()} (${e})`] = 1;
              }
              requestAnimationFrame(tour);
            };
            requestAnimationFrame(tour);
          };
          window.__surveiller();
        });
        const etatDuCadre = () => page.evaluate(() => document.querySelector("[data-cadre]")?.dataset.etat);
        await page.evaluate(() => {
          window.__geler = true;
        });
        if (!(await jusqua(async () => (await etatDuCadre()) === "figee", 6000)))
          throw new Precondition(`${nom}: l'image retenue ne passe pas à « figee » (${await etatDuCadre()})`);
        await sleep(4000);
        await page.evaluate(() => {
          window.__geler = false;
        });
        if (!(await jusqua(async () => (await etatDuCadre()) === "vit", 8000)))
          throw new Precondition(`${nom}: l'image ne revient pas (${await etatDuCadre()})`);
        await sleep(1000);
        const lu = await page.evaluate(() => {
          window.__immobile.fin = true;
          return window.__immobile;
        });
        if (!lu.etats.figee || !lu.etats.vit) throw new Precondition(`${nom}: états vus ${JSON.stringify(lu.etats)}`);
        fautes.push(...Object.keys(lu.fautes).map((f) => `${nom}: ${f}`));
        fautes.push(...(await garder(page, `${nom} revenue`)));
        // Le jumeau : la même surveillance voit deux pixels de décalage.
        const jumeau = await page.evaluate(async () => {
          window.__surveiller();
          const toile = document.querySelector("#screen");
          toile.style.transform = "translateX(2px)";
          for (let i = 0; i < 3; i += 1) await new Promise((r) => requestAnimationFrame(() => r()));
          toile.style.transform = "";
          window.__immobile.fin = true;
          return Object.keys(window.__immobile.fautes);
        });
        if (!jumeau.some((f) => f.startsWith("#screen x")))
          throw new Precondition(`${nom}: un décalage posé par l'essai ne se voit pas (${jumeau.join(" ; ")})`);
        await page.close();
      }
      verdict(fautes);
    },

    /** Étape 8 : ce que coûtent les effets, mesuré en alternance. Quatre
     * phases de 60 s, sobre, tout, sobre, tout, chacune sur une page neuve à
     * 1440×900, après 5 s de mise en route. Chaque phase compte les images
     * peintes (le compteur de la page, daté à l'horloge du mur par une
     * boucle d'images d'écran) et le plus long écart entre deux. Pas un
     * verdict : une mesure, écrite au carnet. Hors de la porte (trop longue)
     * : `just cadre-mesure`. */
    async "mesure-effets"() {
      const phases = [];
      for (const niveau of ["sobre", "tout", "sobre", "tout"]) {
        const page = await nouvelle({ width: 1440, height: 900 }, { niveau });
        await entrer(page);
        await sleep(5000);
        const mesure = await page.evaluate(
          (duree) =>
            new Promise((fini) => {
              const lire = () => globalThis.nel3abTest?.counters?.().painted ?? 0;
              const debut = performance.now();
              const premier = lire();
              let dernier = premier;
              let vu = debut;
              let pire = 0;
              const tour = () => {
                const ici = performance.now();
                const n = lire();
                if (n !== dernier) {
                  pire = Math.max(pire, ici - vu);
                  vu = ici;
                  dernier = n;
                }
                if (ici - debut < duree) requestAnimationFrame(tour);
                else
                  fini({
                    images: n - premier,
                    secondes: (ici - debut) / 1000,
                    pireEcartMs: Math.round(pire),
                    niveau: document.documentElement.dataset.effets ?? null,
                  });
              };
              requestAnimationFrame(tour);
            }),
          60_000,
        );
        const phase = {
          niveau,
          lu: mesure.niveau,
          imagesParSeconde: Math.round((mesure.images / mesure.secondes) * 10) / 10,
          pireEcartMs: mesure.pireEcartMs,
          charge: (await import("node:os")).loadavg().map((x) => Math.round(x * 100) / 100),
        };
        console.log(JSON.stringify({ phase }));
        phases.push(phase);
        await page.close();
      }
      if (phases.some((one) => one.imagesParSeconde < 1))
        throw new Precondition(`une phase n'a presque rien peint : ${JSON.stringify(phases)}`);
    },

    async "borne-bandes"() {
      const fautes = [];
      const vus = { avec: 0, sans: 0 };
      for (const vue of BUREAUX) {
        const page = await nouvelle(vue);
        await entrer(page);
        await sleep(300);
        const lu = await page.evaluate(() => {
          const image = document.querySelector("#screen").getBoundingClientRect();
          const zone = document.querySelector("#zone-jeu").getBoundingClientRect();
          const decors = [...document.querySelectorAll(".n3-borne")].map((el) => {
            const b = el.getBoundingClientRect();
            return { x: b.left, y: b.top, w: b.width, h: b.height, vu: getComputedStyle(el).display !== "none" };
          });
          return {
            image: { x: image.left, y: image.top, w: image.width, h: image.height },
            bande: image.left - zone.left,
            zoneH: zone.height,
            decors: decors.map((d, i) => ({ ...d, position: getComputedStyle(document.querySelectorAll(".n3-borne")[i]).position })),
          };
        });
        const ici = `${vue.width}×${vue.height}`;
        if (lu.decors.length > 0) {
          vus.avec += 1;
          if (lu.bande < 72) fautes.push(`${ici}: un décor dans une bande de ${Math.round(lu.bande)} px`);
          for (const d of lu.decors) {
            if (!d.vu) fautes.push(`${ici}: un décor caché au niveau tout`);
            if (d.position !== "absolute") fautes.push(`${ici}: un décor en position ${d.position}, dans le flux de l'écran`);
            const coupe = d.x < lu.image.x + lu.image.w && lu.image.x < d.x + d.w && d.y < lu.image.y + lu.image.h && lu.image.y < d.y + d.h;
            if (coupe) fautes.push(`${ici}: un décor coupe l'image`);
          }
          // La même page sans l'effet: l'image garde sa taille.
          await page.evaluate(() => document.documentElement.classList.remove("fx-borne"));
          await sleep(200);
          const sans = await page.evaluate(() => {
            const r = document.querySelector("#screen").getBoundingClientRect();
            return { w: r.width, h: r.height, zoneH: document.querySelector("#zone-jeu").getBoundingClientRect().height };
          });
          if (Math.abs(sans.w - lu.image.w) > 0.5 || Math.abs(sans.h - lu.image.h) > 0.5 || Math.abs(sans.zoneH - lu.zoneH) > 0.5)
            fautes.push(`${ici}: l'image ou la zone change de taille avec le décor (${lu.image.w}×${lu.image.h}, zone ${lu.zoneH}, contre ${sans.w}×${sans.h}, zone ${sans.zoneH})`);
          await capture(page, "borne");
        } else {
          vus.sans += 1;
          if (lu.bande >= 72) fautes.push(`${ici}: bande de ${Math.round(lu.bande)} px sans décor`);
        }
        await page.close();
      }
      // Les fautes d'abord: une page sans l'effet n'a aucun cas « avec », et
      // doit rougir sur son défaut, pas sur le jumeau.
      verdict(fautes);
      if (vus.avec === 0 || vus.sans === 0)
        throw new Precondition(`le balayage n'a pas vu les deux cas (avec ${vus.avec}, sans ${vus.sans})`);
    },
  };

  /** Les étapes hors de la porte : une mesure de quatre minutes. */
  const HORS_PORTE = new Set(["mesure-effets"]);
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal();
