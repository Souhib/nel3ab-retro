// Les états de la salle, prouvés dans un vrai navigateur contre le banc
// simulé (`etats-banc.mjs`). Lancé par `just etats-navigateur`.
//
// Pourquoi ce pilote existe. Le 21 novembre 2026, l'image de Sonic est restée
// figée vingt minutes, le son continuait, et la page n'a rien dit. La règle qui
// le voit vit dans une fonction pure (`front/src/media/liaison.ts`), mais la
// relecture adverse du 22 novembre a trouvé dans un navigateur cinq défauts
// que ses essais ne voyaient pas: un jeu qui repart à 45 images par seconde
// restait « figé », une socket muette faisait dire « L'image est revenue. », un
// 502 passait pour « le reste du site répond », une salle qui redémarre était
// dite fermée, et une liaison qui cale ne se voyait plus rien proposer. Chaque
// étape ci-dessous en rejoue un, avec son jumeau.
//
// Chaque échec dit s'il porte sur le DÉFAUT nommé ou sur une PRÉCONDITION.
// Un contrôle négatif doit échouer sur le défaut: une page d'avant qui tombe
// sur une précondition ne prouve pas que l'étape sait rougir (CLAUDE.md,
// « A negative control must fail at the step it claims »).
//
//   node etats.mjs --page <index.html> --flux <flux.h264> [--port 5473]
//   (sans --port, un port libre : `port.mjs`)
//        [--etapes a,b] [--taille 1440x900] [--captures dossier] [--tout]
//        [--rouge-attendu a,b]
//
// Sans `--rouge-attendu`, sort en échec dès qu'une étape échoue. Avec, sort en
// succès seulement si CHACUNE des étapes nommées échoue sur son défaut: c'est
// le mode des contrôles négatifs, contre une page d'avant.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import puppeteer from "puppeteer";
import { demarrerBanc } from "./etats-banc.mjs";
import { portDemande } from "./port.mjs";

const args = process.argv.slice(2);
const option = (nom, defaut = null) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 ? args[i + 1] : defaut;
};
const drapeau = (nom) => args.includes(`--${nom}`);
const PAGE = option("page");
const FLUX = option("flux");
if (!PAGE || !FLUX) throw new Error("usage: etats.mjs --page <index.html> --flux <flux.h264>");
const PORT = portDemande(args);
const CAPTURES = option("captures");
const TAILLE = option("taille");
const ROUGE = option("rouge-attendu")?.split(",").filter(Boolean) ?? null;
const TOUT = drapeau("tout") || ROUGE !== null;
if (CAPTURES) mkdirSync(CAPTURES, { recursive: true });

class Defaut extends Error {}
class Precondition extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PC = { width: 1440, height: 900 };
const TELEPHONE = { width: 390, height: 844, isMobile: true, hasTouch: true };
const taille = (defaut) => {
  if (!TAILLE) return defaut;
  const [width, height] = TAILLE.split("x").map(Number);
  return width < height || width < 900 ? { width, height, isMobile: true, hasTouch: true } : { width, height };
};

const banc = await demarrerBanc({ port: PORT, page: PAGE, flux: FLUX });
const empreinte = createHash("sha256").update(readFileSync(PAGE)).digest("hex");
const servie = createHash("sha256")
  .update(Buffer.from(await (await fetch(banc.url, { headers: { "accept-encoding": "identity" } })).arrayBuffer()))
  .digest("hex");
if (servie !== empreinte) throw new Error(`la page servie (${servie}) n'est pas ${PAGE} (${empreinte})`);
console.log(JSON.stringify({ page: PAGE, sha256: empreinte, port: banc.port }));

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});

/** Ce que la page montre de la liaison, lu dans le DOM: une page d'avant n'a
 * pas `nel3abTest.liaison`, et le verdict doit porter sur ce qu'on VOIT.
 * Depuis que l'état a quitté l'image (ADR D40), il se dit par une fiche
 * (`#liaison`), un plein cadre (`#arrivee`) ou une pastille seule
 * (`#pastilleEtat`) : la fiche et le plein cadre d'abord, la pastille
 * sinon, et le texte des deux. */
const lire = (page) =>
  page.evaluate(() => {
    const etat = document.querySelector("#liaison, #arrivee") ?? document.querySelector("#pastilleEtat");
    const pastille = document.querySelector("#pastilleEtat");
    const texte = [etat, pastille !== etat ? pastille : null]
      .map((el) => el?.textContent?.replace(/\s+/g, " ").trim() ?? "")
      .filter(Boolean)
      .join(" ");
    return {
      etat: etat?.getAttribute("data-etat") ?? null,
      texte,
      rough: document.querySelector("#rough") !== null,
      ligne: document.querySelector("#ligneParlee")?.textContent ?? null,
      peintes: globalThis.nel3abTest?.counters?.().painted ?? 0,
      liaison: globalThis.nel3abTest?.liaison?.() ?? null,
    };
  });

/** Attend que `test` soit vrai, au plus `ms`. Rend ce qui a été vu en dernier. */
async function jusqua(page, test, ms, pas = 100) {
  const debut = Date.now();
  for (;;) {
    const vu = await lire(page);
    if (test(vu)) return { vu, apres: Date.now() - debut };
    if (Date.now() - debut > ms) return { vu, apres: null };
    await sleep(pas);
  }
}

/** Relève pendant `ms`; `test` rend un message d'échec ou rien. */
async function durant(page, ms, test, pas = 100) {
  const debut = Date.now();
  const vus = [];
  while (Date.now() - debut < ms) {
    const vu = await lire(page);
    vus.push(vu);
    const faux = test(vu, vus);
    if (faux) throw new Defaut(`${faux} (à ${Date.now() - debut} ms: ${JSON.stringify(vu)})`);
    await sleep(pas);
  }
  return vus;
}

async function capture(page, nom) {
  if (!CAPTURES) return;
  const vue = page.viewport();
  await page.screenshot({ path: `${CAPTURES}/${vue.width}x${vue.height}-${nom}.png` });
}

async function nouvelle(vue, stockage = {}, reglage = null, avantPage = null) {
  banc.reinitialiser();
  // Un état du banc posé AVANT le chargement : la console du jeu décide le
  // format attendu dès la première lecture de la salle.
  if (reglage) banc.regler(reglage);
  const page = await browser.newPage();
  await page.setViewport(taille(vue));
  // Un script posé avant ceux de la page (une horloge qu'on avance, par
  // exemple).
  if (avantPage) await page.evaluateOnNewDocument(avantPage);
  await page.evaluateOnNewDocument((stockage) => {
    try {
      localStorage.setItem("nel3ab:name", "banc");
      localStorage.setItem("nel3ab:banc", "1");
      // La vue des touches de la première visite prend la place des rangs de
      // la colonne (chantier salle, étape 6); ces étapes partent d'une vue lue.
      localStorage.setItem("nel3ab:aide-clavier", "vue");
      // Le profil du navigateur est partagé entre les étapes : une page
      // d'avant laissait « manette seule » posée pour l'étape suivante.
      localStorage.removeItem("nel3ab:padonly");
      for (const [cle, valeur] of Object.entries(stockage)) localStorage.setItem(cle, valeur);
    } catch {}
  }, stockage);
  page.on("pageerror", (e) => console.error(`[pageerror] ${e.message}`));
  await page.goto(banc.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#enter", { timeout: 15000 });
  return page;
}

async function entrer(page) {
  await page.click("#enter");
  const vu = await jusqua(page, (v) => v.peintes > 30, 20000);
  if (vu.apres === null) throw new Precondition("la page n'a pas peint 30 images en 20 s");
  // Le son démarre au premier geste après l'entrée, comme pour une personne.
  await page.evaluate(() => window.dispatchEvent(new Event("pointerup")));
  return Date.now();
}

/** Le gel jusqu'à sa fiche : « Relancer l'image » paraît à 5,6 s. Rend
 * l'instant du gel. */
async function jusquALaFiche(page) {
  await sleep(1500);
  const gel = Date.now();
  banc.regler({ video: "freeze" });
  const vu = await page.waitForSelector("#relancerImage", { timeout: 9000 }).catch(() => null);
  if (vu === null) throw new Precondition("pas de fiche « Relancer l'image » en 9 s de gel");
  return gel;
}

/** Une boîte d'élément, en nombres (un DOMRect arrive vide de `evaluate`). */
const BOITE = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/** Coupe le réseau de la page et le prouve : le navigateur hors ligne, les
 * sockets fermées par le banc, et aucune rouverte pendant deux secondes. */
async function couperLeReseau(page) {
  await page.setOfflineMode(true);
  banc.regler({ video: "drop" });
  const debut = Date.now();
  for (;;) {
    const o = banc.ouvertes();
    const seat = await page.evaluate(() => globalThis.nel3abTest?.seat?.() ?? null);
    if (o.manette === 0 && o.video === 0 && seat === null) break;
    if (Date.now() - debut > 5000) throw new Precondition(`la coupure n'a pas fermé les sockets: ${JSON.stringify({ ...o, seat })}`);
    await sleep(100);
  }
  await sleep(2000);
  const apres = banc.ouvertes();
  if (apres.manette + apres.video + apres.son > 0)
    throw new Precondition(`une socket s'est rouverte hors ligne: ${JSON.stringify(apres)}`);
  banc.regler({ video: "live" });
}

/** Ce qui reçoit le point sur une grille de l'image : la toile du jeu, ou la
 * neige qui la remplace. Chaque calque est rendu cible du pointeur le temps
 * de la mesure. */
const DANS_L_IMAGE = () => {
  const toile = document.getElementById("screen");
  if (!toile) return { erreur: "pas de canevas #screen" };
  const r = toile.getBoundingClientRect();
  if (r.width < 50 || r.height < 50) return { erreur: `image trop petite: ${r.width}x${r.height}` };
  const style = document.createElement("style");
  style.textContent = '.n3-neige, :is([class^="rt-"], [class*=" rt-"]), :is([class^="rt-"], [class*=" rt-"]) * { pointer-events: auto !important; }';
  document.head.append(style);
  const vus = new Set();
  const fautes = [];
  // Une grille de 5 x 5, et les quatre coins à 2 px du bord : une neige
  // décalée de 40 px laissait les 25 points de la grille dans la neige
  // (mutant du 24 novembre 2026).
  const points = [];
  for (let i = 1; i <= 5; i++) for (let j = 1; j <= 5; j++) points.push([r.left + (r.width * i) / 6, r.top + (r.height * j) / 6]);
  for (const x of [r.left + 2, r.right - 3]) for (const y of [r.top + 2, r.bottom - 3]) points.push([x, y]);
  for (const [px, py] of points) {
    const x = Math.round(px);
    const y = Math.round(py);
    const vu = document.elementFromPoint(x, y);
    if (vu === toile) vus.add("toile");
    else if (vu?.classList.contains("n3-neige")) vus.add("neige");
    else fautes.push(`${x},${y}: ${vu?.tagName ?? "rien"}#${vu?.id ?? ""}.${vu?.className ?? ""}`);
  }
  style.remove();
  return { vus: [...vus], fautes };
};

/** Le contraste de chaque texte de la pastille contre son fond, et de son
 * bord, lus dans le style calculé. Le fond est celui du premier ancêtre
 * opaque : la pastille est l'écran noir de la borne dans les deux thèmes. */
const CONTRASTE_PASTILLE = () => {
  const rgb = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (x) => {
      const c = x / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const rapport = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
  };
  const fond = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = rgb(getComputedStyle(e).backgroundColor);
      if (c && c.a === 1) return c;
    }
    return null;
  };
  const p = document.querySelector("#pastilleEtat");
  if (!p) return { erreur: "pas de pastille" };
  const texte = p.querySelector(".n3-pastille-texte");
  const compteur = p.querySelector(".n3-pastille-compteur .rt-afficheur-valeur") ?? p.querySelector(".n3-pastille-compteur");
  if (!texte || !compteur || !compteur.textContent.trim()) return { erreur: "la pastille n'a pas son texte et son compteur" };
  const sous = fond(p);
  if (!sous) return { erreur: "la pastille n'a pas de fond opaque" };
  const mesure = (el) => {
    const c = rgb(getComputedStyle(el).color);
    return { texte: el.textContent.trim(), couleur: getComputedStyle(el).color, rapport: rapport(c, fond(el)) };
  };
  return {
    theme: document.documentElement.dataset.theme ?? null,
    fond: getComputedStyle(p).backgroundColor,
    texte: mesure(texte),
    compteur: mesure(compteur),
    bord: { couleur: getComputedStyle(p).borderTopColor, rapport: rapport(rgb(getComputedStyle(p).borderTopColor), sous) },
  };
};

/** Les pixels clairs d'un rectangle de l'écran, lus sur une vraie capture :
 * leur nombre et la boîte qu'ils occupent. Clair : une luminance de plus de
 * 128 sur 255. La capture est décodée par la page, qui sait lire un PNG. */
async function clairs(page, r) {
  const png = await page.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h }, encoding: "base64" });
  return page.evaluate(async (b64) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const toile = new OffscreenCanvas(image.width, image.height);
    const g = toile.getContext("2d");
    g.drawImage(image, 0, 0);
    const d = g.getImageData(0, 0, image.width, image.height).data;
    let n = 0;
    let haut = Infinity;
    let bas = -1;
    let gauche = Infinity;
    let droite = -1;
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        const k = (y * image.width + x) * 4;
        if (0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2] <= 128) continue;
        n += 1;
        haut = Math.min(haut, y);
        bas = Math.max(bas, y);
        gauche = Math.min(gauche, x);
        droite = Math.max(droite, x);
      }
    return { n, total: image.width * image.height, w: image.width, hauteur: n ? bas - haut + 1 : 0, largeur: n ? droite - gauche + 1 : 0 };
  }, png);
}

/** Deux images d'écran : ce qui vient d'être réglé est rendu. */
const rendu = (page) => page.evaluate(() => new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(fin))));

/** Ce qui reçoit le point au centre et aux quatre coins (à 2 px du bord) de
 * chaque pièce du texte du plein cadre, chaque calque du tube rendu cible du
 * pointeur le temps de la mesure : un calque est `pointer-events: none`, et
 * `elementFromPoint` passerait au travers sans le voir. */
const TEXTE_SOUS_CALQUE = () => {
  const style = document.createElement("style");
  style.textContent = '.n3-plein [class^="rt-calque"], .n3-plein .n3-extinction { pointer-events: auto !important; }';
  document.head.append(style);
  const pieces = [...document.querySelectorAll("#arrivee :is(.n3-plein-titre, .n3-plein-etapes li, .n3-plein-fait, .n3-plein-cout, .n3-geste)")];
  const fautes = [];
  let points = 0;
  for (const el of pieces) {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    for (const [x, y] of [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 2, r.top + 2],
      [r.right - 3, r.top + 2],
      [r.left + 2, r.bottom - 3],
      [r.right - 3, r.bottom - 3],
    ]) {
      points += 1;
      const vu = document.elementFromPoint(Math.round(x), Math.round(y));
      if (vu === null || !el.contains(vu))
        fautes.push(`${el.className.split(" ")[0] || el.tagName} ${Math.round(x)},${Math.round(y)}: ${vu?.tagName ?? "rien"}.${vu?.className ?? ""}`);
    }
  }
  style.remove();
  return { pieces: pieces.length, points, fautes };
};

/** Les calques du tube visibles dans la page : posés, affichés, avec une aire. */
const CALQUES_VUS = () =>
  [...document.querySelectorAll(".rt-calque-balayage, .rt-calque-vignette, .rt-calque-roulement")]
    .filter((c) => getComputedStyle(c).display !== "none" && c.getBoundingClientRect().width > 0)
    .map((c) => c.className);

/** La pastille de la proposition de l'image légère (ADR D40). */
const OFFRE = '#pastilleEtat[data-etat="irreguliere"]';

const proposes = (depuis) =>
  banc.journal(depuis).filter((l) => l.texte.includes('"qualite"') && l.texte.includes("proposé"));

/** Ce qui reçoit le point au centre et sur une grille de l'image du jeu,
 * chaque élément `rt-…` rendu cible du pointeur le temps de la mesure: un
 * calque est `pointer-events: none`, et `elementFromPoint` passerait au
 * travers sans le voir. Rend les points où un effet est au-dessus de l'image. */
const SUR_IMAGE = () => {
  const toile = document.getElementById("screen");
  if (!toile) return { erreur: "pas de canevas #screen" };
  const r = toile.getBoundingClientRect();
  if (r.width < 50 || r.height < 50) return { erreur: `image trop petite: ${r.width}x${r.height}` };
  const style = document.createElement("style");
  style.textContent = ':is([class^="rt-"], [class*=" rt-"]), :is([class^="rt-"], [class*=" rt-"]) * { pointer-events: auto !important; }';
  document.head.append(style);
  const fautes = [];
  let points = 0;
  for (let i = 1; i <= 5; i++)
    for (let j = 1; j <= 5; j++) {
      const x = Math.round(r.left + (r.width * i) / 6);
      const y = Math.round(r.top + (r.height * j) / 6);
      const vu = document.elementFromPoint(x, y);
      points += 1;
      if (vu !== toile) {
        const effet = vu?.closest('[class^="rt-"], [class*=" rt-"]');
        fautes.push(`${x},${y}: ${vu?.tagName ?? "rien"}.${vu?.className ?? ""}${effet ? ` (effet ${effet.className})` : ""}`);
      }
    }
  style.remove();
  return { points, fautes };
};

/** Une page de salle ouverte pendant que `/api/me` est tenu : elle reste sur
 * l'ouverture jusqu'à `lacher()`. `sansModule` : le document servi sans son
 * script de page, pour voir le squelette d'avant React (`front/index.html`). */
async function ouvrirTenue({ vue = PC, schema = null, sansModule = false, stockage = {} } = {}) {
  banc.reinitialiser();
  const page = await browser.newPage();
  await page.setViewport(taille(vue));
  if (schema) await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: schema }]);
  await page.evaluateOnNewDocument((stockage) => {
    try {
      // Une page neuve : la largeur gardée par une étape d'avant ne passe pas.
      localStorage.clear();
      localStorage.setItem("nel3ab:name", "banc");
      localStorage.setItem("nel3ab:banc", "1");
      localStorage.setItem("nel3ab:aide-clavier", "vue");
      for (const [cle, valeur] of Object.entries(stockage)) localStorage.setItem(cle, valeur);
    } catch {}
  }, stockage);
  page.on("pageerror", (e) => console.error(`[pageerror] ${e.message}`));
  let lacher = () => {};
  const tenue = new Promise((r) => {
    lacher = r;
  });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const chemin = new URL(req.url()).pathname;
    if (chemin === "/api/me") void tenue.then(() => req.continue().catch(() => {}));
    else if (sansModule && req.isNavigationRequest())
      void fetch(req.url(), { headers: { "accept-encoding": "identity" } })
        .then((r) => r.text())
        .then((html) =>
          req.respond({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: html.replace(/<script type="module"[^>]*>[\s\S]*?<\/script>/, ""),
          }),
        )
        .catch(() => req.abort().catch(() => {}));
    else void req.continue().catch(() => {});
  });
  await page.goto(`${banc.url}?entrer=jouer`, { waitUntil: "domcontentloaded" });
  return { page, lacher };
}

/** Une salle ouverte pendant que `/api/me` est tenu : la boîte de la colonne,
 * de son titre et de la maison d'Aïn dans l'ouverture, puis dans la salle une
 * fois l'identité lâchée. `mutant` : une feuille posée sur l'ouverture seule.
 * Rend le saut vu, en mots, ou `null`. */
