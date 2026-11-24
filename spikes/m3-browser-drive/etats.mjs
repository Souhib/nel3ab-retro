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

const args = process.argv.slice(2);
const option = (nom, defaut = null) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 ? args[i + 1] : defaut;
};
const drapeau = (nom) => args.includes(`--${nom}`);
const PAGE = option("page");
const FLUX = option("flux");
if (!PAGE || !FLUX) throw new Error("usage: etats.mjs --page <index.html> --flux <flux.h264>");
const PORT = Number(option("port", "5473"));
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
console.log(JSON.stringify({ page: PAGE, sha256: empreinte }));

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

async function nouvelle(vue, stockage = {}) {
  banc.reinitialiser();
  const page = await browser.newPage();
  await page.setViewport(taille(vue));
  await page.evaluateOnNewDocument((stockage) => {
    try {
      localStorage.setItem("nel3ab:name", "banc");
      localStorage.setItem("nel3ab:banc", "1");
      // La vue des touches de la première visite prend la place des rangs de
      // la colonne (chantier salle, étape 6); ces étapes partent d'une vue lue.
      localStorage.setItem("nel3ab:aide-clavier", "vue");
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

const ETAPES = {
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
    // Le salon dit depuis quand et pourquoi (K37, `Salle.fermee_depuis`).
    const fermeeA = Date.now() - 125_000;
    banc.regler({ video: "drop", ouverte: false, redemarre: false, fermeeDepuis: 125 });
    const fermee = await jusqua(page, (v) => /La salle 1 (est fermée|a fermé à)/.test(v.texte), 9000);
    if (fermee.apres === null) throw new Defaut(`une salle fermée n'est pas dite fermée en 9 s: ${fermee.vu.texte}`);
    const restes = await gestes();
    if (restes.length > 0) throw new Defaut(`la salle fermée propose encore ${restes.join(" et ")}`);
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
   * navigateur ne rende l'image, si le plein cadre se voit encore. */
  async "premiere-image-coupe"() {
    const fautes = [];
    for (const [vue, reduit] of [
      [PC, false],
      [TELEPHONE, false],
      [PC, true],
    ]) {
      const nom = `${vue.width}x${vue.height}${reduit ? " en mouvement réduit" : ""}`;
      const page = await nouvelle(vue);
      if (reduit) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
      await page.evaluate(() => {
        const etat = { peintes: 0, sous: 0, vuAvant: false, fin: false };
        window.__coupe = etat;
        const affiche = () => {
          const el = document.querySelector("#arrivee");
          return el !== null && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
        };
        const dessiner = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (...a) {
          const rendu = dessiner.apply(this, a);
          if (this.canvas?.id === "screen") {
            etat.peintes += 1;
            queueMicrotask(() => {
              if (affiche()) etat.sous += 1;
            });
          }
          return rendu;
        };
        const tour = () => {
          if (etat.fin) return;
          if (etat.peintes === 0 && affiche()) etat.vuAvant = true;
          else if (etat.peintes > 0 && affiche()) etat.sous += 1;
          requestAnimationFrame(tour);
        };
        requestAnimationFrame(tour);
      });
      // La salle répond sans image : l'arrivée se montre, puis l'image vient.
      banc.regler({ video: "freeze" });
      await page.click("#enter");
      const lu = () => page.evaluate(() => window.__coupe);
      const debut = Date.now();
      while (!(await lu()).vuAvant && Date.now() - debut < 8000) await sleep(100);
      if (!(await lu()).vuAvant) throw new Precondition(`${nom}: le plein cadre ne s'est jamais montré avant l'image`);
      banc.regler({ video: "live" });
      while ((await lu()).peintes < 30 && Date.now() - debut < 20000) await sleep(100);
      if ((await lu()).peintes < 30) throw new Precondition(`${nom}: moins de 30 images peintes`);
      await sleep(1000);
      const fin = await page.evaluate(() => {
        window.__coupe.fin = true;
        return window.__coupe;
      });
      if (fin.sous > 0) fautes.push(`${nom}: ${fin.sous} relevés d'une image peinte sous le plein cadre`);
      await page.close();
    }
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
  },

  /** La pastille d'une image figée ne touche pas l'image peinte, à + 4 px
   * (ADR D40), au bureau, au téléphone et en paysage. La page d'avant la
   * posait en bas de l'image : son « #liaison » de pastille est lu aussi.
   * Le gel est lu dans l'état de la page : en paysage avec le panneau
   * « petit », la page ne pose la pastille nulle part plutôt que sur
   * l'image (`placeDeLaPastille`), et ce n'est pas une faute ; trois tailles
   * au moins doivent la montrer, sinon l'étape ne prouve rien. */
  async "pastille-hors-image"() {
    const fautes = [];
    const vues = [];
    for (const vue of [PC, { width: 1280, height: 720 }, TELEPHONE, { width: 844, height: 390, isMobile: true, hasTouch: true }]) {
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
        return { coupe, a: [a.left, a.top, a.width, a.height].map(Math.round), b: [b.left, b.top, b.width, b.height].map(Math.round) };
      });
      if (mesure.erreur) throw new Precondition(`${nom}: ${mesure.erreur}`);
      if (!mesure.aucune) vues.push(nom);
      if (mesure.coupe) fautes.push(`${nom}: pastille ${mesure.a} sur l'image ${mesure.b}`);
      await capture(page, "pastille-hors-image");
      banc.regler({ video: "live" });
      await page.close();
    }
    if (fautes.length) throw new Defaut(fautes.join(" ; "));
    if (vues.length < 3) throw new Precondition(`pastille montrée à ${vues.length} tailles seulement (${vues})`);
    console.log(JSON.stringify({ pastille_montree: vues }));
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
   * a encore le temps de répondre. */
  async "arrivee-sans-image"() {
    const page = await nouvelle(PC);
    banc.regler({ video: "freeze" });
    await page.click("#enter");
    const gestes = () =>
      page.evaluate(() => ({
        reessayer: document.querySelector("#arrivee #reessayer") !== null,
        salles: document.querySelector("#arrivee #lesSalles") !== null,
        texte: document.querySelector("#arrivee")?.textContent ?? "",
      }));
    await sleep(3000);
    const tot = await gestes();
    if (!tot.texte) throw new Precondition("pas de plein cadre à l'arrivée");
    if (tot.reessayer || tot.salles) throw new Defaut(`à 3 s, l'arrivée parle déjà de panne: ${tot.texte}`);
    await sleep(12_000);
    const tard = await gestes();
    if (!tard.reessayer || !tard.salles) throw new Defaut(`à 15 s, pas de « Réessayer » ou d'« Autres salles »: ${tard.texte}`);
    const depuis = (t) => Number(/répond depuis (\d+) s/.exec(t)?.[1] ?? NaN);
    const un = depuis(tard.texte);
    await sleep(2000);
    const deux = depuis((await gestes()).texte);
    if (!Number.isFinite(un) || !Number.isFinite(deux)) throw new Defaut(`le temps depuis lequel la salle répond n'est pas dit: ${tard.texte}`);
    if (deux <= un) throw new Defaut(`le compte n'avance pas: ${un} s puis ${deux} s`);
    await capture(page, "arrivee-sans-image");
    await page.close();
  },

  /** « ouvrir le menu » depuis l'écran de chargement: le menu doit être
   * au-dessus, pas caché dessous en captant le clavier (audit P2, E5). */
  async "chargement-menu"() {
    const page = await nouvelle(PC);
    await entrer(page);
    banc.annoncerDemarrage();
    if ((await page.waitForSelector("#booting", { timeout: 3000 }).catch(() => null)) === null)
      throw new Precondition("pas d'écran de chargement après l'annonce");
    const bouton = await page.waitForSelector("#bootingMenu", { timeout: 12000 }).catch(() => null);
    if (bouton === null) throw new Precondition("pas de bouton « ouvrir le menu » en 12 s");
    await bouton.click();
    await sleep(400);
    const dessus = await page.evaluate(() => {
      const sous = document.elementFromPoint(innerWidth * 0.3, innerHeight / 2);
      return sous?.closest("#menu") ? "menu" : (sous?.closest("[id]")?.id ?? "rien");
    });
    if (dessus !== "menu") throw new Defaut(`le menu ouvert depuis le chargement est sous « ${dessus} »`);
    await capture(page, "chargement-menu");
    await page.close();
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

  /** Le plein cadre de l'arrivée tient sur un téléphone court : le titre,
   * les étapes, le fait et les gestes dans l'écran noir et dans la fenêtre,
   * rien de coupé, chaque geste haut de 44 px. Mesuré pendant l'arrivée (à
   * 3 s) et quand elle est perdue (à 15 s), à 375x667, 320x568 et en
   * travers à 844x390. Le jumeau : un titre trop long pour l'écran est vu. */
  async "arrivee-courte"() {
    const MESURE = () => {
      const ecran = document.querySelector("#arrivee .n3-plein-ecran");
      if (!ecran || getComputedStyle(document.querySelector("#arrivee")).display === "none") return { erreur: "pas de plein cadre" };
      const e = ecran.getBoundingClientRect();
      const fautes = [];
      if (ecran.scrollHeight > ecran.clientHeight + 1) fautes.push(`l'écran déborde de ${ecran.scrollHeight - ecran.clientHeight} px`);
      for (const el of ecran.querySelectorAll(":scope > :not(i), .n3-geste")) {
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
      await sleep(3000);
      const tot = await page.evaluate(MESURE);
      if (tot.erreur) throw new Precondition(`${nom}: ${tot.erreur} à 3 s`);
      if (tot.etapes !== 2) throw new Precondition(`${nom}: ${tot.etapes} étapes à 3 s`);
      fautes.push(...tot.fautes.map((f) => `${nom} à 3 s: ${f}`));
      await capture(page, "arrivee-courte-3s");
      await sleep(12_500);
      const tard = await page.evaluate(MESURE);
      if (tard.erreur) throw new Precondition(`${nom}: ${tard.erreur} à 15 s`);
      if (tard.gestes < 2) throw new Precondition(`${nom}: ${tard.gestes} gestes à 15 s`);
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

  async "colonne-stable"() {
    const page = await nouvelle(PC);
    banc.regler({ video: "freeze" });
    await page.click("#enter");
    if ((await page.waitForSelector("#arrivee", { visible: true, timeout: 8000 }).catch(() => null)) === null)
      throw new Precondition("pas de plein cadre avant l'image");
    await sleep(1500);
    const boites = () =>
      page.evaluate(() =>
        [...(document.querySelector("#side")?.children ?? [])].map((el) => {
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
    await page.evaluate(() => {
      document.querySelector("#side").lastElementChild.style.marginTop = "1px";
    });
    const jumeau = await boites();
    if (jumeau.every((b, i) => b === apres[i])) throw new Precondition("un enfant déplacé d'un pixel n'est pas vu");
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
