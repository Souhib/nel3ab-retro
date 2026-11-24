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
 * pas `nel3abTest.liaison`, et le verdict doit porter sur ce qu'on VOIT. */
const lire = (page) =>
  page.evaluate(() => {
    const etat = document.querySelector("#liaison, #arrivee");
    return {
      etat: etat?.getAttribute("data-etat") ?? null,
      texte: etat?.textContent?.replace(/\s+/g, " ").trim() ?? "",
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
    await capture(page, "gel-bandeau");
    // La colonne reste atteignable: le bouton de signalement de la colonne
    // reçoit bien le clic, rien ne le couvre.
    const atteint = await page.evaluate(() => {
      const bouton = document.querySelector("#complain");
      if (!bouton) return "absent";
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
    const pasFermee = (v) => (v.texte.includes("est fermée") ? "« fermée » pendant un redémarrage" : null);
    await durant(page, 1000, pasFermee);
    banc.regler({ redemarre: true });
    // Les sondes partent toutes les trois secondes: « redémarre » arrive avec
    // la suivante. Une seule réponse « fermée » ne doit jamais suffire.
    const dit = await jusqua(page, (v) => v.texte.includes("redémarre") || v.texte.includes("est fermée"), 5000);
    if (dit.apres === null) throw new Defaut(`« redémarre » jamais dit en ${Date.now() - debut} ms: ${dit.vu.texte}`);
    if (dit.vu.texte.includes("est fermée")) throw new Defaut(`« fermée » pendant un redémarrage: ${dit.vu.texte}`);
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
    banc.regler({ video: "drop", ouverte: false, redemarre: false });
    const fermee = await jusqua(page, (v) => v.texte.includes("La salle 1 est fermée."), 9000);
    if (fermee.apres === null) throw new Defaut(`une salle fermée n'est pas dite fermée en 9 s: ${fermee.vu.texte}`);
    const restes = await gestes();
    if (restes.length > 0) throw new Defaut(`la salle fermée propose encore ${restes.join(" et ")}`);
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
    const sorties = await page.evaluate(() => [
      document.querySelector("#arrivee #reessayer") !== null,
      document.querySelector("#arrivee #quitterSalle") !== null,
    ]);
    if (sorties.includes(false)) throw new Defaut(`le rideau n'a pas ses deux sorties: ${sorties}`);
    await capture(page, "arrivee-refusee");
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
      await sleep(12_000);
      // Tout se tait, la sonde du site aussi: c'est le Wi-Fi qui cale.
      banc.regler({ video: "silent", salles: "hang" });
      await sleep(4000);
      banc.regler({ video: "live", salles: "up" });
      if (proposes(debut).length > 0) break;
    }
    if (proposes(debut).length === 0)
      throw new Defaut(`aucune proposition en ${Math.round((Date.now() - debut) / 1000)} s de liaison qui cale`);
    const vu = await jusqua(page, (v) => v.rough, 1500);
    if (vu.apres === null) throw new Defaut("« proposé » au journal sans proposition à l'écran");
    await capture(page, "proposition");
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