async function mesurerSaut(mutant) {
  const { page, lacher } = await ouvrirTenue();
  if (!(await page.waitForSelector("#ouverture", { timeout: 15000 }).catch(() => null)))
    throw new Precondition("l'ouverture ne s'est pas montrée pendant que /api/me était tenu");
  if (mutant) await page.addStyleTag({ content: mutant });
  const boites = (colonne) =>
    page.evaluate((colonne) => {
      const boite = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const c = document.querySelector(colonne);
      return {
        colonne: boite(c),
        titre: boite(c?.querySelector("h1") ?? null),
        maison: boite(c?.querySelector("[data-hote]") ?? null),
      };
    }, colonne);
  // Deux images : la colonne prend sa largeur gardée au premier rendu.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const avant = await boites("#ouvertureColonne");
  await capture(page, mutant ? "ouverture-decalee" : "ouverture");
  lacher();
  if (!(await page.waitForSelector("#side", { timeout: 15000 }).catch(() => null)))
    throw new Precondition("la salle ne s'est pas montée après l'identité");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const apres = await boites("#side");
  await capture(page, mutant ? "ouverture-decalee-salle" : "ouverture-salle");
  await page.close();
  if (!apres.colonne || !apres.titre) throw new Precondition(`la salle n'a pas de colonne titrée: ${JSON.stringify(apres)}`);
  if (!avant.colonne)
    return { saut: "l'ouverture n'a pas de colonne : celle de la salle apparaît d'un coup", avant, apres };
  if (!avant.titre) return { saut: "la colonne de l'ouverture n'a pas de titre", avant, apres };
  const ecart = (a, b, champs) => Math.max(...champs.map((k) => Math.abs(a[k] - b[k])));
  const colonne = ecart(avant.colonne, apres.colonne, ["x", "y", "w", "h"]);
  // Le titre : sa place et sa hauteur ; sa largeur suit « Quitter la salle ».
  const titre = ecart(avant.titre, apres.titre, ["x", "y", "h"]);
  // La maison d'Aïn : le logo ne descend pas quand la salle arrive.
  const maison = avant.maison && apres.maison ? ecart(avant.maison, apres.maison, ["x", "y", "w", "h"]) : null;
  const saut =
    colonne >= 2
      ? `la colonne saute de ${colonne.toFixed(1)} px à l'arrivée de la salle`
      : titre >= 2
        ? `le titre saute de ${titre.toFixed(1)} px à l'arrivée de la salle`
        : maison === null
          ? `la maison d'Aïn manque (${avant.maison ? "dans la salle" : "dans l'ouverture"})`
          : maison >= 2
            ? `la maison d'Aïn saute de ${maison.toFixed(1)} px à l'arrivée de la salle`
            : null;
  return { saut, colonne, titre, maison, avant, apres };
}

const ETAPES = {
  /** Le 26 novembre 2026, à 0 % la salle jouait encore. La page tenait deux
   * sessions depuis qu'elle avait quitté « manette seule » : l'ancienne avait
   * rouvert son image et son son, et le volume ne réglait que la nouvelle.
   * Sur ce banc, l'aller-retour laissait deux sockets d'image ouvertes. Le
   * mode est retiré le 27 novembre : un appareil qui avait gardé « oui »
   * reçoit l'image et le son, une fois chacun, la ligne n'est plus au menu,
   * et la sourdine de la colonne ferme le seul son ouvert, image gardée. Le
   * nombre de sockets est celui du banc, côté salle, comme le journal du
   * worker les compte. */
  async "sourdine-une-session"() {
    const page = await nouvelle(PC, { "nel3ab:padonly": "oui" });
    await page.click("#enter");
    const vu = await jusqua(page, (v) => v.peintes > 30, 20000);
    if (vu.apres === null) throw new Defaut("une page qui avait gardé « manette seule » ne reçoit aucune image");
    await page.evaluate(() => window.dispatchEvent(new Event("pointerup")));
    const debut = Date.now();
    while (banc.ouvertes().son < 1 && Date.now() - debut < 5000) await sleep(100);
    const avant = banc.ouvertes();
    if (avant.son < 1) throw new Precondition(`le son ne s'ouvre pas après un geste: ${JSON.stringify(avant)}`);
    if (avant.video !== 1 || avant.son !== 1)
      throw new Defaut(`une page tient ${avant.video} sockets d'image et ${avant.son} de son`);
    if ((await page.evaluate(() => localStorage.getItem("nel3ab:padonly"))) !== null)
      throw new Defaut("la clé de « manette seule » reste dans le navigateur");
    // La glissière ne paraît qu'une fois le son joué : « activer le son »,
    // par un vrai clic, comme une personne.
    if (await page.$("#sound")) await page.click("#sound");
    if ((await page.waitForSelector("#volume", { timeout: 5000 }).catch(() => null)) === null)
      throw new Precondition("le son ne joue pas après « activer le son »: pas de glissière");
    // La ligne n'est plus au menu, rubrique des manettes ouverte.
    await page.click("#openMenu");
    await page.waitForSelector("#menu", { timeout: 5000 });
    const onglet = await page.evaluateHandle(() =>
      [...document.querySelectorAll("#menu [role=tab]")].find((t) => /manette/i.test(t.textContent)),
    );
    if (!(await onglet.evaluate((t) => t instanceof HTMLElement))) throw new Precondition("pas de rubrique des manettes au menu");
    await onglet.click();
    await page.waitForSelector("#item-touchpad, #item-pad, #item-bindings", { timeout: 5000 });
    if (await page.$("#item-padonly, [id^=pick-padonly]")) throw new Defaut("« manette seule » est encore au menu");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("menu"), { timeout: 5000 });
    // La sourdine, par un vrai geste sur la glissière de la colonne.
    const glisser = async (dx) => {
      const r = await page.evaluate(() => {
        const g = document.querySelector("#volume");
        g?.scrollIntoView({ block: "center" });
        const b = g?.getBoundingClientRect();
        return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
      });
      if (r === null) throw new Precondition(`pas de glissière #volume dans la colonne: ${await page.evaluate(() => [...document.querySelectorAll("#side button, #side input, #side [id]")].map((e) => e.id || e.textContent.trim().slice(0, 20)).slice(0, 30).join(" | "))}`);
      await page.mouse.move(r.x, r.y);
      await page.mouse.down();
      await page.mouse.move(r.x + dx, r.y, { steps: 10 });
      await page.mouse.up();
      await sleep(1500);
      return { valeur: await page.evaluate(() => document.querySelector("#volume").value), ...banc.ouvertes() };
    };
    const zero = await glisser(-400);
    if (zero.valeur !== "0") throw new Precondition(`la glissière tirée à gauche lit ${zero.valeur}, pas 0`);
    if (zero.son !== 0) throw new Defaut(`à 0 %, ${zero.son} socket de son reste ouverte`);
    if (zero.video !== 1) throw new Defaut(`la sourdine a changé l'image: ${zero.video} sockets`);
    // Le jumeau : remonté, le son rouvre, et le banc le voit.
    const remonte = await glisser(400);
    if (remonte.son !== 1) throw new Precondition(`le volume remonté (${remonte.valeur}) ne rouvre pas le son: la mesure ne voit rien`);
    await page.close();
  },

  /** La colonne se tire entre ses bornes, l'image suit, la largeur est
   * retenue. Repris de `colonne.mjs` (`just browser-colonne`) le 27 novembre
   * 2026 : ce pilote jouait un faux jeu sans image et passait la page en
   * « manette seule », seul mode qui n'attendait pas d'image. Le banc envoie
   * de vraies images, et la colonne sert pendant une partie. */
  async "colonne-tiree"() {
    const MIN = 256;
    const STEP = 16;
    const NORMAL = 304;
    const MAX = 480;
    const lire = (page) =>
      page.evaluate(() => {
        const side = document.getElementById("side").getBoundingClientRect();
        const place = document.getElementById("screen").parentElement.getBoundingClientRect();
        const grip = document.querySelector("#columnHandle > span").getBoundingClientRect();
        const x = grip.left + grip.width / 2;
        const y = grip.top + grip.height / 2;
        const dessus = document.elementFromPoint(x, y);
        return {
          colonne: Math.round(side.width),
          image: Math.round(place.width),
          aria: Number(document.getElementById("columnHandle").getAttribute("aria-valuenow")),
          x,
          y,
          touchee: Boolean(dessus?.closest("#columnHandle")),
          dessus: dessus ? `${dessus.tagName.toLowerCase()}${dessus.id ? `#${dessus.id}` : ""}` : "rien",
          focus: Boolean(document.activeElement?.closest?.("#columnHandle")),
        };
      });
    const tirer = async (page, dx) => {
      const avant = await lire(page);
      if (!avant.touchee) throw new Defaut(`la prise est recouverte par ${avant.dessus}`);
      await page.mouse.move(avant.x, avant.y);
      await page.mouse.down();
      await page.mouse.move(avant.x + dx, avant.y, { steps: 12 });
      await page.mouse.up();
      await sleep(150);
      return lire(page);
    };
    // Rechargée, la page rentre seule dans la salle (l'entrée est dans
    // l'adresse) : « Entrer » n'y est que si elle le propose.
    const rouvrir = async (page) => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("#enter, #columnHandle", { timeout: 15000 });
      if (await page.$("#enter")) await entrer(page);
      else if ((await jusqua(page, (v) => v.peintes > 30, 20000)).apres === null)
        throw new Precondition("rechargée, la page n'a pas peint 30 images en 20 s");
      await page.waitForSelector("#columnHandle", { timeout: 5000 });
    };
    const page = await nouvelle(PC);
    await entrer(page);
    await page.waitForSelector("#columnHandle", { timeout: 5000 });
    const depart = await lire(page);
    if (depart.colonne !== NORMAL || depart.aria !== NORMAL)
      throw new Precondition(`la colonne ne part pas de ${NORMAL} px: ${JSON.stringify(depart)}`);
    const large = await tirer(page, -96);
    if (large.colonne !== NORMAL + 96) throw new Defaut(`tirer de 96 px à gauche donne ${large.colonne} px`);
    if (depart.image - large.image !== 96) throw new Defaut(`l'image rend ${depart.image - large.image} px, pas 96`);
    if (large.aria !== large.colonne) throw new Defaut(`la poignée annonce ${large.aria} pour ${large.colonne} vus`);
    if (large.focus) throw new Defaut("la poignée garde le focus: elle volerait les flèches du jeu");
    const haut = await tirer(page, -900);
    if (haut.colonne !== MAX) throw new Defaut(`la borne haute donne ${haut.colonne} px`);
    const bas = await tirer(page, 900);
    if (bas.colonne !== MIN) throw new Defaut(`la borne basse donne ${bas.colonne} px`);
    // À MIN, rien ne sort de la colonne, mesures ouvertes ou non. Le jumeau :
    // 16 px de moins, et quelque chose sort.
    const sorties = (largeur) =>
      page.evaluate((w) => {
        const side = document.getElementById("side");
        const avant = side.style.width;
        side.style.width = `${w}px`;
        const bord = side.getBoundingClientRect().right;
        const dehors = [...side.querySelectorAll("*")]
          .filter((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().right > bord + 0.5)
          .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className ? `.${String(el.className).split(" ")[0]}` : ""} « ${(el.textContent || "").trim().slice(0, 30)} » +${Math.round(el.getBoundingClientRect().right - bord)}px`);
        const defile = side.scrollWidth > side.clientWidth;
        side.style.width = avant;
        return { dehors, defile };
      }, largeur);
    for (const mode of ["details", "normal"]) {
      const ouvertes = await page.evaluate(() => {
        const ligne = document.querySelector("#mesures");
        return (ligne?.getAttribute("aria-expanded") ?? ligne?.getAttribute("aria-pressed")) === "true";
      });
      if (ouvertes !== (mode === "details")) await page.click("#mesures");
      await page.evaluate(() => {
        const autres = document.querySelector("#autresReglages");
        if (autres) autres.open = true;
      });
      await sleep(300);
      const juste = await sorties(MIN);
      if (juste.dehors.length || juste.defile)
        throw new Defaut(`à ${MIN} px en mode ${mode}, sort de la colonne: ${juste.dehors.slice(0, 4).join(", ")}`);
    }
    // Le jumeau : la mesure voit un débordement quand il y en a un. Jusqu'au
    // 27 novembre 2026, il venait à MIN - 16 (le chiffre du volume, +12 px à
    // 256) ; la glissière qui rétrécit le repousse plus bas : on cherche le
    // premier, de 16 en 16, et la borne reste un choix, plus une mesure.
    let sous = null;
    for (let w = MIN - STEP; w >= 128 && sous === null; w -= STEP) {
      const vu = await sorties(w);
      if (vu.dehors.length > 0 && vu.defile) sous = { w, ...vu };
    }
    if (sous === null) throw new Precondition("de 240 à 128 px rien ne sort: la mesure ne voit rien");
    console.log(JSON.stringify({ colonne: "premier débordement", largeur: sous.w, dehors: sous.dehors.slice(0, 2) }));
    await tirer(page, -80);
    await rouvrir(page);
    const relue = await lire(page);
    if (relue.colonne !== MIN + 80) throw new Defaut(`après rechargement, ${relue.colonne} px au lieu de ${MIN + 80}`);
    await page.mouse.move(relue.x, relue.y);
    await page.mouse.down({ clickCount: 1 });
    await page.mouse.up({ clickCount: 1 });
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await sleep(150);
    if ((await lire(page)).colonne !== NORMAL) throw new Defaut("le double-clic ne rend pas la largeur d'origine");
    await rouvrir(page);
    if ((await lire(page)).colonne !== NORMAL) throw new Defaut("le double-clic n'est pas retenu");
    // Une largeur retenue sur un grand écran, relue dans une fenêtre plus
    // petite où la colonne reste à côté de l'image (900 px et plus) : la
    // moitié de la fenêtre au plus.
    await tirer(page, -900);
    await page.setViewport({ width: 920, height: 800 });
    await rouvrir(page);
    const etroite = await lire(page);
    if (etroite.colonne !== 460) throw new Defaut(`dans 920 px, la colonne fait ${etroite.colonne} px, pas 460`);
    await page.setViewport({ width: 1100, height: 800 });
    await rouvrir(page);
    const cote = await page.evaluate(() => {
      const screen = document.getElementById("screen").getBoundingClientRect();
      const side = document.getElementById("side").getBoundingClientRect();
      return { beside: side.left >= screen.right - 1, width: Math.round(side.width) };
    });
    if (cote.width !== MAX) throw new Defaut(`à 1100 px, la colonne fait ${cote.width} px, pas ${MAX}`);
    if (!cote.beside) throw new Defaut(`à 1100 px et ${MAX} px de colonne, l'image passe dessous`);
    await page.evaluate(() => localStorage.removeItem("nel3ab:colonne"));
    await page.close();
  },

  /** Le thème rétro (ADR D37): au niveau « tout », aucun effet ne passe sur
   * l'image du jeu. Le point au centre et sur une grille de l'image doit
   * tomber sur le canevas lui-même. Le jumeau: un calque d'interface posé par
   * erreur sur toute la page doit être vu sur l'image. */
  async "calques-sous-image"() {
    const page = await nouvelle(PC, { "nel3ab:effets": '{"niveau":"tout","sons":true}' });
    const racine = await page.evaluate(() => ({
      niveau: document.documentElement.dataset.effets,
      classes: [...document.documentElement.classList].filter((c) => c.startsWith("fx-")).length,
    }));
    if (racine.niveau !== "tout" || racine.classes < 45)
      throw new Precondition(`le niveau « tout » n'est pas posé: ${JSON.stringify(racine)}`);
    await entrer(page);
    const vu = await page.evaluate(SUR_IMAGE);
    if (vu.erreur) throw new Precondition(vu.erreur);
    if (vu.points !== 25) throw new Precondition(`${vu.points} points mesurés, 25 attendus`);
    if (vu.fautes.length) throw new Defaut(`un effet passe sur l'image: ${vu.fautes.slice(0, 4).join(" ; ")}`);
    await capture(page, "calques-tout");
    // Le jumeau: le calque d'interface posé sur toute la page, comme un écran
    // qui oublierait de le garder dans sa surface.
    await page.evaluate(() => {
      const calques = document.createElement("div");
      calques.className = "rt-calques-ui rt-calques-page";
      calques.innerHTML = '<i class="rt-calque-balayage-tout"></i><i class="rt-calque-grille"></i><i class="rt-calque-scintille"></i>';
      document.body.append(calques);
    });
    const jumeau = await page.evaluate(SUR_IMAGE);
    if (!jumeau.fautes?.length) throw new Precondition("le calque posé sur toute la page n'est pas vu: la mesure ne voit rien");
    await page.close();
  },

  /** Le jumeau de tout le reste: des images qui arrivent, rien d'affiché. */
  async "images-rien"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await durant(page, 8000, (v) => (v.etat !== null || v.rough ? "un état s'affiche sur des images qui arrivent" : null));
    await page.close();
  },

  /** Le 21 novembre: socket ouverte, messages vides, son qui continue. */
  async "gel-dit"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await sleep(2000);
    const gel = Date.now();
    banc.regler({ video: "freeze" });
    const vu = await jusqua(page, (v) => v.etat === "figee", 4000);
    if (vu.apres === null) throw new Defaut(`aucun état figé en 4 s de gel: ${JSON.stringify(vu.vu)}`);
    const dite = await jusqua(page, (v) => (v.ligne ?? "").includes("L'image ne bouge plus"), 3000);
    if (dite.apres === null) throw new Defaut(`la ligne parlée ne dit pas le gel: ${dite.vu.ligne}`);
    await capture(page, "gel-pastille");
    await sleep(Math.max(0, 5600 - (Date.now() - gel)));
    if ((await page.$("#relancerImage")) === null) throw new Defaut("pas de bandeau ni de « Relancer l'image » à 5,6 s");
    // Les faits, repliés sous la fiche, et dépliés par un vrai clic.
    const pli = await page.evaluate(() => {
      const d = document.querySelector("#liaison details#ceQueTaPageVoit");
      if (!d) return null;
      d.scrollIntoView({ block: "center" });
      const r = d.querySelector("summary").getBoundingClientRect();
      return { ouvert: d.open, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (pli === null) throw new Defaut("pas de « Ce que ta page voit » sous la fiche du gel");
    if (pli.ouvert) throw new Defaut("« Ce que ta page voit » est déplié d'office");
    await page.mouse.click(pli.x, pli.y);
    const deplie = await page.evaluate(() => {
      const d = document.querySelector("#ceQueTaPageVoit");
      return { ouvert: d.open, texte: d.textContent };
    });
    if (!deplie.ouvert || !deplie.texte.includes("Son : arrive") || !deplie.texte.includes("Image : arrêtée depuis"))
      throw new Defaut(`« Ce que ta page voit » ne dit pas les faits du gel: ${JSON.stringify(deplie)}`);
    await capture(page, "gel-bandeau");
    // La colonne reste atteignable, et Signaler y est UNE fois : dans la
    // fiche quand elle le porte, la ligne de la colonne repliée (K25). Le
    // bouton reçoit bien le clic, rien ne le couvre.
    const atteint = await page.evaluate(() => {
      const signaler = [...document.querySelectorAll("#complain, #signalerEtat")].filter(
        (b) => b.getClientRects().length > 0,
      );
      if (signaler.length !== 1) return `${signaler.length} « Signaler » à l'écran`;
      const bouton = signaler[0];
      // La colonne défile: le bouton peut être plus bas que la fenêtre.
      bouton.scrollIntoView({ block: "center" });
      const r = bouton.getBoundingClientRect();
      const sous = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return sous?.closest("#side") ? "oui" : (sous?.id ?? sous?.tagName ?? "rien");
    });
    if (atteint !== "oui") throw new Defaut(`la colonne est couverte pendant le gel: ${atteint}`);
    // Le jumeau: les images reviennent, le message part et la ligne le dit.
    banc.regler({ video: "live" });
    const parti = await jusqua(page, (v) => v.etat === null && v.ligne === "L'image est revenue.", 4000);
    if (parti.apres === null) throw new Defaut(`le gel ne se retire pas au retour des images: ${JSON.stringify(parti.vu)}`);
    await page.close();
  },

  /** Un chargement de 3 s, puis le jeu repart à 45 images par seconde sur des
   * tics de 60 Hz. La page d'avant restait « figée » en bandeau. */
  async "reprise-45"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await sleep(3000);
    banc.regler({ video: "freeze" });
    const gel = await jusqua(page, (v) => v.etat === "figee", 4000);
    if (gel.apres === null) throw new Precondition("le gel n'a pas été dit avant la reprise");
    await sleep(500);
    banc.regler({ video: "slow", skip: 4 });
    const avant = (await lire(page)).peintes;
    const sorti = await jusqua(page, (v) => v.etat !== "figee", 2500);
    if (sorti.apres === null)
      throw new Defaut(`toujours figée 2,5 s après la reprise à 45 images par seconde: ${sorti.vu.texte}`);
    await capture(page, "reprise-45");
    await durant(page, 8000, (v) => (v.etat === "figee" ? "redevenue figée pendant que l'image bouge" : null));
    const peintes = (await lire(page)).peintes - avant;
    if (peintes < 300) throw new Precondition(`le banc n'a peint que ${peintes} images en dix secondes`);
    await page.close();
  },

  /** Socket ouverte et MUETTE: rien, ni image ni message. Le chien de garde
   * la ferme, la page se rebranche sur une salle muette. */
  async "socket-muette"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await sleep(2000);
    banc.regler({ video: "silent" });
    const tombe = await jusqua(page, (v) => v.etat !== null, 4000);
    if (tombe.apres === null) throw new Precondition("aucun état affiché pour une salle muette");
    await capture(page, "muette");
    await durant(page, 8000, (v) =>
      v.ligne === "L'image est revenue."
        ? "« L'image est revenue. » sans une image"
        : v.etat === null
          ? "l'état disparaît sans une image"
          : null,
    );
    banc.regler({ video: "live" });
    const revenu = await jusqua(page, (v) => v.etat === null && v.ligne === "L'image est revenue.", 6000);
    if (revenu.apres === null) throw new Defaut(`le retour des images n'est pas dit: ${JSON.stringify(revenu.vu)}`);
    await page.close();
  },

  /** Le salon arrêté: le relais répond 502 à `/api/salles`. */
  async "relais-502"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await sleep(2000);
    banc.regler({ video: "silent", salles: "502" });
    const tombe = await jusqua(page, (v) => v.etat === "injoignable", 5000);
    if (tombe.apres === null) throw new Precondition(`pas d'état « injoignable »: ${JSON.stringify(tombe.vu)}`);
    await sleep(1500);
    const vu = await lire(page);
    if (vu.texte.includes("Le reste du site répond")) throw new Defaut(`un 502 passe pour le site: ${vu.texte}`);
    if ((await page.$("#signalerEtat")) !== null) throw new Defaut("« Signaler » proposé alors que le salon ne répond pas");
    await capture(page, "relais-502");
    // Le jumeau: le salon revient, la sonde suivante le dit.
    banc.regler({ salles: "up" });
    const site = await jusqua(page, (v) => v.texte.includes("Le reste du site répond."), 5000);
    if (site.apres === null) throw new Defaut(`un salon qui répond n'est pas dit: ${site.vu.texte}`);
    await capture(page, "site-repond");
    await page.close();
  },

  /** Un changement de jeu vu d'une page qui n'a pas reçu l'annonce: le worker
   * sort, systemd le relance deux secondes plus tard. */
  async redemarrage() {
    const page = await nouvelle(PC);
    await entrer(page);
    await sleep(2000);
    const debut = Date.now();
    // L'instant où systemd arrête encore l'ancien processus: « fermée » sans
    // `redemarre`. Puis la relance (« activating »), puis la salle revient.
    banc.regler({ video: "drop", ouverte: false, redemarre: false });
    // « est fermée » ou « a fermé à » (K37) : l'un ou l'autre est un défaut ici.
    const pasFermee = (v) => (/fermée|a fermé/.test(v.texte) ? "« fermée » pendant un redémarrage" : null);
    await durant(page, 1000, pasFermee);
    banc.regler({ redemarre: true });
    // Les sondes partent toutes les trois secondes: « redémarre » arrive avec
    // la suivante. Une seule réponse « fermée » ne doit jamais suffire.
    const dit = await jusqua(page, (v) => v.texte.includes("redémarre") || /fermée|a fermé/.test(v.texte), 5000);
    if (dit.apres === null) throw new Defaut(`« redémarre » jamais dit en ${Date.now() - debut} ms: ${dit.vu.texte}`);
    if (/fermée|a fermé/.test(dit.vu.texte)) throw new Defaut(`« fermée » pendant un redémarrage: ${dit.vu.texte}`);
    await capture(page, "redemarre");
    banc.regler({ video: "live", ouverte: true, redemarre: false });
    await durant(page, 4000, pasFermee);
    const revenu = await jusqua(page, (v) => v.etat === null, 4000);
    if (revenu.apres === null) throw new Defaut(`la salle revenue reste affichée en panne: ${revenu.vu.texte}`);
    await page.close();
  },

  /** Le jumeau du redémarrage: une salle vraiment fermée se dit fermée. */
  async "fermee-vraie"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await sleep(2000);
    // La colonne d'une salle fermée gardait « Inviter quelqu'un », qui copiait
    // le lien de la salle fermée, et « Prendre une place », qui ne faisait rien
    // (vérification finale du 22 novembre 2026). Le jumeau d'abord: salle
    // ouverte, l'invitation et la place sont là.
    const gestes = () =>
      page.evaluate(() => ["#inviter", "#takePad, #watchOnly"].filter((s) => document.querySelector(s) !== null));
    const ouverte = await gestes();
    if (ouverte.length !== 2) throw new Precondition(`salle ouverte sans ses deux gestes: ${ouverte}`);
    // Les places du panneau : au présent tant que la salle est ouverte (le
    // jumeau), au passé une fois fermée (plan des états, salle fermée 1).
    const lesPlaces = () =>
      page.evaluate(() => {
        const rangee = document.querySelector("#ports");
        const places = [1, 2, 3, 4].map((n) => document.querySelector(`#port${n}`));
        return {
          groupe: rangee ? [rangee.getAttribute("role"), rangee.getAttribute("aria-label")] : null,
          noms: places.map((b) => b?.getAttribute("aria-label") ?? null),
          actives: places.filter((b) => b !== null && !b.disabled).length,
          toi: document.querySelectorAll("#ports .n3-place-toi, #ports .n3-couronne").length,
          role: document.querySelector(".n3-places-role")?.textContent ?? null,
        };
      });
    const auPresent = await lesPlaces();
    if (auPresent.groupe === null || auPresent.groupe[1] !== null || auPresent.actives !== 4 || auPresent.toi === 0)
      throw new Precondition(`places d'une salle ouverte inattendues: ${JSON.stringify(auPresent)}`);
    // La colonne hors du panneau : les étiquettes, le bloc de rôle et le
    // bilan de la soirée (plan des états, salle fermée 5).
    const laColonne = () =>
      page.evaluate(() => {
        const side = document.querySelector("#side");
        const hors = (el) => el.closest("#panneau") === null;
        const ceSoir = document.querySelector("#ceSoir");
        return {
          etiquettes: [...(side?.querySelectorAll(".n3-etiquette") ?? [])]
            .filter(hors)
            .map((e) => e.querySelector(".sr-only")?.textContent ?? ""),
          seat: document.querySelector("#side #seat")?.textContent ?? null,
          regardent: document.querySelector("#ilsRegardent")?.textContent ?? null,
          ceSoir: ceSoir ? [document.querySelector("#ceSoirTitre")?.textContent ?? null, ceSoir.textContent] : null,
        };
      });
    // Le jumeau, salle ouverte : Lina regarde, au présent, et la colonne dit
    // qui tient cette page.
    banc.regler({ public: ["Lina"] });
    banc.annoncerSalle();
    await sleep(1200);
    const colonneOuverte = await laColonne();
    if (
      colonneOuverte.ceSoir !== null ||
      colonneOuverte.seat === null ||
      !colonneOuverte.regardent?.startsWith("Ils regardent") ||
      !colonneOuverte.etiquettes.includes("Lina")
    )
      throw new Precondition(`colonne d'une salle ouverte inattendue: ${JSON.stringify(colonneOuverte)}`);
    // Le salon dit depuis quand et pourquoi (K37, `Salle.fermee_depuis`).
    const fermeeA = Date.now() - 125_000;
    banc.regler({ video: "drop", ouverte: false, redemarre: false, fermeeDepuis: 125 });
    const fermee = await jusqua(page, (v) => /La salle 1 (est fermée|a fermé à)/.test(v.texte), 9000);
    if (fermee.apres === null) throw new Defaut(`une salle fermée n'est pas dite fermée en 9 s: ${fermee.vu.texte}`);
    const restes = await gestes();
    if (restes.length > 0) throw new Defaut(`la salle fermée propose encore ${restes.join(" et ")}`);
    // Le salon publie ensuite la salle sans ses joueurs, et Max arrive après
    // la fermeture : le panneau garde ceux d'avant, la colonne ceux qui
    // regardaient, et personne d'autre.
    banc.regler({ sieges: "vides", public: ["Max"] });
    banc.annoncerSalle();
    await sleep(1200);
    const colonneFermee = await laColonne();
    if (colonneFermee.ceSoir === null || colonneFermee.ceSoir[0] !== "Ce soir dans la salle 1")
      throw new Defaut(`la colonne d'une salle fermée ne dit pas « Ce soir dans la salle 1 »: ${JSON.stringify(colonneFermee)}`);
    if (!colonneFermee.ceSoir[1].includes("Jeu du banc"))
      throw new Defaut(`la soirée d'une salle fermée ne nomme pas le jeu: ${JSON.stringify(colonneFermee)}`);
    if (JSON.stringify(colonneFermee.etiquettes) !== JSON.stringify(["Lina"]))
      throw new Defaut(`la colonne d'une salle fermée a perdu ou changé qui regardait: ${JSON.stringify(colonneFermee)}`);
    if (colonneFermee.seat !== null || colonneFermee.regardent !== null)
      throw new Defaut(`la colonne d'une salle fermée parle encore au présent: ${JSON.stringify(colonneFermee)}`);
    const auPasse = await lesPlaces();
    if (JSON.stringify(auPasse.groupe) !== JSON.stringify(["group", "Ils ont joué"]))
      throw new Defaut(`les places d'une salle fermée ne se lisent pas « Ils ont joué »: ${JSON.stringify(auPasse)}`);
    if (auPasse.noms[0] !== "Place 1 : banc")
      throw new Defaut(`la salle fermée a perdu qui jouait: ${JSON.stringify(auPasse.noms)}`);
    if (auPasse.actives !== 0 || auPasse.toi !== 0 || auPasse.role !== null)
      throw new Defaut(`des places d'une salle fermée gardent un geste, toi, une couronne ou le rôle: ${JSON.stringify(auPasse)}`);
    // L'heure dite est celle que le salon publie, à la minute près (la sonde
    // part dans les secondes qui suivent), à l'heure de l'appareil.
    const heures = await page.evaluate((a) => {
      const dite = (ms) => {
        const d = new Date(ms);
        return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
      };
      return [dite(a - 60_000), dite(a), dite(a + 60_000)];
    }, fermeeA);
    const lue = /a fermé à (\d{1,2} h \d{2})\./.exec(fermee.vu.texte)?.[1] ?? null;
    if (lue === null || !heures.includes(lue))
      throw new Defaut(`la salle fermée ne dit pas l'heure publiée par le salon (${heures[1]}): ${fermee.vu.texte}`);
    if (!fermee.vu.texte.includes("Personne n'avait touché au jeu"))
      throw new Defaut(`la raison publiée par le salon n'est pas dite: ${fermee.vu.texte}`);
    // Le carnet une seule fois, au tableau des dernières parties (D12).
    const carnet = await page.evaluate(() =>
      [...document.querySelectorAll("#dernieresParties")].map((a) => [a.closest("#arrivee") !== null, a.getAttribute("href")]),
    );
    if (carnet.length !== 1 || !carnet[0][0] || carnet[0][1] !== "/profil#parties")
      throw new Defaut(`le carnet n'est pas proposé une fois sur l'écran de la salle fermée: ${JSON.stringify(carnet)}`);
    await capture(page, "fermee");
    await page.close();
  },

  /** L'extinction d'une salle fermée (plan des états, effet « extinction »),
   * lue sur de vraies captures, l'effet arrêté à trois instants. À son début,
   * l'écran est noir : aucun pixel clair. À 60 %, une ligne claire de 4 px
   * de haut au plus, sur la moitié de l'écran au moins. À 90 %, un point de
   * 4 px au plus. Elle est jouée une fois (un « animationstart » par
   * animation), rien ne tourne ensuite, et la toile du jeu garde son
   * transform, son filtre et son opacité. Jumeaux : une salle qui redémarre,
   * et le niveau « sobre », n'en jouent aucune. La version d'avant partait
   * d'un rectangle presque blanc sur tout l'écran : 813 376 px² clairs sur
   * les 922 432 du plein cadre (relecture du 24 novembre 2026). */
  async "extinction"() {
    const ecouter = (page) =>
      page.evaluate(() => {
        const e = { debuts: [], fins: [], arretee: false };
        window.__ext = e;
        const les = () => document.getAnimations().filter((a) => a.animationName?.startsWith("n3-extinction"));
        document.addEventListener(
          "animationstart",
          (ev) => {
            if (!ev.animationName.startsWith("n3-extinction")) return;
            e.debuts.push(ev.animationName);
            if (e.arretee) return;
            e.arretee = true;
            // Arrêtée à son début : la suite se règle de l'extérieur.
            for (const a of les()) {
              a.pause();
              a.currentTime = 0;
            }
          },
          true,
        );
        document.addEventListener("animationend", (ev) => ev.animationName.startsWith("n3-extinction") && e.fins.push(ev.animationName), true);
        window.__extRegler = (t) => {
          for (const a of les()) a.currentTime = t;
          return les().length;
        };
        window.__extReprendre = () => {
          for (const a of les()) a.play();
        };
        window.__extTournent = () => les().filter((a) => a.playState === "running").length;
      });
    const toile = (page) =>
      page.evaluate(() => {
        const s = getComputedStyle(document.querySelector("#screen"));
        return [s.transform, s.filter, s.opacity].join(" | ");
      });
    const fermer = (redemarre) => banc.regler({ video: "drop", ouverte: false, redemarre, fermeeDepuis: 30 });
    const conseille = JSON.stringify({ niveau: "conseille", sons: false });

    const page = await nouvelle(PC, { "nel3ab:effets": conseille });
    await entrer(page);
    await sleep(1500);
    await ecouter(page);
    const avant = await toile(page);
    fermer(false);
    const dite = await jusqua(page, (v) => /La salle 1 (est fermée|a fermé à)/.test(v.texte), 9000);
    if (dite.apres === null) throw new Precondition(`la salle fermée n'est pas dite fermée en 9 s: ${dite.vu.texte}`);
    const jouee = await page.waitForFunction(() => window.__ext.arretee, { timeout: 2000 }).catch(() => null);
    if (jouee === null) throw new Defaut("aucune extinction à la fermeture, au niveau « conseillé »");
    const ecran = await page.evaluate(() => {
      const r = document.querySelector("#arrivee .n3-plein-ecran").getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.floor(r.width), h: Math.floor(r.height) };
    });
    const duree = await page.evaluate(() =>
      Math.max(...document.getAnimations().filter((a) => a.animationName?.startsWith("n3-extinction")).map((a) => a.effect.getTiming().duration)),
    );
    const instants = {};
    for (const [nom, part] of [
      ["debut", 0],
      ["ligne", 0.6],
      ["point", 0.9],
    ]) {
      await page.evaluate((t) => window.__extRegler(t), duree * part);
      await rendu(page);
      instants[nom] = await clairs(page, ecran);
    }
    const pendant = await toile(page);
    const lu = JSON.stringify({ duree, ...instants });
    if (instants.debut.n > instants.debut.total * 0.001)
      throw new Defaut(`l'extinction commence par ${instants.debut.n} px² clairs sur ${instants.debut.total}, au lieu du noir: ${lu}`);
    if (instants.ligne.hauteur === 0 || instants.ligne.hauteur > 4 || instants.ligne.largeur < instants.ligne.w / 2)
      throw new Defaut(`pas de ligne claire à 60 % de l'extinction: ${lu}`);
    if (instants.point.hauteur > 4 || instants.point.largeur > 4) throw new Defaut(`pas de point à 90 % de l'extinction: ${lu}`);
    if (pendant !== avant) throw new Defaut(`la toile du jeu change pendant l'extinction: ${avant} puis ${pendant}`);
    await page.evaluate(() => window.__extReprendre());
    await sleep(1500);
    const fin = await page.evaluate(() => ({ ...window.__ext, tournent: window.__extTournent() }));
    const noms = new Set(fin.debuts);
    if (!noms.has("n3-extinction") || fin.debuts.length !== noms.size)
      throw new Defaut(`l'extinction n'est pas jouée une fois: ${JSON.stringify(fin.debuts)}`);
    if (fin.tournent > 0 || fin.fins.length !== noms.size) throw new Defaut(`l'extinction tourne encore après sa fin: ${JSON.stringify(fin)}`);
    console.log(JSON.stringify({ extinction: { duree, debut: instants.debut.n, ligne: [instants.ligne.largeur, instants.ligne.hauteur], point: [instants.point.largeur, instants.point.hauteur] } }));
    await capture(page, "extinction-fin");
    await page.close();

    // Jumeaux : une salle qui redémarre, puis une salle fermée au niveau sobre.
    for (const [cas, effets, redemarre, texte] of [
      ["redémarrage", conseille, true, /redémarre/],
      ["sobre", JSON.stringify({ niveau: "sobre", sons: false }), false, /La salle 1 (est fermée|a fermé à)/],
    ]) {
      const jumeau = await nouvelle(PC, { "nel3ab:effets": effets });
      await entrer(jumeau);
      await sleep(1500);
      await ecouter(jumeau);
      fermer(redemarre);
      const vu = await jusqua(jumeau, (v) => texte.test(v.texte), 9000);
      if (vu.apres === null) throw new Precondition(`${cas}: l'état attendu n'est pas dit en 9 s: ${vu.vu.texte}`);
      await sleep(1500);
      const debuts = await jumeau.evaluate(() => window.__ext.debuts);
      if (debuts.length) throw new Defaut(`${cas}: une extinction est jouée (${debuts})`);
      await jumeau.close();
    }
  },

  /** Les lignes du tube sur l'écran noir (plan des états : balayage,
   * vignette, roulement), sur le plein cadre de l'arrivée, SOUS le texte :
   * au centre et aux coins de chaque pièce du texte, c'est le texte qui
   * reçoit le point, chaque calque rendu cible du pointeur. Au niveau
   * « tout », les trois calques, de jour comme de nuit : le titre se lit à
   * 4,5:1 au moins sur le fond qui est sous lui, la vignette a son ombre et
   * ses coins, le roulement tourne, un cycle par seconde au plus. Au niveau
   * « conseillé », le balayage seul (la vignette et le roulement sont « à
   * doser », `lib/effets`). Jumeaux : un calque passé au-dessus du titre est
   * vu ; la fiche d'une image figée n'a aucun calque ; le niveau « sobre »
   * n'en montre aucun. Le 24 novembre 2026, le balayage était posé après le
   * titre et le couvrait (relecture du chantier). */
  async "calques-attente"() {
    const fautes = [];
    for (const [theme, niveau, attendus] of [
      ["jour", "tout", ["rt-calque-balayage", "rt-calque-vignette", "rt-calque-roulement"]],
      ["nuit", "tout", ["rt-calque-balayage", "rt-calque-vignette", "rt-calque-roulement"]],
      ["jour", "conseille", ["rt-calque-balayage"]],
    ]) {
      const cas = `${theme} ${niveau}`;
      const page = await nouvelle(PC, { "nel3ab:theme": theme, "nel3ab:effets": JSON.stringify({ niveau, sons: false }) });
      banc.regler({ video: "freeze" });
      await page.click("#enter");
      if ((await page.waitForSelector("#arrivee", { visible: true, timeout: 8000 }).catch(() => null)) === null)
        throw new Precondition(`${cas}: pas de plein cadre à l'arrivée`);
      await sleep(600);
      const vus = await page.evaluate(CALQUES_VUS);
      if (JSON.stringify([...vus].sort()) !== JSON.stringify([...attendus].sort()))
        fautes.push(`${cas}: calques posés ${JSON.stringify(vus)}, attendus ${JSON.stringify(attendus)}`);
      const sous = await page.evaluate(TEXTE_SOUS_CALQUE);
      if (sous.pieces < 2) throw new Precondition(`${cas}: ${sous.pieces} pièces de texte dans le plein cadre`);
      fautes.push(...sous.fautes.slice(0, 4).map((f) => `${cas}: une ligne du tube sur le texte, ${f}`));
      const m = await page.evaluate(() => {
        const rgb = (c) => {
          const v = /rgba?\(([^)]+)\)/.exec(c)?.[1].split(/[ ,/]+/).filter(Boolean).map(Number);
          return v ? { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 } : null;
        };
        const lum = ({ r, g, b }) =>
          [r, g, b].map((x) => (x / 255 <= 0.03928 ? x / 255 / 12.92 : ((x / 255 + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
        const titre = document.querySelector("#arrivee .n3-plein-titre");
        let fond = null;
        for (let e = titre; e && !fond; e = e.parentElement) {
          const c = rgb(getComputedStyle(e).backgroundColor);
          if (c && c.a === 1) fond = c;
        }
        const [x, y] = [lum(rgb(getComputedStyle(titre).color)), lum(fond)].sort((p, q) => q - p);
        const vignette = getComputedStyle(document.querySelector("#arrivee .rt-calque-vignette"));
        const roule = document.querySelector("#arrivee .rt-calque-roulement").getAnimations();
        return {
          rapport: Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100,
          vignette: [vignette.boxShadow, vignette.borderTopLeftRadius],
          roulement: roule.map((a) => [a.effect.getTiming().duration, a.effect.getTiming().iterations]),
        };
      });
      if (m.rapport < 4.5) fautes.push(`${cas}: le titre du plein cadre à ${m.rapport}:1 sur son fond`);
      if (attendus.includes("rt-calque-vignette") && (m.vignette[0] === "none" || m.vignette[1] === "0px"))
        fautes.push(`${cas}: la vignette n'a pas son ombre et ses coins: ${m.vignette}`);
      if (attendus.includes("rt-calque-roulement") && (m.roulement.length !== 1 || !(m.roulement[0][0] >= 1000)))
        fautes.push(`${cas}: le roulement ne tourne pas en un cycle par seconde au plus: ${JSON.stringify(m.roulement)}`);
      console.log(JSON.stringify({ calques: cas, titre: m.rapport, roulement: m.roulement, texte: `${sous.pieces} pièces, ${sous.points} points` }));
      // Le jumeau de la mesure : le balayage passé au-dessus de la plaque.
      await page.evaluate(() => {
        document.querySelector("#arrivee .rt-calque-balayage").style.zIndex = "5";
      });
      const dessus = await page.evaluate(TEXTE_SOUS_CALQUE);
      if (dessus.fautes.length === 0) throw new Precondition(`${cas}: un balayage posé sur le titre n'est pas vu`);
      await page.close();
    }
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
    // Jumeaux : la fiche d'une image figée, puis l'arrivée au niveau sobre.
    const fiche = await nouvelle(PC);
    await entrer(fiche);
    await jusquALaFiche(fiche);
    const surFiche = await fiche.evaluate(CALQUES_VUS);
    if (surFiche.length) throw new Defaut(`des calques du tube avec la fiche d'une image figée: ${surFiche}`);
    await fiche.close();
    const sobre = await nouvelle(PC, { "nel3ab:effets": JSON.stringify({ niveau: "sobre", sons: false }) });
    banc.regler({ video: "freeze" });
    await sobre.click("#enter");
    if ((await sobre.waitForSelector("#arrivee", { visible: true, timeout: 8000 }).catch(() => null)) === null)
      throw new Precondition("sobre: pas de plein cadre à l'arrivée");
    await sleep(600);
    const auSobre = await sobre.evaluate(CALQUES_VUS);
    if (auSobre.length) throw new Defaut(`des calques du tube au niveau « sobre »: ${auSobre}`);
    await sobre.close();
  },

  /** Une salle qui refuse l'arrivée n'a jamais répondu: « ne répond pas ». */
  async "arrivee-refusee"() {
    const page = await nouvelle(TELEPHONE);
    banc.regler({ video: "drop" });
    await page.click("#enter");
    const vu = await jusqua(page, (v) => v.texte.includes("La salle 1 ne répond pas."), 9000);
    if (vu.apres === null) throw new Defaut(`l'arrivée refusée ne dit pas « ne répond pas »: ${vu.vu.texte}`);
    // Réessayer, et LA sortie : les autres salles sous un salon, quitter la
    // salle servie seule. Le plein cadre se voit (ADR D40 : sous son jeton).
    const sorties = await page.evaluate(() => [
      document.querySelector("#arrivee #reessayer") !== null,
      document.querySelector("#arrivee :is(#lesSalles, #quitterSalle)") !== null,
      getComputedStyle(document.querySelector("#arrivee")).display !== "none",
    ]);
    if (sorties.includes(false)) throw new Defaut(`le rideau n'a pas ses deux sorties: ${sorties}`);
    await capture(page, "arrivee-refusee");
    await page.close();
  },

  /** La première image coupe le plein cadre DANS LA MÊME image d'écran
   * (ADR D40). Le rideau d'avant était retiré par React au relevé suivant,
   * jusqu'à 500 ms plus tard : la proposition du 23 novembre 2026 a compté
   * dix images peintes dessous. Chaque dessin sur la toile du jeu est compté
   * au moment où il a lieu, et une microtâche regarde, avant que le
   * navigateur ne rende l'image, si le plein cadre se voit encore.
   *
   * Aïn joue sur le plateau du plein cadre : la même image d'écran le
   * renvoie. Chaque sprite visible qui touche le rectangle de la toile à
   * + 4 px est relevé AU RENDU, par un ResizeObserver créé après ceux de la
   * mascotte : le navigateur les sert dans l'ordre de leur création, après
   * les rappels d'animation et avant de peindre. Un observateur créé avant
   * eux voit encore le sprite que la mascotte retire dans la même mise à
   * jour du rendu (relecture du 24 novembre 2026, tracée le même jour :
   * 4 219 px² vus par un observateur créé tôt, aucun par un créé après).
   * Le cas n'est exercé que si Aïn était sur le plateau au dernier rendu
   * sans image. */
  async "premiere-image-coupe"() {
    const fautes = [];
    const exerces = [];
    const formats = [];
    for (const [vue, reduit] of [
      [PC, false],
      [TELEPHONE, false],
      [PC, true],
    ]) {
      const nom = `${vue.width}x${vue.height}${reduit ? " en mouvement réduit" : ""}`;
      const page = await nouvelle(vue);
      if (reduit) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
      await page.evaluate(() => {
        const etat = {
          peintes: 0,
          sous: 0,
          vuAvant: false,
          fin: false,
          retenues: 0,
          premiere: null,
          levee: null,
          deformees: [],
          justes: 0,
        };
        window.__coupe = etat;
        const affiche = () => {
          const el = document.querySelector("#arrivee");
          return el !== null && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
        };
        // La boîte CSS de la toile a-t-elle le format de ses pixels, à 2 %
        // près ? Lu sur la boîte rendue, pas sur ce que la page en dit.
        const format = () => {
          const c = document.getElementById("screen");
          const r = c.getBoundingClientRect();
          const image = c.width / c.height;
          const boite = r.width / r.height;
          return { juste: r.height > 0 && Math.abs(boite - image) <= 0.02 * image, intrinseque: [c.width, c.height], css: [Math.round(r.width), Math.round(r.height)] };
        };
        const relever = (ou) => {
          if (affiche()) {
            // Sous le plein cadre : permis seulement le temps que la toile
            // prenne le format de l'image (`couverture.decouvrir`).
            if (format().juste) return "sous";
            etat.retenues += 1;
            return "retenue";
          }
          if (etat.levee === null) etat.levee = performance.now();
          const f = format();
          if (f.juste) etat.justes += 1;
          else if (etat.deformees.length < 400) etat.deformees.push({ ou, peintes: etat.peintes, ...f });
          return "vue";
        };
        const dessiner = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (...a) {
          const rendu = dessiner.apply(this, a);
          if (this.canvas?.id === "screen") {
            etat.peintes += 1;
            if (etat.premiere === null) etat.premiere = performance.now();
            queueMicrotask(() => {
              if (relever("image") === "sous") etat.sous += 1;
            });
          }
          return rendu;
        };
        // Le tour d'animation passe AVANT la boucle de peinture dans chaque
        // image d'écran : une levée qui attendait sa boîte part au tic de la
        // boucle, après lui. Une couverture sur une boîte juste n'est donc une
        // faute ici que si le tour suivant la voit encore.
        let sousAvant = false;
        const tour = () => {
          if (etat.fin) return;
          if (etat.peintes === 0 && affiche()) etat.vuAvant = true;
          else if (etat.peintes > 0) {
            const vu = relever("tour");
            if (vu === "sous" && sousAvant) etat.sous += 1;
            sousAvant = vu === "sous";
          }
          requestAnimationFrame(tour);
        };
        requestAnimationFrame(tour);
        // Aïn sur la toile, relevé au rendu (voir plus haut). Posé plus tard,
        // une fois la mascotte installée sur le plateau.
        etat.ainAvant = null;
        etat.ainSur = [];
        window.__releverAin = () => {
          const sprites = (toile) => {
            const t = toile.getBoundingClientRect();
            const m = 4;
            return [...document.querySelectorAll(".rt-ain-calque canvas.rt-ain-sprite")]
              .filter((c) => {
                if (c.hidden) return false;
                const st = getComputedStyle(c);
                return st.display !== "none" && st.visibility !== "hidden" && Number(st.opacity) > 0;
              })
              .map((c) => {
                const r = c.getBoundingClientRect();
                const w = Math.min(r.right, t.right + m) - Math.max(r.left, t.left - m);
                const h = Math.min(r.bottom, t.bottom + m) - Math.max(r.top, t.top - m);
                return { acteur: c.dataset.acteur ?? "?", aire: w > 0 && h > 0 ? Math.round(w * h) : 0 };
              })
              .filter((v) => v.aire > 0);
          };
          const temoin = document.createElement("i");
          Object.assign(temoin.style, { position: "fixed", left: "-40px", top: "0", width: "1px", height: "1px" });
          document.body.append(temoin);
          let bascule = false;
          new ResizeObserver(() => {
            if (etat.fin) return;
            const toile = document.getElementById("screen");
            if (!toile) return;
            const vus = sprites(toile);
            if (etat.peintes === 0) etat.ainAvant = vus.length > 0;
            else if (vus.length) etat.ainSur.push({ peintes: etat.peintes, vus });
          }).observe(temoin);
          const pousser = () => {
            if (etat.fin) return;
            bascule = !bascule;
            temoin.style.width = bascule ? "2px" : "1px";
            requestAnimationFrame(pousser);
          };
          requestAnimationFrame(pousser);
        };
      });
      // La salle répond sans image : l'arrivée se montre, puis l'image vient.
      banc.regler({ video: "freeze" });
      await page.click("#enter");
      const lu = () => page.evaluate(() => window.__coupe);
      const debut = Date.now();
      while (!(await lu()).vuAvant && Date.now() - debut < 8000) await sleep(100);
      if (!(await lu()).vuAvant) throw new Precondition(`${nom}: le plein cadre ne s'est jamais montré avant l'image`);
      // Aïn sur le plateau d'abord : sa scène d'arrivée ou sa pose clé. Une
      // page d'avant n'a ni plateau ni mascotte : la mesure d'Aïn ne la
      // concerne pas, celle du plein cadre si.
      const plateau = await page
        .waitForFunction(() => document.querySelector('#arrivee [data-hote="plateau"] .rt-mascotte') !== null, { timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (plateau) await page.evaluate(() => window.__releverAin());
      const avantAin = Date.now();
      while (plateau && (await lu()).ainAvant !== true && Date.now() - avantAin < 4000) await sleep(25);
      banc.regler({ video: "live" });
      while ((await lu()).peintes < 30 && Date.now() - debut < 20000) await sleep(100);
      if ((await lu()).peintes < 30) throw new Precondition(`${nom}: moins de 30 images peintes`);
      await sleep(1000);
      const fin = await page.evaluate(() => {
        window.__coupe.fin = true;
        return window.__coupe;
      });
      if (fin.sous > 0) fautes.push(`${nom}: ${fin.sous} relevés d'une image peinte sous le plein cadre`);
      // Aucune image vue dans une boîte d'un autre format (relecture finale
      // du 25 novembre 2026 : la toile était encore taillée en carré, 13
      // images étirées à 1440x900), et la levée qui attend la boîte ne
      // traîne pas : 100 ms au plus après la première image.
      if (fin.deformees.length)
        fautes.push(
          `${nom}: ${fin.deformees.length} relevés d'une image vue hors de son format, le premier ${JSON.stringify(fin.deformees[0])}`,
        );
      if (fin.justes === 0) throw new Precondition(`${nom}: aucune image vue après la levée`);
      if (fin.levee === null || fin.levee - fin.premiere > 100)
        fautes.push(`${nom}: le plein cadre levé ${fin.levee === null ? "jamais" : `${Math.round(fin.levee - fin.premiere)} ms`} après la première image (${fin.retenues} relevés retenus)`);
      formats.push({ vue: nom, retenues: fin.retenues, levee_ms: fin.levee === null ? null : Math.round(fin.levee - fin.premiere) });
      if (plateau) {
        if (fin.ainAvant !== true) throw new Precondition(`${nom}: Aïn n'était pas sur le plateau au dernier rendu sans image`);
        exerces.push(nom);
        if (fin.ainSur.length)
          fautes.push(`${nom}: Aïn sur la toile à ${fin.ainSur.length} rendus, dès l'image ${fin.ainSur[0].peintes} (${JSON.stringify(fin.ainSur[0].vus)})`);
      }
      await page.close();
    }
    console.log(JSON.stringify({ formats }));
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
    console.log(JSON.stringify({ ain_exerce: exerces }));
  },

  /** Un chargement perdu dit qui peut le relancer, et « ou choisir un autre
   * jeu » seulement à la personne qui choisit le jeu (décision du chef de
   * chantier, 24 novembre 2026). Seule la phrase était éprouvée : le
   * câblage de la salle (`relance` d'App.tsx) pouvait dire « moi » à tout
   * le monde sans qu'aucun essai ne rougisse (relecture finale du
   * 25 novembre 2026). Deux rôles : banc choisit le jeu, puis Sami. Le
   * plafond de 60 s est franchi en avançant `performance.now` de la page,
   * pas en attendant. */
  async "echec-qui-relance"() {
    const fautes = [];
    const lues = {};
    for (const chef of ["moi", "autre"]) {
      const page = await nouvelle(PC, {}, { chef }, () => {
        const vrai = performance.now.bind(performance);
        window.__avance = 0;
        performance.now = () => vrai() + window.__avance;
      });
      await entrer(page);
      banc.regler({ video: "freeze" });
      banc.annoncerDemarrage();
      const charge = await page
        .waitForSelector("#booting", { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (!charge) throw new Precondition(`${chef}: l'écran de chargement ne vient pas après l'annonce du salon`);
      await page.evaluate(() => {
        window.__avance = 61_000;
      });
      const dite = await page
        .waitForFunction(() => document.querySelector("#ligneParlee")?.textContent.includes("Aucune image"), { timeout: 5000 })
        .then(() => page.$eval("#ligneParlee", (p) => p.textContent.trim()))
        .catch(() => null);
      if (dite === null) throw new Precondition(`${chef}: la ligne parlée ne dit pas l'échec du chargement`);
      lues[chef] = dite;
      if (chef === "moi" && !dite.includes("Tu peux le relancer ou choisir un autre jeu."))
        fautes.push(`qui choisit le jeu entend « ${dite} »`);
      if (chef === "autre") {
        if (dite.includes("choisir un autre jeu")) fautes.push(`un autre joueur entend « ${dite} »`);
        if (!dite.includes("Sami peut le relancer.")) fautes.push(`un autre joueur n'apprend pas qui relance : « ${dite} »`);
      }
      banc.regler({ video: "live" });
      await page.close();
    }
    console.log(JSON.stringify(lues));
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
  },

  /** La pastille d'une image figée ne touche pas l'image peinte, à + 4 px
   * (ADR D40), au bureau, au téléphone et en paysage. La page d'avant la
   * posait en bas de l'image : son « #liaison » de pastille est lu aussi.
   * Elle ne touche pas non plus la tête d'Aïn, sa maison au téléphone
   * (`[data-hote="barre"]`), et le centre de la tête la reçoit : à 375x667,
   * posée dans la barre, elle en couvrait 252 px² (relecture du
   * 24 novembre 2026).
   * Le gel est lu dans l'état de la page : en paysage avec le panneau
   * « petit », la page ne pose la pastille nulle part plutôt que sur
   * l'image (`placeDeLaPastille`), et ce n'est pas une faute ; trois tailles
   * au moins doivent la montrer, sinon l'étape ne prouve rien. */
  async "pastille-hors-image"() {
    const fautes = [];
    const vues = [];
    const tetes = [];
    for (const vue of [
      PC,
      { width: 1280, height: 720 },
      TELEPHONE,
      { width: 375, height: 667, isMobile: true, hasTouch: true },
      { width: 844, height: 390, isMobile: true, hasTouch: true },
    ]) {
      const nom = `${vue.width}x${vue.height}`;
      const page = await nouvelle(vue);
      await entrer(page);
      await sleep(1500);
      banc.regler({ video: "freeze" });
      const vu = await jusqua(page, (v) => v.etat === "figee" || v.liaison?.etat === "figee", 4000);
      if (vu.apres === null) throw new Precondition(`${nom}: aucun état figé en 4 s`);
      await sleep(500);
      const mesure = await page.evaluate(() => {
        const p = document.querySelector("#pastilleEtat") ?? document.querySelector("#liaison");
        const t = document.querySelector("#screen");
        if (!t) return { erreur: "pas de toile" };
        if (!p) return { aucune: true };
        const a = p.getBoundingClientRect();
        const b = t.getBoundingClientRect();
        const m = 4;
        const coupe =
          a.width > 0 &&
          a.left < b.right + m &&
          a.right > b.left - m &&
          a.top < b.bottom + m &&
          a.bottom > b.top - m;
        // La tête d'Aïn, là où la salle la pose au téléphone.
        const aire = (x, y) =>
          Math.max(0, Math.min(x.right, y.right) - Math.max(x.left, y.left)) *
          Math.max(0, Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top));
        const tete = [...document.querySelectorAll('[data-hote="barre"]')]
          .map((h) => [h, h.getBoundingClientRect()])
          .filter(([, r]) => r.width > 0 && r.height > 0)
          .map(([h, r]) => {
            const centre = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { sur: Math.round(aire(a, r)), recoit: centre !== null && h.contains(centre), r: [r.left, r.top, r.width, r.height].map(Math.round) };
          });
        return { coupe, tete, a: [a.left, a.top, a.width, a.height].map(Math.round), b: [b.left, b.top, b.width, b.height].map(Math.round) };
      });
      if (mesure.erreur) throw new Precondition(`${nom}: ${mesure.erreur}`);
      if (!mesure.aucune) vues.push(nom);
      if (mesure.coupe) fautes.push(`${nom}: pastille ${mesure.a} sur l'image ${mesure.b}`);
      for (const t of mesure.tete ?? []) {
        tetes.push(nom);
        if (t.sur > 0 || !t.recoit) fautes.push(`${nom}: pastille ${mesure.a} sur la tête d'Aïn ${t.r} (${t.sur} px², centre ${t.recoit ? "reçu" : "couvert"})`);
      }
      await capture(page, "pastille-hors-image");
      banc.regler({ video: "live" });
      await page.close();
    }
    // Une tablette couchée, un jeu GameCube en « entier », et la fermeture
    // annoncée sur une image VIVANTE : le fronton n'y mesure que 42 px, et la
    // pastille « Ferme dans 5 min », un bouton de 44 px au doigt, débordait
    // de 1 px sur la première rangée de l'image (relecture finale du
    // 25 novembre 2026). Le point au milieu de la pastille, sur cette rangée,
    // doit rendre la toile.
    {
      const nom = "1080x810 entier gc, fermeture";
      const page = await nouvelle({ width: 1080, height: 810, isMobile: true, hasTouch: true }, { "nel3ab:fit": "entier" }, { console: "gc" });
      await entrer(page);
      await sleep(1000);
      banc.annoncerFermeture(5);
      const vue = await page
        .waitForFunction(() => document.querySelector("#pastilleEtat")?.textContent.includes("Ferme"), { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      const mesure = await page.evaluate(() => {
        const p = document.querySelector("#pastilleEtat");
        const t = document.querySelector("#screen");
        if (!t) return { erreur: "pas de toile" };
        const ecran = document.querySelector("[data-cadre]")?.getAttribute("data-mode") ?? null;
        const b = t.getBoundingClientRect();
        // Le fronton du cadre doit exister : sans bande au-dessus de l'image,
        // le cas de la relecture n'est pas exercé.
        if (b.top < 40) return { erreur: `image à ${Math.round(b.top)} px du haut, pas de fronton`, ecran };
        if (!p) return { aucune: true, ecran };
        const a = p.getBoundingClientRect();
        const m = 4;
        const coupe = a.left < b.right + m && a.right > b.left - m && a.top < b.bottom + m && a.bottom > b.top - m;
        const x = Math.round(Math.min(Math.max(a.left + a.width / 2, b.left + 1), b.right - 1));
        const recoit = document.elementFromPoint(x, Math.floor(b.top) + 0.5);
        return {
          coupe,
          ecran,
          toileRecoit: recoit === t,
          recoit: recoit ? `${recoit.tagName}#${recoit.id}` : null,
          a: [a.left, a.top, a.width, a.height].map(Math.round),
          b: [b.left, b.top, b.width, b.height].map(Math.round),
        };
      });
      if (mesure.erreur) throw new Precondition(`${nom}: ${mesure.erreur}`);
      if (!vue && !mesure.aucune) throw new Precondition(`${nom}: la fermeture n'est pas dite en 5 s`);
      if (!mesure.aucune) vues.push(nom);
      if (mesure.coupe) fautes.push(`${nom}: pastille ${mesure.a} à moins de 4 px de l'image ${mesure.b}`);
      if (!mesure.aucune && !mesure.toileRecoit)
        fautes.push(`${nom}: la première rangée de l'image sous la pastille rend ${mesure.recoit}, pas la toile`);
      console.log(JSON.stringify({ tablette: mesure }));
      banc.annoncerFermeture(0);
      // Le stockage est celui du navigateur entier : « entier » laissé là
      // passait aux étapes suivantes (colonne-stable l'a vu le 25 novembre
      // 2026).
      await page.evaluate(() => localStorage.removeItem("nel3ab:fit"));
      await page.close();
    }
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
    if (vues.length < 3) throw new Precondition(`pastille montrée à ${vues.length} tailles seulement (${vues})`);
    console.log(JSON.stringify({ pastille_montree: vues, tete_mesuree: tetes }));
    if (!tetes.includes("375x667")) throw new Precondition(`la tête d'Aïn n'est pas mesurée à 375x667 (${tetes})`);
  },

  /** La pastille se lit dans les deux régies. Son fond est l'écran noir de la
   * borne dans les deux thèmes ; de jour, ses jetons prenaient leurs valeurs
   * claires sur ce noir, et le compteur du gel tombait à 1,16:1 (relecture
   * du 24 novembre 2026). Mesurés de jour et de nuit sur la vraie pastille
   * d'une image figée : son texte et son compteur à 4,5:1 au moins (WCAG
   * 1.4.3), son bord à 3:1 (WCAG 1.4.11). Le jumeau : un compteur repeint
   * dans la couleur du fond est vu. */
  async "pastille-contraste"() {
    const fautes = [];
    const lus = [];
    for (const theme of ["jour", "nuit"]) {
      const page = await nouvelle(PC, { "nel3ab:theme": theme });
      const pose = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
      if (pose !== theme) throw new Precondition(`le thème ${theme} n'est pas posé: ${pose}`);
      await entrer(page);
      await sleep(1500);
      banc.regler({ video: "freeze" });
      const vue = await page
        .waitForFunction(() => document.querySelector("#pastilleEtat .n3-pastille-compteur")?.textContent.trim(), { timeout: 6000 })
        .catch(() => null);
      if (vue === null) throw new Precondition(`${theme}: pas de pastille avec son compteur en 6 s de gel`);
      await sleep(300);
      const m = await page.evaluate(CONTRASTE_PASTILLE);
      if (m.erreur) throw new Precondition(`${theme}: ${m.erreur}`);
      lus.push(`${theme} texte ${m.texte.rapport} compteur ${m.compteur.rapport} bord ${m.bord.rapport}`);
      if (m.texte.rapport < 4.5) fautes.push(`${theme}: texte « ${m.texte.texte} » ${m.texte.couleur} sur ${m.fond}, ${m.texte.rapport}:1`);
      if (m.compteur.rapport < 4.5)
        fautes.push(`${theme}: compteur « ${m.compteur.texte} » ${m.compteur.couleur} sur ${m.fond}, ${m.compteur.rapport}:1`);
      if (m.bord.rapport < 3) fautes.push(`${theme}: bord ${m.bord.couleur} sur ${m.fond}, ${m.bord.rapport}:1`);
      // Le jumeau : la même mesure voit un compteur peint dans son fond.
      await page.evaluate((f) => {
        const c = document.querySelector("#pastilleEtat .n3-pastille-compteur");
        for (const e of [c, ...c.querySelectorAll("*")]) e.style.setProperty("color", f, "important");
      }, m.fond);
      const terni = await page.evaluate(CONTRASTE_PASTILLE);
      if (terni.compteur.rapport >= 4.5) throw new Precondition(`${theme}: un compteur peint dans son fond n'est pas vu (${terni.compteur.rapport}:1)`);
      banc.regler({ video: "live" });
      await page.close();
    }
    console.log(JSON.stringify({ pastille_contraste: lus }));
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
  },

  /** « Je reste » part vraiment (D16) : la salle annonce sa fermeture, un
   * vrai clic sur #jeReste au centre qui le reçoit, le banc reçoit l'octet
   * de « je reste » sur la socket de la place, et la pastille part quand le
   * message de salle suivant n'annonce plus rien. Avant ce pas, aucun pilote
   * de porte ne cliquait #jeReste, et un mutant `onRester: () => {}`
   * passait toutes les portes (relecture du 24 novembre 2026). Le jumeau :
   * un spectateur voit la pastille, sans « Je reste » ni octet envoyé. */
  async "je-reste"() {
    const PASTILLE = '#pastilleEtat[data-etat="fermeture"]';
    // Le joueur de la place 1.
    const page = await nouvelle(PC);
    await entrer(page);
    await sleep(1500);
    const debut = Date.now();
    banc.annoncerFermeture(5);
    if ((await page.waitForSelector(PASTILLE, { timeout: 4000 }).catch(() => null)) === null)
      throw new Precondition("pas de pastille de fermeture 4 s après l'annonce");
    const bouton = await page.waitForSelector("#jeReste", { visible: true, timeout: 3000 }).catch(() => null);
    if (bouton === null) throw new Defaut("l'annonce de fermeture ne propose pas « Je reste » à la place 1");
    const centre = await page.evaluate(() => {
      const b = document.querySelector("#jeReste");
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const vu = document.elementFromPoint(x, y);
      return { x, y, recoit: vu !== null && b.contains(vu), vu: vu ? `${vu.tagName}#${vu.id}.${vu.className}` : null };
    });
    if (!centre.recoit) throw new Defaut(`« Je reste » ne reçoit pas le point en son centre: ${centre.vu}`);
    if (banc.restes(debut).length) throw new Precondition("un « je reste » est arrivé avant le clic");
    await page.mouse.click(centre.x, centre.y);
    const recu = Date.now();
    while (banc.restes(debut).length === 0 && Date.now() - recu < 2000) await sleep(50);
    const restes = banc.restes(debut);
    if (restes.length !== 1) throw new Defaut(`un clic sur « Je reste » a envoyé ${restes.length} « je reste » au banc, un attendu`);
    const partie = await page.waitForFunction((sel) => document.querySelector(sel) === null, { timeout: 3000 }, PASTILLE).catch(() => null);
    if (partie === null) throw new Defaut("la pastille de fermeture reste après « Je reste » et un message de salle sans fermeture");
    await page.close();
    // Le jumeau : un spectateur, sans place.
    const spectateur = await nouvelle(PC);
    banc.regler({ place: 0 });
    await entrer(spectateur);
    await sleep(1500);
    const avant = Date.now();
    banc.annoncerFermeture(5);
    if ((await spectateur.waitForSelector(PASTILLE, { timeout: 4000 }).catch(() => null)) === null)
      throw new Precondition("le spectateur ne voit pas la pastille de fermeture");
    await sleep(800);
    if ((await spectateur.$("#jeReste")) !== null) throw new Defaut("un spectateur se voit proposer « Je reste »");
    if (banc.restes(avant).length) throw new Defaut("un spectateur a envoyé « je reste »");
    await spectateur.close();
  },

  /** La pastille mène au geste de sa fiche (ADR D40) : un vrai clic au
   * bureau met le focus sur « Relancer l'image » dans la colonne ; un doigt
   * au téléphone ouvre la feuille agrandie et l'y met. Au doigt, la pastille
   * fait 44 px au moins dans les deux axes. Le jumeau : avant la fiche, la
   * pastille est un voyant, pas un bouton, et rien n'a le geste. */
  async "pastille-mene-au-geste"() {
    for (const vue of [PC, TELEPHONE]) {
      const nom = `${vue.width}x${vue.height}`;
      const page = await nouvelle(vue);
      await entrer(page);
      await sleep(1500);
      banc.regler({ video: "freeze" });
      const voyant = await jusqua(page, (v) => v.liaison?.etat === "figee", 4000);
      if (voyant.apres === null) throw new Precondition(`${nom}: aucun gel lu en 4 s`);
      const avant = await page.evaluate(() => ({
        balise: document.querySelector("#pastilleEtat")?.tagName ?? null,
        geste: document.querySelector("#relancerImage") !== null,
      }));
      if (avant.geste) throw new Precondition(`${nom}: la fiche est déjà là avant 5 s de gel`);
      if (avant.balise !== null && avant.balise !== "DIV")
        throw new Defaut(`${nom}: la pastille seule est un ${avant.balise}, un bouton qui ne mène à rien`);
      const pastille = await page.waitForSelector("button#pastilleEtat", { timeout: 6000 }).catch(() => null);
      if (pastille === null) throw new Defaut(`${nom}: la pastille de la fiche n'est pas un bouton`);
      await sleep(300);
      const ou = await page.evaluate(() => {
        const p = document.querySelector("#pastilleEtat");
        const r = p.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const sous = document.elementFromPoint(x, y);
        return { x, y, w: r.width, h: r.height, recoit: sous?.closest("#pastilleEtat") !== null, coarse: matchMedia("(pointer: coarse)").matches };
      });
      if (!ou.recoit) throw new Defaut(`${nom}: la pastille ne reçoit pas le point en son centre`);
      if (vue === TELEPHONE) {
        if (!ou.coarse) throw new Precondition(`${nom}: le pointeur n'est pas grossier`);
        if (ou.w < 44 || ou.h < 44) throw new Defaut(`${nom}: pastille de ${Math.round(ou.w)}x${Math.round(ou.h)} px au doigt`);
        await page.touchscreen.tap(ou.x, ou.y);
      } else await page.mouse.click(ou.x, ou.y);
      const focus = await page
        .waitForFunction(() => document.activeElement?.id === "relancerImage", { timeout: 2000 })
        .then(() => "relancerImage")
        .catch(() => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));
      if (focus !== "relancerImage") throw new Defaut(`${nom}: après la pastille, le focus est sur « ${focus} »`);
      if (vue === TELEPHONE) {
        const feuille = await page.evaluate(() => {
          const f = document.querySelector("#feuilleSalle");
          return f ? { ouverte: f.open, hauteur: f.dataset.hauteur, dedans: f.contains(document.activeElement) } : null;
        });
        if (!feuille?.ouverte || feuille.hauteur !== "agrandie" || !feuille.dedans)
          throw new Defaut(`${nom}: la pastille n'ouvre pas la feuille agrandie sur son geste: ${JSON.stringify(feuille)}`);
        // La feuille fermée rend le focus à la pastille qui l'avait ouverte.
        await page.click("#fermerFeuille");
        const rendu = await page
          .waitForFunction(() => document.activeElement?.id === "pastilleEtat", { timeout: 2000 })
          .then(() => "pastilleEtat")
          .catch(() => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));
        if (rendu !== "pastilleEtat") throw new Defaut(`${nom}: la feuille fermée rend le focus à « ${rendu} »`);
      }
      await capture(page, "pastille-mene-au-geste");
      banc.regler({ video: "live" });
      await page.close();
    }
  },

  /** Une image ARRÊTÉE peut être assombrie, à sa fiche seulement, et la
   * toute première image nouvelle la rend intacte (K20, ADR D40). Chaque
   * dessin sur la toile est vérifié dans une microtâche, avant que le
   * navigateur ne rende l'image. Le jumeau : pendant la pastille seule,
   * l'image arrêtée reste intacte. */
  async "gel-image-passee"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await page.evaluate(() => {
      const etat = { peintes: 0, sombres: 0 };
      window.__passee = etat;
      const toile = () => document.querySelector("#screen");
      const dessiner = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...a) {
        const rendu = dessiner.apply(this, a);
        if (this.canvas?.id === "screen") {
          etat.peintes += 1;
          queueMicrotask(() => {
            if (getComputedStyle(toile()).opacity !== "1") etat.sombres += 1;
          });
        }
        return rendu;
      };
    });
    const opacite = () => page.evaluate(() => getComputedStyle(document.querySelector("#screen")).opacity);
    await sleep(1500);
    banc.regler({ video: "freeze" });
    const voyant = await jusqua(page, (v) => v.liaison?.etat === "figee", 4000);
    if (voyant.apres === null) throw new Precondition("aucun gel lu en 4 s");
    if ((await page.$("#relancerImage")) !== null) throw new Precondition("la fiche est là dès le gel");
    const pendantLaPastille = await opacite();
    if (pendantLaPastille !== "1") throw new Defaut(`l'image est assombrie dès la pastille: opacité ${pendantLaPastille}`);
    if ((await page.waitForSelector("#relancerImage", { timeout: 6000 }).catch(() => null)) === null)
      throw new Precondition("pas de fiche en 6 s de plus");
    await sleep(200);
    const aLaFiche = await opacite();
    if (aLaFiche !== "0.5") throw new Defaut(`l'image arrêtée n'est pas assombrie à sa fiche: opacité ${aLaFiche}`);
    const avant = await page.evaluate(() => ({ ...window.__passee }));
    banc.regler({ video: "live" });
    const debut = Date.now();
    while ((await page.evaluate(() => window.__passee.peintes)) - avant.peintes < 60 && Date.now() - debut < 10000) await sleep(100);
    const apres = await page.evaluate(() => ({ ...window.__passee }));
    if (apres.peintes - avant.peintes < 60) throw new Precondition(`${apres.peintes - avant.peintes} images peintes après le gel`);
    if (apres.sombres > 0) throw new Defaut(`${apres.sombres} images nouvelles peintes assombries`);
    await page.close();
  },

  /** Le réseau de l'appareil coupé, prouvé du côté du banc. La pastille
   * « Plus de réseau » hors de l'image, la fiche dans la colonne, et sur
   * l'image rien d'autre que la neige ou la toile. Le jumeau : le réseau
   * revient, l'état part et la couverture avec lui. */
  async "coupee-reseau"() {
    const page = await nouvelle(PC);
    await entrer(page);
    await sleep(2000);
    await couperLeReseau(page);
    const coupee = await jusqua(page, (v) => v.liaison?.etat === "coupee", 5000);
    if (coupee.apres === null) throw new Precondition(`pas d'état coupé en 5 s: ${JSON.stringify(coupee.vu)}`);
    await sleep(300);
    // L'image d'abord : la page d'avant y posait son bandeau.
    const image = await page.evaluate(DANS_L_IMAGE);
    if (image.erreur) throw new Precondition(image.erreur);
    if (image.fautes.length) throw new Defaut(`sur l'image coupée: ${image.fautes.slice(0, 4).join(" ; ")}`);
    const dit = await jusqua(page, (v) => v.texte.includes("Plus de réseau"), 3000);
    if (dit.apres === null) throw new Defaut(`la coupure n'est pas dite « Plus de réseau »: ${JSON.stringify(dit.vu)}`);
    const lu = await page.evaluate(() => {
      const p = document.querySelector("#pastilleEtat");
      const t = document.querySelector("#screen").getBoundingClientRect();
      const a = p?.getBoundingClientRect();
      const m = 4;
      return {
        pastille: a ? [a.left, a.top, a.width, a.height].map(Math.round) : null,
        coupe: a ? a.width > 0 && a.left < t.right + m && a.right > t.left - m && a.top < t.bottom + m && a.bottom > t.top - m : null,
        ficheDansLaColonne: document.querySelector("#side #liaison[data-etat=coupee]") !== null,
      };
    });
    if (lu.pastille === null) throw new Defaut("pas de pastille pour une connexion coupée");
    if (lu.coupe) throw new Defaut(`la pastille ${lu.pastille} touche l'image`);
    if (!lu.ficheDansLaColonne) throw new Defaut("la fiche de la coupure n'est pas dans la colonne");
    await capture(page, "coupee-reseau");
    await page.setOfflineMode(false);
    const revenu = await jusqua(page, (v) => v.etat === null && v.ligne === "L'image est revenue.", 8000);
    if (revenu.apres === null) throw new Defaut(`le retour du réseau n'est pas dit: ${JSON.stringify(revenu.vu)}`);
    const jetons = await page.evaluate(() => globalThis.nel3abTest.couverture().jetons);
    if (jetons.length) throw new Defaut(`la couverture reste après le retour des images: ${jetons}`);
    await page.close();
  },

  /** K20 : la neige remplace l'image d'une connexion coupée, au niveau
   * « conseillé ». Elle couvre le rectangle de l'image, change au moins
   * quinze fois par seconde, et sans flash : d'une image de neige à la
   * suivante, la luminance moyenne de chaque quart bouge de moins de 10 %.
   * Le jumeau : au niveau « sobre », pas de neige, l'image arrêtée est
   * assombrie à sa place. */
  async "neige-coupee"() {
    for (const niveau of ["conseille", "sobre"]) {
      const page = await nouvelle(PC, { "nel3ab:effets": JSON.stringify({ niveau, sons: false }) });
      const pose = await page.evaluate(() => document.documentElement.dataset.effets);
      if (pose !== niveau) throw new Precondition(`niveau d'effets « ${pose} » au lieu de « ${niveau} »`);
      await entrer(page);
      await sleep(2000);
      await couperLeReseau(page);
      const dit = await jusqua(page, (v) => v.liaison?.etat === "coupee", 5000);
      if (dit.apres === null) throw new Precondition(`${niveau}: pas d'état coupé en 5 s`);
      await sleep(300);
      const lu = await page.evaluate(() => {
        const n = document.querySelector(".n3-neige");
        const t = document.querySelector("#screen").getBoundingClientRect();
        const r = n?.getBoundingClientRect();
        return {
          visible: n !== null && getComputedStyle(n).display !== "none",
          ecart: r ? Math.max(Math.abs(r.left - t.left), Math.abs(r.top - t.top), Math.abs(r.width - t.width), Math.abs(r.height - t.height)) : null,
          toile: getComputedStyle(document.querySelector("#screen")).opacity,
        };
      });
      if (niveau === "sobre") {
        if (lu.visible) throw new Defaut("de la neige au niveau « sobre »");
        if (lu.toile !== "0.5") throw new Defaut(`au niveau « sobre », l'image arrêtée n'est pas assombrie: ${lu.toile}`);
        await page.close();
        continue;
      }
      if (!lu.visible) throw new Defaut("pas de neige sur une connexion coupée au niveau « conseillé »");
      if (lu.ecart > 2) throw new Defaut(`la neige n'est pas sur le rectangle de l'image (écart ${lu.ecart} px)`);
      const releve = await page.evaluate(
        () =>
          new Promise((fini) => {
            const n = document.querySelector(".n3-neige");
            const ctx = n.getContext("2d", { willReadFrequently: true });
            const quarts = () => {
              const { data, width, height } = ctx.getImageData(0, 0, n.width, n.height);
              const somme = [0, 0, 0, 0];
              for (let y = 0; y < height; y++)
                for (let x = 0; x < width; x++) {
                  const i = (y * width + x) * 4;
                  somme[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)] += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
                }
              return somme.map((s) => s / ((width * height) / 4));
            };
            let derniere = null;
            const images = [];
            let changements = 0;
            const debut = performance.now();
            const tour = () => {
              const q = quarts();
              const cle = q.map((v) => v.toFixed(3)).join();
              if (cle !== derniere) {
                if (derniere !== null) changements += 1;
                derniere = cle;
                if (images.length < 10) images.push(q);
              }
              if (performance.now() - debut < 2000) requestAnimationFrame(tour);
              else fini({ changements, duree: performance.now() - debut, images });
            };
            requestAnimationFrame(tour);
          }),
      );
      const parSeconde = (releve.changements * 1000) / releve.duree;
      if (parSeconde < 15) throw new Defaut(`la neige change ${parSeconde.toFixed(1)} fois par seconde`);
      if (releve.images.length < 10) throw new Precondition(`${releve.images.length} images de neige relevées`);
      for (let k = 1; k < releve.images.length; k++)
        for (let q = 0; q < 4; q++) {
          const a = releve.images[k - 1][q];
          const b = releve.images[k][q];
          if (a <= 0) throw new Precondition("un quart de neige tout noir");
          if (Math.abs(b - a) / a >= 0.1) throw new Defaut(`flash: le quart ${q} passe de ${a.toFixed(1)} à ${b.toFixed(1)}`);
        }
      await capture(page, "neige-coupee");
      await page.close();
    }
  },

  /** Une salle qui répond sans jamais envoyer d'image. À 15 s, le plein
   * cadre propose de réessayer et les autres salles, et le temps depuis
   * lequel la salle répond avance. Le jumeau : à 3 s, aucun geste, la salle
   * a encore le temps de répondre.
   *
   * L'horloge part de l'apparition du plein cadre, pas du clic. Depuis le
   * salon (vague B2, 24 novembre 2026), l'entrée joue sa transition
   * « entrer-salle » avant d'ouvrir la salle : l'arrivée commence 0,5 s
   * après le clic, et 15 s comptées du clic n'en laissaient que 14,5 à la
   * page (4 501 ms d'arrivée relevés 5 s après le clic). La limite de la
   * page (`ARRIVEE_LIMITE_MS`, 15 s) se compte du début de la session :
   * les gestes doivent paraître entre 12 et 18 s après le plein cadre. Les
   * 3 s de chaque côté couvrent un plein cadre posé un peu avant ou après
   * la session, et le pas du relevé. */
  async "arrivee-sans-image"() {
    const page = await nouvelle(PC);
    banc.regler({ video: "freeze" });
    await page.click("#enter");
    if ((await page.waitForSelector("#arrivee", { visible: true, timeout: 8000 }).catch(() => null)) === null)
      throw new Precondition("pas de plein cadre à l'arrivée");
    const debut = Date.now();
    const gestes = () =>
      page.evaluate(() => ({
        reessayer: document.querySelector("#arrivee #reessayer") !== null,
        salles: document.querySelector("#arrivee #lesSalles") !== null,
        texte: document.querySelector("#arrivee")?.textContent ?? "",
      }));
    await sleep(3000);
    const tot = await gestes();
    if (!tot.texte) throw new Precondition("le plein cadre est parti avant 3 s");
    if (tot.reessayer || tot.salles) throw new Defaut(`à 3 s, l'arrivée parle déjà de panne: ${tot.texte}`);
    const LIMITE_MS = 15_000;
    const MARGE_MS = 3_000;
    let tard = tot;
    while (!(tard.reessayer && tard.salles) && Date.now() - debut < LIMITE_MS + MARGE_MS) {
      await sleep(200);
      tard = await gestes();
    }
    const vers = Date.now() - debut;
    if (!tard.reessayer || !tard.salles)
      throw new Defaut(`${Math.round(vers / 100) / 10} s après le plein cadre, pas de « Réessayer » ou d'« Autres salles »: ${tard.texte}`);
    if (vers < LIMITE_MS - MARGE_MS)
      throw new Defaut(`les gestes d'une panne paraissent ${Math.round(vers / 100) / 10} s après le plein cadre, avant la limite de 15 s`);
    const depuis = (t) => Number(/répond depuis (\d+) s/.exec(t)?.[1] ?? NaN);
    const un = depuis(tard.texte);
    await sleep(2000);
    const deux = depuis((await gestes()).texte);
    if (!Number.isFinite(un) || !Number.isFinite(deux)) throw new Defaut(`le temps depuis lequel la salle répond n'est pas dit: ${tard.texte}`);
    if (deux <= un) throw new Defaut(`le compte n'avance pas: ${un} s puis ${deux} s`);
    await capture(page, "arrivee-sans-image");
    await page.close();
  },

  /** C2 (chantier menus, 24 novembre 2026): l'écran de chargement n'a plus
   * de bouton de menu ; « Menu du jeu » de la colonne ouvre le menu À CÔTÉ,
   * et le titre du chargement reste visible. Le jumeau : menu fermé, la même
   * sonde au centre de la place du menu tombe dans la colonne. */
  async "chargement-menu"() {
    const page = await nouvelle(PC);
    await entrer(page);
    banc.annoncerDemarrage();
    if ((await page.waitForSelector("#booting", { timeout: 3000 }).catch(() => null)) === null)
      throw new Precondition("pas d'écran de chargement après l'annonce");
    // Le bouton de l'écran venait au bout de 8 s : on attend au-delà.
    await sleep(9000);
    if ((await page.$("#booting")) === null) throw new Precondition("l'écran de chargement est parti avant 9 s");
    if ((await page.$("#bootingMenu")) !== null) throw new Defaut("l'écran de chargement porte encore un bouton de menu");
    if ((await page.$("#openMenu")) === null) throw new Precondition("pas de « Menu du jeu » dans la colonne");
    const titre = () =>
      page.evaluate(() => {
        const t = document.querySelector("#booting h1, #booting h2, #booting [data-titre]") ?? document.querySelector("#booting");
        const r = t.getBoundingClientRect();
        return [r.x + r.width / 2, r.y + r.height / 2];
      });
    await page.click("#openMenu");
    if ((await page.waitForFunction(() => document.querySelector("#menu") !== null, { timeout: 2000 }).catch(() => null)) === null)
      throw new Precondition("« Menu du jeu » n'a pas ouvert le menu pendant le chargement");
    await sleep(300);
    const [tx, ty] = await titre();
    const lu = await page.evaluate(
      (tx, ty) => {
        const m = document.querySelector("#menu").getBoundingClientRect();
        const centre = document.elementFromPoint(m.x + m.width / 2, m.y + Math.min(m.height / 2, 200));
        const surTitre = document.elementFromPoint(tx, ty);
        return {
          menu: Boolean(centre?.closest("#menu")),
          titre: Boolean(surTitre?.closest("#booting")),
          sous: surTitre?.closest("[id]")?.id ?? "rien",
          place: [m.x + m.width / 2, m.y + Math.min(m.height / 2, 200)],
        };
      },
      tx,
      ty,
    );
    await capture(page, "chargement-menu");
    if (!lu.menu) throw new Defaut("le centre du menu ouvert pendant le chargement n'est pas dans le menu");
    if (!lu.titre) throw new Defaut(`le titre du chargement est sous « ${lu.sous} »`);
    // Le jumeau : menu fermé, la même sonde tombe dans la colonne.
    await page.keyboard.press("Escape");
    if ((await page.waitForFunction(() => document.querySelector("#menu") === null, { timeout: 2000 }).catch(() => null)) === null)
      throw new Precondition("Échap ne ferme pas le menu");
    const ferme = await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest("#side")), lu.place);
    if (!ferme) throw new Defaut("menu fermé, sa place n'est pas la colonne");
    await page.close();
  },

  /** C4 et C9 (chantier menus, 24 novembre 2026) : la ligne parlée nomme le
   * jeu qui démarre et ne change pas pendant que le compteur avance ; les
   * trois cases ont la même largeur. Le jumeau : au passage à l'attente
   * longue, la ligne change une fois, et dit le seuil franchi. */
  async "chargement-annonces"() {
    const page = await nouvelle(PC);
    await entrer(page);
    banc.annoncerDemarrage();
    if ((await page.waitForSelector("#booting", { timeout: 3000 }).catch(() => null)) === null)
      throw new Precondition("pas d'écran de chargement après l'annonce");
    await sleep(1500);
    const lire = () =>
      page.evaluate(() => ({
        ligne: document.getElementById("ligneParlee")?.textContent ?? null,
        compteur: document.querySelector("#booting .n3-charge-compteur")?.textContent ?? null,
        cases: [...document.querySelectorAll("#booting .n3-charge-case")].map(
          (c) => c.getBoundingClientRect().width,
        ),
      }));
    const avant = await lire();
    if (avant.ligne === null) throw new Precondition("pas de ligne parlée");
    if (!avant.ligne.includes("Autre jeu du banc"))
      throw new Defaut(`la ligne parlée ne nomme pas le jeu : « ${avant.ligne} »`);
    if (avant.cases.length !== 3) throw new Defaut(`${avant.cases.length} cases au lieu de 3`);
    if (new Set(avant.cases).size !== 1 || avant.cases[0] < 20)
      throw new Defaut(`les cases n'ont pas la même largeur : ${avant.cases}`);
    const changements = [];
    let lu = avant;
    for (let i = 0; i < 35; i++) {
      await sleep(100);
      const l = await lire();
      if (l.ligne !== lu.ligne) changements.push(l.ligne);
      lu = l;
    }
    const secondes = (t) => Number((t ?? "").replace(/\D/g, ""));
    if (secondes(lu.compteur) - secondes(avant.compteur) < 3)
      throw new Precondition(`le compteur n'avance pas de 3 s : « ${avant.compteur} » puis « ${lu.compteur} »`);
    if (changements.length > 0) throw new Defaut(`la ligne parlée change avec le compteur : ${changements}`);
    // Le jumeau : au passage à long (20 s sans habitude), elle change une fois.
    const vus = new Set([lu.ligne]);
    const debut = Date.now();
    while (Date.now() - debut < 20_000) {
      await sleep(250);
      vus.add((await lire()).ligne);
    }
    const dites = [...vus];
    if (dites.length !== 2) throw new Defaut(`la ligne parlée a dit ${dites.length} phrases : ${dites}`);
    if (!dites[1].includes("depuis 20 s")) throw new Defaut(`l'attente longue se dit « ${dites[1]} »`);
    await capture(page, "chargement-annonces");
    await page.close();
  },

  /** C3 (chantier menus) : téléphone en travers, à 844x390 et 780x360,
   * l'écran de chargement garde ses gestes entiers dans la fenêtre, et ni le
   * texte, ni un bouton, ni le plateau d'Aïn ne se recouvrent, au démarrage
   * comme à l'attente longue. */
  async "chargement-paysage"() {
    for (const [width, height] of [
      [844, 390],
      [780, 360],
    ]) {
      const page = await nouvelle({ width, height, isMobile: true, hasTouch: true });
      await entrer(page);
      banc.annoncerDemarrage();
      if ((await page.waitForSelector("#booting", { timeout: 3000 }).catch(() => null)) === null)
        throw new Precondition("pas d'écran de chargement après l'annonce");
      const mesurer = () =>
        page.evaluate(() => {
          const boite = (el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, d: r.right };
          };
          const croise = (a, b) =>
            Math.max(0, Math.min(a.d, b.d) - Math.max(a.x, b.x)) *
            Math.max(0, Math.min(a.b, b.b) - Math.max(a.y, b.y));
          const booting = document.getElementById("booting");
          const plaque = booting.querySelector(".n3-charge-plaque");
          const plateau = booting.querySelector('[data-hote="plateau"]');
          const boutons = [...booting.querySelectorAll("button")].filter((b) => b.getClientRects().length > 0);
          const fautes = [];
          const zone = boite(booting);
          for (const b of boutons) {
            const r = boite(b);
            if (r.y < Math.max(0, zone.y) - 1 || r.b > Math.min(innerHeight, zone.b) + 1 || r.x < 0 || r.d > innerWidth + 1)
              fautes.push(`${b.textContent.trim()} coupé (${Math.round(r.y)}..${Math.round(r.b)} dans ${Math.round(zone.y)}..${Math.round(Math.min(innerHeight, zone.b))})`);
          }
          if (plaque && plateau && plateau.getClientRects().length > 0) {
            const aire = croise(boite(plaque), boite(plateau));
            if (aire > 0) fautes.push(`le plateau recouvre la plaque sur ${Math.round(aire)} px²`);
          }
          return { fautes, boutons: boutons.map((b) => b.textContent.trim()) };
        });
      const debut = await mesurer();
      if (debut.fautes.length > 0) throw new Defaut(`${width}x${height}, démarre : ${debut.fautes}`);
      await sleep(21_000);
      const long = await mesurer();
      await capture(page, `chargement-paysage-${width}x${height}`);
      if (long.boutons.length === 0) throw new Precondition(`${width}x${height} : aucun geste à 21 s`);
      if (long.fautes.length > 0) throw new Defaut(`${width}x${height}, plus long : ${long.fautes}`);
      await page.close();
    }
  },

  /** C8 (chantier menus) : tant qu'aucune image n'est arrivée, « Garder les
   * 45 dernières secondes » n'est ni dans la colonne ni dans le menu. Le
   * jumeau : en partie, la colonne le montre. */
  async "clip-chargement"() {
    const page = await nouvelle(PC);
    await entrer(page);
    if ((await page.$("#side #clip")) === null) throw new Precondition("en partie, la colonne n'a pas le clip");
    banc.annoncerDemarrage();
    if ((await page.waitForSelector("#booting", { timeout: 3000 }).catch(() => null)) === null)
      throw new Precondition("pas d'écran de chargement après l'annonce");
    await page.click("#openMenu").catch(() => {});
    await sleep(500);
    const clips = await page.evaluate(() => document.querySelectorAll("#side #clip, #menu #clip").length);
    await capture(page, "clip-chargement");
    if (clips !== 0) throw new Defaut(`${clips} clip pendant le chargement`);
    await page.close();
  },

  /** La mire du démarrage (effets mire-charge et balayage, chantier menus) :
   * au niveau « tout », une seule barre allumée à la fois, et elle change au
   * plus une fois par seconde (K14) ; le tube est sous la plaque du texte.
   * Le jumeau : au niveau conseillé, les sept barres sont là, fixes. */
  async "mire-charge"() {
    const mesurer = async (niveau) => {
      const page = await nouvelle(PC, { "nel3ab:effets": JSON.stringify({ niveau, sons: false }) });
      await entrer(page);
      banc.annoncerDemarrage();
      if ((await page.waitForSelector("#booting .rt-mire-charge", { timeout: 3000 }).catch(() => null)) === null)
        throw new Defaut(`niveau ${niveau} : pas de mire dans l'écran de chargement`);
      await sleep(300);
      const allumees = [];
      for (let i = 0; i < 45; i++) {
        allumees.push(
          await page.evaluate(() =>
            [...document.querySelectorAll("#booting .rt-mire-charge > i")]
              .map((b, rang) => (Number(getComputedStyle(b).opacity) > 0.9 ? rang : -1))
              .filter((r) => r >= 0)
              .join(","),
          ),
        );
        await sleep(100);
      }
      const plaque = await page.evaluate(() => {
        const style = document.createElement("style");
        style.textContent = '[class^="rt-calque"] { pointer-events: auto !important; }';
        document.head.append(style);
        const p = document.querySelector("#booting .n3-charge-plaque")?.getBoundingClientRect();
        const vu = p ? document.elementFromPoint(p.x + p.width / 2, p.y + p.height / 2) : null;
        style.remove();
        return {
          balayage: getComputedStyle(document.querySelector("#booting .rt-calque-balayage") ?? document.body).display,
          sur: vu?.closest(".n3-charge-plaque") ? "plaque" : (vu?.className ?? "rien"),
          animees: [...document.querySelectorAll("#booting .rt-mire-charge > i")].reduce(
            (n, b) => n + b.getAnimations().length,
            0,
          ),
        };
      });
      await capture(page, `mire-charge-${niveau}`);
      await page.close();
      return { allumees, plaque };
    };
    const tout = await mesurer("tout");
    if (tout.allumees.some((a) => a.split(",").length !== 1))
      throw new Defaut(`au niveau tout, plusieurs barres ou aucune allumées : ${tout.allumees}`);
    // Les durées de chaque barre allumée, échantillonnées toutes les 100 ms :
    // la première et la dernière sont coupées par la mesure.
    const durees = [];
    let n = 1;
    for (let i = 1; i < tout.allumees.length; i++) {
      if (tout.allumees[i] === tout.allumees[i - 1]) n += 1;
      else {
        durees.push(n);
        n = 1;
      }
    }
    const pleines = durees.slice(1);
    if (pleines.length < 2) throw new Precondition(`trop peu de pas mesurés : ${tout.allumees}`);
    if (pleines.some((d) => d < 8)) throw new Defaut(`une barre reste allumée moins d'une seconde : ${durees} (pas de 100 ms)`);
    if (tout.plaque.balayage === "none") throw new Defaut("au niveau tout, pas de balayage dans l'écran de chargement");
    if (tout.plaque.sur !== "plaque") throw new Defaut(`le tube passe sur la plaque du texte : ${tout.plaque.sur}`);
    const conseille = await mesurer("conseille");
    if (conseille.plaque.animees !== 0) throw new Defaut(`au niveau conseillé, ${conseille.plaque.animees} animations de barre`);
    if (conseille.allumees.some((a) => a.split(",").length !== 7))
      throw new Defaut(`au niveau conseillé, les sept barres ne sont pas pleines : ${conseille.allumees[0]}`);
    if (conseille.plaque.sur !== "plaque") throw new Defaut(`au niveau conseillé, le tube passe sur le texte : ${conseille.plaque.sur}`);
  },

  /** Le calendrier de l'audit E4: 36 s d'images, puis 30 s de gel avec le son.
   * Avant 50 s, `Struggling` ne peut rien proposer (trois fenêtres de grâce,
   * puis deux mauvaises): un gel plus tôt ferait passer toute page. */
  async "gel-sans-proposition"() {
    const page = await nouvelle(PC);
    const entree = await entrer(page);
    await sleep(Math.max(0, 36_000 - (Date.now() - entree)));
    const debut = Date.now();
    banc.regler({ video: "freeze" });
    await durant(
      page,
      30_000,
      (v) =>
        proposes(debut).length > 0
          ? "« proposé » au journal pour un gel de la salle"
          : v.rough
            ? "le format réduit est proposé pour un gel de la salle"
            : null,
      250,
    );
    banc.regler({ video: "live" });
    await page.close();
  },

  /** Le cas des 22 et 25 septembre 2026, sur un téléphone: une liaison qui
   * cale quatre secondes toutes les seize. La proposition doit sortir, et
   * « proposé » ne doit partir que si elle est à l'écran (audit E3). */
  async "lien-qui-cale"() {
    const page = await nouvelle(TELEPHONE);
    const entree = await entrer(page);
    await sleep(Math.max(0, 31_000 - (Date.now() - entree)));
    const debut = Date.now();
    for (let tour = 0; tour < 7; tour++) {
      // La pastille de l'offre paraît quand la liaison va bien, et la panne
      // suivante la remplace : elle se guette pendant la phase vivante.
      const vivante = Date.now();
      while (Date.now() - vivante < 12_000 && !(await page.$(OFFRE))) await sleep(250);
      if (await page.$(OFFRE)) break;
      // Tout se tait, la sonde du site aussi: c'est le Wi-Fi qui cale.
      banc.regler({ video: "silent", salles: "hang" });
      await sleep(4000);
      banc.regler({ video: "live", salles: "up" });
      if (proposes(debut).length > 0 || (await page.$(OFFRE))) break;
    }
    // Depuis le 24 novembre 2026 (ADR D40), la proposition paraît d'abord en
    // pastille, et sa fiche vit dans la feuille au téléphone : « proposé »
    // ne part qu'au montage de la fiche, quand la pastille l'ouvre (E3).
    const offre = await page.$(OFFRE);
    if (offre) {
      await offre.tap();
      await jusqua(page, (v) => v.rough, 3000);
      await sleep(300);
    }
    if (proposes(debut).length === 0)
      throw new Defaut(`aucune proposition en ${Math.round((Date.now() - debut) / 1000)} s de liaison qui cale`);
    const vu = await jusqua(page, (v) => v.rough, 1500);
    if (vu.apres === null) throw new Defaut("« proposé » au journal sans proposition à l'écran");
    await capture(page, "proposition");
    await page.close();
  },

  /** Le 26 novembre 2026, chez un joueur distant, la marge de la page est
   * restée au plancher quatre minutes et vingt et une secondes : chaque
   * rafale faisait rattraper une image en retard, et le rattrapage comptait
   * comme un débordement de file, qui interdit à la marge de grandir (VID-1).
   * Le banc retient les images de 100 à 150 ms une fois par seconde, instants
   * de capture gardés. La marge doit grandir au-dessus de son départ (6 ms)
   * sans passer son plafond (36 ms), le demi-format ne doit pas se déclencher,
   * et le relevé envoyé au salon doit dire l'arrêt vu au verre et les deux
   * sortes de jets (VID-4). Le jumeau : l'écran n'est pas bloqué, et le
   * relevé le dit (`écranMax`), pendant que les écarts d'arrivée montent. */
  async "rafales-marge"() {
    const DEPART = 6;
    const PLAFOND = 36;
    const page = await nouvelle(PC);
    await entrer(page);
    if ((await page.evaluate(() => globalThis.nel3abTest.pacing().marge)) === "ancienne")
      throw new Precondition("la page sert l'ancienne marge sans qu'on la demande");
    await sleep(3000);
    const lirePacing = () => page.evaluate(() => globalThis.nel3abTest.pacing());
    const avant = await lirePacing();
    banc.regler({ video: "rafales" });
    const debut = Date.now();
    let margeMax = 0;
    let vu = avant;
    while (Date.now() - debut < 24_000) {
      vu = await lirePacing();
      margeMax = Math.max(margeMax, vu.slackMs);
      await sleep(250);
    }
    const releves = banc.releves(debut + 10_000);
    banc.regler({ video: "live" });
    const famines = vu.starved - avant.starved;
    const resume = JSON.stringify({ margeMax, famines, jetees: vu.skipped - avant.skipped, rattrapees: vu.caughtUp, debordees: vu.overflowed, gigue: Math.round(vu.jitter), largeur: [avant.pictureW, vu.pictureW] });
    if (vu.painted - avant.painted < 600) throw new Precondition(`la page a peint ${vu.painted - avant.painted} images en 24 s: ${resume}`);
    if (famines < 5) throw new Precondition(`les rafales n'affament pas la page (${famines} famines): ${resume}`);
    if (margeMax <= DEPART)
      throw new Defaut(`la marge reste à ${margeMax} ms pendant ${famines} famines : un rattrapage la bloque (VID-1): ${resume}`);
    if (margeMax > PLAFOND) throw new Defaut(`la marge monte à ${margeMax} ms, au-dessus de son plafond de ${PLAFOND}: ${resume}`);
    if (vu.pictureW !== avant.pictureW) throw new Defaut(`le demi-format s'est déclenché sur des rafales: ${resume}`);
    const releve = releves.at(-1)?.releve;
    if (!releve) throw new Precondition(`aucun relevé au salon en 24 s de rafales: ${resume}`);
    const lu = JSON.stringify(releve).slice(0, 400);
    if (typeof releve.arrêt !== "number") throw new Defaut(`le relevé ne dit pas l'arrêt vu au verre (VID-4): ${lu}`);
    if (typeof releve.rattrapées !== "number" || typeof releve.débordées !== "number")
      throw new Defaut(`le relevé ne sépare pas les deux sortes de jets: ${lu}`);
    if (releve.arrêt < 90) throw new Defaut(`le relevé dit un arrêt de ${releve.arrêt} ms pour des retenues de 100 à 150 ms: ${lu}`);
    if (!(releve.écarts?.plus100 >= 5)) throw new Defaut(`le relevé ne voit pas les écarts d'arrivée au-dessus de 100 ms: ${lu}`);
    if (!(releve.écranMax < 60)) throw new Defaut(`le relevé prête les rafales à l'écran (écranMax ${releve.écranMax} ms): ${lu}`);
    console.log(
      JSON.stringify({
        mesure: "rafales-marge",
        ...JSON.parse(resume),
        releve: { arrêt: releve.arrêt, rattrapées: releve.rattrapées, débordées: releve.débordées, écarts: releve.écarts, écranMax: releve.écranMax, horaire: releve.horaire, marge: releve.marge },
      }),
    );
    await page.close();
  },

  /** Le jumeau de `rafales-marge` : l'ancienne règle reste derrière
   * `?marge=ancienne`, sur la même page, pour une comparaison à l'aveugle
   * chez le propriétaire. Sous elle, les mêmes rafales gardent la marge au
   * départ, et le relevé dit quelle règle tournait. Sans ce bras témoin, une
   * soirée de comparaison ne comparerait rien. */
  async "rafales-ancienne"() {
    const page = await nouvelle(PC);
    await page.goto(`${banc.url}?marge=ancienne`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#enter", { timeout: 15000 });
    await entrer(page);
    const lirePacing = () => page.evaluate(() => globalThis.nel3abTest.pacing());
    const avant = await lirePacing();
    if (avant.marge !== "ancienne") throw new Defaut(`?marge=ancienne ne rend pas l'ancienne règle: ${avant.marge}`);
    await sleep(3000);
    banc.regler({ video: "rafales" });
    const debut = Date.now();
    let margeMax = 0;
    let vu = avant;
    while (Date.now() - debut < 24_000) {
      vu = await lirePacing();
      margeMax = Math.max(margeMax, vu.slackMs);
      await sleep(250);
    }
    const releve = banc.releves(debut + 10_000).at(-1)?.releve;
    banc.regler({ video: "live" });
    const famines = vu.starved - avant.starved;
    if (famines < 5) throw new Precondition(`les rafales n'affament pas la page (${famines} famines)`);
    if (margeMax > 6) throw new Defaut(`l'ancienne règle fait grandir la marge à ${margeMax} ms`);
    if (!releve) throw new Precondition("aucun relevé au salon en 24 s de rafales");
    if (releve.marge !== "ancienne") throw new Defaut(`le relevé ne dit pas la règle en service: ${releve.marge}`);
    console.log(JSON.stringify({ mesure: "rafales-ancienne", margeMax, famines, arrêt: releve.arrêt, rattrapées: releve.rattrapées }));
    await page.close();
  },

  /** Le plein cadre de l'arrivée tient sur un téléphone court : le titre,
   * les étapes, le fait et les gestes dans l'écran noir et dans la fenêtre,
   * rien de coupé, chaque geste haut de 44 px. Mesuré pendant l'arrivée (3 s
   * après le plein cadre) et quand elle est perdue (dès que ses gestes
   * paraissent, vers 15 s), à 375x667, 320x568 et en travers à 844x390. Le
   * jumeau : un titre trop long pour l'écran est vu. */
  async "arrivee-courte"() {
    const MESURE = () => {
      const ecran = document.querySelector("#arrivee .n3-plein-ecran");
      if (!ecran || getComputedStyle(document.querySelector("#arrivee")).display === "none") return { erreur: "pas de plein cadre" };
      const e = ecran.getBoundingClientRect();
      const fautes = [];
      if (ecran.scrollHeight > ecran.clientHeight + 1) fautes.push(`l'écran déborde de ${ecran.scrollHeight - ecran.clientHeight} px`);
      // Chaque pièce du texte, sur sa plaque depuis le 24 novembre 2026.
      for (const el of ecran.querySelectorAll(":scope > :not(i), .n3-plein-plaque > *, .n3-geste")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const nom = el.id || el.className.split(" ")[0] || el.tagName;
        if (r.top < e.top - 1 || r.bottom > e.bottom + 1 || r.left < e.left - 1 || r.right > e.right + 1)
          fautes.push(`${nom} hors de l'écran noir`);
        if (r.top < 0 || r.bottom > innerHeight + 1 || r.left < 0 || r.right > innerWidth + 1) fautes.push(`${nom} hors de la fenêtre`);
        if (el.classList.contains("n3-geste") && r.height < 44) fautes.push(`${nom} haut de ${Math.round(r.height)} px`);
      }
      return { fautes, gestes: ecran.querySelectorAll(".n3-geste").length, etapes: ecran.querySelectorAll("li").length };
    };
    const fautes = [];
    for (const vue of [
      { width: 375, height: 667, isMobile: true, hasTouch: true },
      { width: 320, height: 568, isMobile: true, hasTouch: true },
      { width: 844, height: 390, isMobile: true, hasTouch: true },
    ]) {
      const nom = `${vue.width}x${vue.height}`;
      const page = await nouvelle(vue);
      banc.regler({ video: "freeze" });
      await page.click("#enter");
      // L'horloge part du plein cadre, pas du clic, comme dans
      // arrivee-sans-image : depuis le salon, l'entrée joue sa transition
      // avant d'ouvrir la salle. L'étape mesurait l'arrivée perdue 15,5 s
      // après le clic, l'instant même où la page la perd (0,5 s de transition
      // et ARRIVEE_LIMITE_MS) : une transition plus lente et elle tombait sur
      // « 0 gestes à 15 s » (intégration finale, 25 novembre 2026). Les gestes
      // d'une arrivée perdue sont attendus, au plus 18 s après le plein cadre ;
      // leur heure est l'affaire d'arrivee-sans-image, la mise en page celle
      // de cette étape.
      if ((await page.waitForSelector("#arrivee", { visible: true, timeout: 8000 }).catch(() => null)) === null)
        throw new Precondition(`${nom}: pas de plein cadre à l'arrivée`);
      const debut = Date.now();
      await sleep(3000);
      const tot = await page.evaluate(MESURE);
      if (tot.erreur) throw new Precondition(`${nom}: ${tot.erreur} à 3 s`);
      if (tot.etapes !== 2) throw new Precondition(`${nom}: ${tot.etapes} étapes à 3 s`);
      fautes.push(...tot.fautes.map((f) => `${nom} à 3 s: ${f}`));
      await capture(page, "arrivee-courte-3s");
      let tard = await page.evaluate(MESURE);
      while (!tard.erreur && tard.gestes < 2 && Date.now() - debut < 18_000) {
        await sleep(200);
        tard = await page.evaluate(MESURE);
      }
      if (tard.erreur) throw new Precondition(`${nom}: ${tard.erreur} à 15 s`);
      if (tard.gestes < 2)
        throw new Precondition(`${nom}: ${tard.gestes} gestes ${Math.round((Date.now() - debut) / 100) / 10} s après le plein cadre`);
      fautes.push(...tard.fautes.map((f) => `${nom} à 15 s: ${f}`));
      await capture(page, "arrivee-courte-15s");
      if (vue.width === 320) {
        await page.evaluate(() => {
          document.querySelector("#arrivee h2").textContent = "Un titre beaucoup trop long ".repeat(12);
        });
        const jumeau = await page.evaluate(MESURE);
        if (!jumeau.fautes?.length) throw new Precondition(`${nom}: un titre trop long pour l'écran n'est pas vu`);
      }
      await page.close();
    }
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
  },

  /** La colonne ne bouge pas quand l'image arrive : les boîtes des enfants
   * de #side relevées avant la première image et une seconde après sont les
   * mêmes, au pixel. Le jumeau : un enfant déplacé d'un pixel est vu. */
  /** L'effet « coupure » (niveau « tout ») : un quart de seconde de neige à
   * l'entrée dans le plein cadre « Connexion », comme en changeant de chaîne
   * pour la salle. Le jeton vit 300 ms au plus, sa neige se voit, et aucune
   * image n'est peinte dessous : la première image le lève comme le reste.
   * Les jumeaux : au niveau « conseillé » et en mouvement réduit, jamais ;
   * et l'entrée dans une connexion coupée au niveau « tout » ne le pose pas,
   * parce qu'une vraie coupure peut arriver là. */
  async "coupure-entree"() {
    const observer = (page) =>
      page.evaluate(() => {
        window.__couv = [];
        const lire = () => {
          const c = document.querySelector(".n3-coupure");
          window.__couv.push({
            t: performance.now(),
            jetons: (document.documentElement.getAttribute("data-couverture") ?? "").split(" ").filter(Boolean),
            vues: globalThis.nel3abTest?.couverture?.().vues ?? null,
            vue: c !== null && getComputedStyle(c).display !== "none" && c.getBoundingClientRect().width > 0,
          });
        };
        lire();
        new MutationObserver(lire).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-couverture"],
        });
      });
    /** Les passages du jeton « coupure » : début, fin, images vues, neige vue. */
    const passages = async (page) => {
      const releve = await page.evaluate(() => window.__couv);
      const vus = [];
      let ouvert = null;
      for (const r of releve) {
        const pose = r.jetons.includes("coupure");
        if (pose && ouvert === null) ouvert = { debut: r.t, vues: r.vues, vue: r.vue, fin: null, vuesFin: null };
        if (!pose && ouvert !== null) {
          vus.push({ ...ouvert, fin: r.t, vuesFin: r.vues });
          ouvert = null;
        }
      }
      if (ouvert !== null) vus.push(ouvert);
      return vus;
    };
    const tout = JSON.stringify({ niveau: "tout", sons: false });
    for (const video of ["freeze", "live"]) {
      const page = await nouvelle(PC, { "nel3ab:effets": tout });
      if ((await page.evaluate(() => document.documentElement.dataset.effets)) !== "tout")
        throw new Precondition("le niveau « tout » n'est pas posé");
      banc.regler({ video });
      await observer(page);
      await page.click("#enter");
      await sleep(1500);
      const vus = await passages(page);
      if (vus.length !== 1) throw new Defaut(`${video}: ${vus.length} coupures à l'entrée au niveau « tout », une attendue`);
      const [c] = vus;
      if (c.fin === null) throw new Defaut(`${video}: la coupure ne finit pas en 1,5 s`);
      if (c.fin - c.debut > 300) throw new Defaut(`${video}: la coupure dure ${Math.round(c.fin - c.debut)} ms, 300 au plus`);
      if (!c.vue) throw new Defaut(`${video}: le jeton « coupure » est posé sans neige visible`);
      if (c.vues === null || c.vuesFin - c.vues > 1)
        throw new Defaut(`${video}: ${c.vuesFin - c.vues} images peintes sous la coupure`);
      await page.close();
    }
    // Jumeaux : niveau conseillé, mouvement réduit.
    for (const cas of ["conseille", "reduit"]) {
      const page = await nouvelle(PC, {
        "nel3ab:effets": cas === "reduit" ? tout : JSON.stringify({ niveau: "conseille", sons: false }),
      });
      if (cas === "reduit") await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
      banc.regler({ video: "freeze" });
      await observer(page);
      await page.click("#enter");
      if ((await page.waitForSelector("#arrivee", { visible: true, timeout: 8000 }).catch(() => null)) === null)
        throw new Precondition(`${cas}: pas de plein cadre à l'entrée`);
      await sleep(800);
      const vus = await passages(page);
      if (vus.length) throw new Defaut(`${cas}: une coupure à l'entrée (${vus.length})`);
      await page.close();
    }
    // Jumeau : une vraie coupure au niveau « tout » ne pose pas l'effet.
    const page = await nouvelle(PC, { "nel3ab:effets": tout });
    await entrer(page);
    await sleep(1000);
    await observer(page);
    await couperLeReseau(page);
    const dit = await jusqua(page, (v) => v.liaison?.etat === "coupee", 5000);
    if (dit.apres === null) throw new Precondition("pas d'état coupé en 5 s");
    await sleep(500);
    const vus = await passages(page);
    if (vus.length) throw new Defaut("une coupure de chaîne sur une vraie connexion coupée");
    await page.close();
  },

  /** La première image ne déplace ni la colonne ni le panneau de commande.
   * Le banc annonce une Xbox 360 (16:9 attendu) et envoie un flux 640×480 :
   * à 1440×900, le panneau décidé sur l'image reçue passait de sous l'écran
   * à la colonne et poussait ses enfants de 204 px. Il se décide maintenant
   * sur le format attendu de la console (`baseDuPanneau` de lib/cadre,
   * décision du chef de chantier du 24 novembre 2026), et une image qui
   * diffère n'y change rien avant le prochain changement de mise en page.
   * Le jumeau : un enfant déplacé d'un pixel est vu. */
  async "colonne-stable"() {
    // Aussi en « entier » : l'image 640x480 y laisse un fronton de 166 px,
    // et le nom du jeu quittait alors la tête de la colonne à la première
    // image, ce qui la raccourcissait de 30 px (vu le 25 novembre 2026,
    // quand un réglage laissé par une autre étape l'a posé).
    for (const fit of ["remplir", "entier"]) {
      try {
        await colonneStableEn(fit);
      } catch (erreur) {
        erreur.message = `${fit} : ${erreur.message}`;
        throw erreur;
      }
    }
  },



  /** Au bureau, la pastille d'une image figée se pose sur le panneau de
   * commande sous l'image, avant « Toutes les touches », quand aucune bande
   * noire de 40 px ne la prend (décision du chef de chantier, 24 novembre
   * 2026 ; `lib/etat-place`, « panneau »). À 1440×900, le banc (une Xbox 360
   * attendue, une image 4:3) garde le panneau sous l'écran, et l'image le
   * touche. Vérifié sur ce qui se voit : la pastille dans #panneau, avant
   * « Toutes les touches » dans la page et à l'écran, hors de l'image, et
   * qui reçoit le point en son centre. Le jumeau : à 1920×1080, une bande
   * de 147 px à droite de l'image la prend, et le panneau ne la porte pas. */
  async "pastille-panneau"() {
    const lire = (page) =>
      page.evaluate(() => {
        const p = document.querySelector("#pastilleEtat");
        if (!p) return null;
        const r = p.getBoundingClientRect();
        const t = document.querySelector("#toutesLesTouches")?.getBoundingClientRect() ?? null;
        const s = document.querySelector("#screen").getBoundingClientRect();
        const centre = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const touches = document.querySelector("#toutesLesTouches");
        return {
          panneau: p.closest('#panneau[data-forme="sous"]') !== null,
          avant: touches ? Boolean(p.compareDocumentPosition(touches) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
          aGauche: t ? r.right <= t.left : null,
          surImage:
            Math.max(0, Math.min(r.right, s.right) - Math.max(r.left, s.left)) *
            Math.max(0, Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top)),
          recoit: centre !== null && p.contains(centre),
          boite: [r.left, r.top, r.width, r.height].map(Math.round),
        };
      });
    const figer = async (vue) => {
      const page = await nouvelle(vue);
      await entrer(page);
      await sleep(1500);
      banc.regler({ video: "freeze" });
      if ((await page.waitForSelector("#pastilleEtat", { timeout: 8000 }).catch(() => null)) === null)
        throw new Precondition(`${vue.width}×${vue.height}: pas de pastille en 8 s de gel`);
      await sleep(500);
      return page;
    };
    const page = await figer(PC);
    const vu = await lire(page);
    await capture(page, "pastille-panneau");
    await page.close();
    console.log(JSON.stringify({ "1440x900": vu }));
    if (!vu.panneau) throw new Defaut(`à 1440×900, la pastille n'est pas sur le panneau sous l'image (${vu.boite})`);
    if (vu.avant !== true || vu.aGauche !== true)
      throw new Defaut(`la pastille n'est pas avant « Toutes les touches » (dans la page : ${vu.avant}, à l'écran : ${vu.aGauche})`);
    if (vu.surImage > 0) throw new Defaut(`${Math.round(vu.surImage)} px² de pastille sur l'image`);
    if (!vu.recoit) throw new Defaut("la pastille du panneau ne reçoit pas le point en son centre");
    // Un voyant, pas une rangée : la règle des rangées du panneau l'étirait
    // à 75 px de haut (page construite avant cadre.css, 24 novembre 2026).
    if (vu.boite[3] > 48) throw new Defaut(`la pastille est étirée à ${vu.boite[3]} px de haut sur le panneau`);
    const large = await figer({ width: 1920, height: 1080 });
    const jumeau = await lire(large);
    await large.close();
    console.log(JSON.stringify({ "1920x1080": jumeau }));
    if (jumeau.panneau) throw new Precondition("jumeau : à 1920×1080, la bande de droite ne prend pas la pastille");
  },

  /** L'ouverture dessine la salle avant qu'elle arrive (plan salon,
   * ouverture#1, 24 novembre 2026) : pendant que l'identité tarde, la page
   * montre la colonne, l'écran noir et le panneau, aux rectangles que la
   * salle prendra. Quand la salle se monte, sa colonne (`#side`) et son titre
   * sont là où le squelette les avait posés, à moins de 2 px. Une ancienne
   * ouverture, une carte au milieu de la page, fait apparaître la colonne
   * d'un coup : c'est le défaut. Le jumeau, dans la même étape : le même
   * squelette décalé de 20 px doit être vu. */
  async "ouverture-sans-saut"() {
    const sans = await mesurerSaut(null);
    console.log(JSON.stringify({ colonne: sans.colonne, titre: sans.titre, maison: sans.maison, avant: sans.avant, apres: sans.apres }));
    if (sans.saut) throw new Defaut(sans.saut);
    const decale = await mesurerSaut("#ouvertureColonne { transform: translate(20px, 20px); }");
    console.log(JSON.stringify({ jumeau: decale.saut }));
    if (!decale.saut)
      throw new Precondition(`la mesure ne voit pas un squelette décalé de 20 px: ${JSON.stringify(decale)}`);
  },

  /** L'ouverture d'une tablette couchée, au doigt (relecture finale du
   * 25 novembre 2026). L'écran d'une fenêtre 4:3 la remplit presque, et la
   * colonne recevait la bande qui restait : 0 px sous l'écran à 1024x768,
   * 43,5 px à 1180x820, 0,5 px à 1366x1024. Le titre parlé et « Réessayer »
   * sortaient de l'écran, et à 1366x1024 la colonne débordait de 32 px :
   * Chrome élargissait `innerWidth`, et la salle gardait après l'entrée une
   * pose trop large, où les touches R et X sortaient de 23 px.
   *
   * Passé la limite de 8 s, le titre, le compte et les deux gestes sont
   * entiers dans la vue, à 44 px au moins, et le centre de chacun le
   * reçoit ; la page ne défile pas en largeur. Puis, l'identité lâchée, la
   * salle tient dans la vue : aucune touche de la manette à l'écran n'en
   * sort. Le jumeau : 1440x900 à la souris garde sa colonne à droite. */
  async "ouverture-tablette"() {
    const fautes = [];
    const lues = [];
    for (const [width, height] of [
      [1024, 768],
      [1180, 820],
      [1366, 1024],
    ]) {
      const nom = `${width}x${height}`;
      const { page, lacher } = await ouvrirTenue({ vue: { width, height, isMobile: true, hasTouch: true } });
      if (!(await page.waitForSelector("#ouverture", { timeout: 15000 }).catch(() => null)))
        throw new Precondition(`${nom}: l'ouverture ne s'est pas montrée pendant que /api/me était tenu`);
      const gestes = await page
        .waitForFunction(() => document.querySelectorAll(".n3-ouverture-bouton").length === 2, { timeout: 12000 })
        .then(() => true)
        .catch(() => false);
      if (!gestes) throw new Precondition(`${nom}: les deux gestes ne sont pas venus après la limite`);
      const lu = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const voir = (el, nom) => {
          const r = el.getBoundingClientRect();
          const dedans = r.left >= 0 && r.top >= 0 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5;
          const centre = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return {
            nom,
            boite: [r.left, r.top, r.width, r.height].map(Math.round),
            dedans,
            recu: centre !== null && (centre === el || el.contains(centre)),
          };
        };
        const boutons = [...document.querySelectorAll(".n3-ouverture-bouton")];
        return {
          coarse: matchMedia("(pointer: coarse)").matches,
          vue: [vw, vh],
          innerWidth,
          defile: document.documentElement.scrollWidth - vw,
          titre: voir(document.getElementById("ouvertureTitre"), "titre"),
          compte: voir(document.getElementById("ouvertureCompte"), "compte"),
          boutons: boutons.map((b) => ({ ...voir(b, b.textContent.trim()), h: Math.round(b.getBoundingClientRect().height) })),
        };
      });
      if (!lu.coarse) throw new Precondition(`${nom}: pas de pointeur grossier, la tablette n'est pas émulée`);
      for (const un of [lu.titre, lu.compte, ...lu.boutons]) {
        if (!un.dedans) fautes.push(`${nom}: ${un.nom} ${un.boite} hors de la vue`);
        else if (!un.recu) fautes.push(`${nom}: ${un.nom} ${un.boite} ne reçoit pas son centre`);
      }
      for (const b of lu.boutons) if (b.h < 44) fautes.push(`${nom}: « ${b.nom} » de ${b.h} px`);
      if (lu.titre.boite[2] < 100) fautes.push(`${nom}: le titre ne tient que ${lu.titre.boite[2]} px de large`);
      if (lu.defile > 0) fautes.push(`${nom}: la page défile de ${lu.defile} px en largeur pendant l'ouverture`);
      await capture(page, `ouverture-tablette-${nom}`);
      lacher();
      if (!(await page.waitForSelector("#zone-jeu", { timeout: 15000 }).catch(() => null)))
        throw new Precondition(`${nom}: la salle ne s'est pas montée après l'identité`);
      const peint = await page
        .waitForFunction(() => (globalThis.nel3abTest?.counters?.().painted ?? 0) > 30, { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      if (!peint) throw new Precondition(`${nom}: la salle n'a pas peint 30 images après l'entrée`);
      await sleep(500);
      const salle = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        // Toutes les touches de la manette à l'écran : `touch-R` pour la
        // GameCube, `data-touche` sans identifiant pour la manette Pro.
        const touches = [...document.querySelectorAll(".n3-manette-boite button")];
        const sortent = touches
          .map((b) => [b.id || b.dataset.touche || b.textContent.trim(), b.getBoundingClientRect()])
          .filter(([, r]) => r.width > 0 && (r.right > vw + 0.5 || r.bottom > vh + 0.5 || r.left < -0.5))
          .map(([id, r]) => `${id} ${Math.round(r.left)}..${Math.round(r.right)}`);
        return {
          vue: [vw, vh],
          innerWidth,
          defile: [document.documentElement.scrollWidth - vw, document.documentElement.scrollHeight - vh],
          touches: touches.length,
          sortent,
        };
      });
      if (salle.defile[0] > 0 || salle.defile[1] > 0)
        fautes.push(`${nom}: la salle défile de ${salle.defile.join(" et ")} px après l'entrée (innerWidth ${salle.innerWidth})`);
      // La manette à l'écran est là : sans elle, « aucune touche ne sort »
      // ne dirait rien.
      if (salle.touches === 0) throw new Precondition(`${nom}: aucune touche de manette à l'écran après l'entrée`);
      if (salle.sortent.length) fautes.push(`${nom}: touches hors de la vue après l'entrée : ${salle.sortent.join(", ")}`);
      lues.push({ nom, ouverture: lu, salle });
      await page.close();
    }
    // Le jumeau : à la souris, la colonne a sa bande à droite, entière.
    {
      const { page } = await ouvrirTenue({ vue: PC });
      if (!(await page.waitForSelector("#ouvertureColonne", { timeout: 15000 }).catch(() => null)))
        throw new Precondition("1440x900: l'ouverture n'a pas de colonne");
      const c = await page.$eval("#ouvertureColonne", (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, w: r.width, droite: r.right, vue: document.documentElement.clientWidth };
      });
      await page.close();
      if (Math.abs(c.droite - c.vue) > 1 || c.w < 300)
        throw new Precondition(`1440x900: la colonne n'est pas à droite, entière (${JSON.stringify(c)})`);
    }
    console.log(JSON.stringify(lues.map((l) => ({ nom: l.nom, titre: l.ouverture.titre.boite, boutons: l.ouverture.boutons.map((b) => b.boite), salle: l.salle }))));
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
  },

  /** L'ouverture suit le thème (plan salon, ouverture#4) : sous un système
   * clair, son fond est clair ; sous un système sombre, sombre. L'écran reste
   * noir dans les deux. L'ancienne ouverture forçait la régie de nuit. */
  async "ouverture-theme"() {
    const lus = {};
    for (const schema of ["light", "dark"]) {
      const { page } = await ouvrirTenue({ schema });
      if (!(await page.waitForSelector("#ouverture", { timeout: 15000 }).catch(() => null)))
        throw new Precondition(`${schema}: l'ouverture ne s'est pas montrée`);
      lus[schema] = await page.evaluate(() => {
        const clarte = (couleur) => {
          const [r, g, b] = (couleur.match(/[\d.]+/g) ?? []).map(Number);
          return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        };
        const fond = getComputedStyle(document.getElementById("ouverture")).backgroundColor;
        const ecran = document.querySelector("#ouverture .n3-ouverture-ecran");
        return {
          fond,
          clarte: clarte(fond),
          ecran: ecran ? getComputedStyle(ecran).backgroundColor : null,
        };
      });
      await capture(page, `ouverture-${schema}`);
      await page.close();
    }
    console.log(JSON.stringify(lus));
    if (!(lus.light.clarte > 0.6)) throw new Defaut(`fond sombre sous un système clair: ${lus.light.fond}`);
    if (!(lus.dark.clarte < 0.25)) throw new Defaut(`fond clair sous un système sombre: ${lus.dark.fond}`);
    for (const schema of ["light", "dark"])
      if (lus[schema].ecran !== "rgb(0, 0, 0)")
        throw new Defaut(`${schema}: l'écran de l'ouverture n'est pas noir (${lus[schema].ecran})`);
  },

  /** Le squelette d'avant le script (`front/index.html`) pose la colonne où
   * l'ouverture de React la posera : même boîte à 2 px près, à la largeur
   * gardée (400 px), et « Salle 1 » écrit par son petit script. Le jumeau :
   * sans largeur gardée, 304 px des deux côtés. */
  async "ouverture-statique"() {
    for (const stockage of [{ "nel3ab:colonne": "400" }, {}]) {
      const attendue = stockage["nel3ab:colonne"] ? 400 : 304;
      const statique = await ouvrirTenue({ sansModule: true, stockage });
      const vu = await statique.page.evaluate(() => {
        const c = document.querySelector("#root .n3-ouverture-statique > aside");
        const r = c?.getBoundingClientRect();
        return {
          colonne: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
          titre: c?.querySelector("h1")?.textContent ?? null,
          dit: document.querySelector("#root [role=status]")?.textContent ?? null,
        };
      });
      await capture(statique.page, `ouverture-statique-${attendue}`);
      await statique.page.close();
      if (!vu.colonne) throw new Defaut(`le squelette d'avant le script n'a pas de colonne: ${JSON.stringify(vu)}`);
      const reacte = await ouvrirTenue({ stockage });
      if (!(await reacte.page.waitForSelector("#ouvertureColonne", { timeout: 15000 }).catch(() => null)))
        throw new Precondition("l'ouverture de React n'a pas de colonne");
      const r = await reacte.page.$eval("#ouvertureColonne", (c) => {
        const b = c.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      });
      await reacte.page.close();
      console.log(JSON.stringify({ attendue, statique: vu, react: r }));
      if (Math.abs(r.w - attendue) >= 1) throw new Precondition(`la colonne de React fait ${r.w} px, ${attendue} attendus`);
      const ecart = Math.max(...["x", "y", "w", "h"].map((k) => Math.abs(vu.colonne[k] - r[k])));
      if (ecart >= 2) throw new Defaut(`la colonne saute de ${ecart.toFixed(1)} px entre le squelette statique et React`);
      if (vu.titre !== "Salle 1" || vu.dit !== "On ouvre la salle 1…")
        throw new Defaut(`le squelette statique dit « ${vu.titre} » et « ${vu.dit} »`);
    }
  },
};

/** Une passe de `colonne-stable`, sous un réglage de la pose. */
async function colonneStableEn(fit) {
  const page = await nouvelle(PC, { "nel3ab:fit": fit });
  banc.regler({ video: "freeze" });
  await page.click("#enter");
  if ((await page.waitForSelector("#arrivee", { visible: true, timeout: 8000 }).catch(() => null)) === null)
    throw new Precondition("pas de plein cadre avant l'image");
  await sleep(1500);
  const boites = () =>
    page.evaluate(() =>
      [...(document.querySelector("#side")?.children ?? []), document.querySelector("#panneau")].map((el) => {
        if (!el) return "pas de #panneau";
        const r = el.getBoundingClientRect();
        return `${el.id || el.className}:${[r.left, r.top, r.width, r.height].map(Math.round)}`;
      }),
    );
  const avant = await boites();
  if (avant.length < 2) throw new Precondition(`la colonne n'a que ${avant.length} enfants`);
  banc.regler({ video: "live" });
  const vu = await jusqua(page, (v) => v.peintes > 0, 8000);
  if (vu.apres === null) throw new Precondition("aucune image peinte en 8 s");
  await sleep(1000);
  const apres = await boites();
  const bouges = avant.filter((b, i) => b !== apres[i]);
  if (bouges.length || avant.length !== apres.length)
    throw new Defaut(`la colonne bouge à l'arrivée de l'image: ${bouges.map((b, i) => `${b} → ${apres[avant.indexOf(b)]}`).slice(0, 3).join(" ; ") || `${avant.length} puis ${apres.length} enfants`}`);
  // Et 3 s plus tard : la place que la salle donne arrive parfois après la
  // première image, et le rôle qui change ne déplace rien non plus.
  await sleep(3000);
  const ensuite = await boites();
  const tard = apres.filter((b, i) => b !== ensuite[i]);
  if (tard.length || apres.length !== ensuite.length)
    throw new Defaut(`la colonne bouge après l'image: ${tard.map((b) => `${b} → ${ensuite[apres.indexOf(b)]}`).slice(0, 3).join(" ; ") || `${apres.length} puis ${ensuite.length} enfants`}`);
  // Le jumeau décale le premier enfant qui a une boîte : le dernier est le
  // curseur ▶ du socle (`rt-curseur`, posé là par la salle le 23 novembre
  // 2026) et le premier la pile des avis vide (`empty:hidden`), sans
  // boîte l'un et l'autre, qu'une marge ne déplace pas.
  await page.evaluate(() => {
    const vu = [...document.querySelector("#side").children].find((el) => el.getBoundingClientRect().height > 0);
    if (vu) vu.style.marginTop = "1px";
  });
  const jumeau = await boites();
  if (jumeau.every((b, i) => b === apres[i])) throw new Precondition("un enfant déplacé d'un pixel n'est pas vu");
  await page.evaluate(() => localStorage.removeItem("nel3ab:fit"));
  await page.close();
}

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
      // L'écran au moment de l'échec: c'est la capture « avant » d'un défaut.
      for (const p of await browser.pages()) if (p.url() !== "about:blank") await capture(p, `${nom}-echec`).catch(() => {});
      const genre = erreur instanceof Defaut ? "défaut" : erreur instanceof Precondition ? "précondition" : "erreur";
      verdict = { etape: nom, resultat: genre, raison: erreur.message };
    }
    verdict.duree_s = Math.round((Date.now() - debut) / 100) / 10;
    resultats.push(verdict);
    console.log(JSON.stringify(verdict));
    if (verdict.resultat !== "ok" && !TOUT) break;
    for (const p of await browser.pages()) if (p.url() !== "about:blank") await p.close();
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
