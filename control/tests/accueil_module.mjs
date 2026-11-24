// Exécute la VRAIE page d'accueil servie par le salon dans jsdom, tour après tour.
//
// Reçoit sur son entrée `{ page, tours, adresse?, post?, cliquer?, moi?, droits?, focus? }`:
//
// - `page`: le HTML que le salon sert, paquet du salon compris;
// - `tours`: la réponse de `/api/salles` à chaque tour de sondage. Une liste
//   est une réponse 200; `{ "statut": 502 }` est un relevé manqué. Le premier
//   tour est celui du chargement; chaque suivant est déclenché par le rappel
//   que la page a confié à `setInterval`, comme le navigateur toutes les cinq
//   secondes;
// - `adresse`: l'adresse de la page (`/?salle=fermee&n=3`);
// - `cliquer`: `{ apres: i, cible: "#ouvrir" }` clique une cible après le
//   tour `i`; la réponse du POST est `post` (`{ statut, corps }`), et le POST
//   prend le tour suivant de `tours` pour son relevé;
// - `moi`, `droits`: les réponses de `/api/me` et `/api/imports/droits`;
// - `focus`: un sélecteur, focalisé et marqué d'un témoin après le premier
//   dessin; chaque vue dit qui tient le focus (`actif`).
//
// Rend, pour chaque tour suivant le premier, ce qu'un observateur a vu
// changer dans la rangée, ce que la ligne d'annonce dit, et la vue entière
// (accroche, bornes, places, panneau); puis les scènes demandées à Aïn, les
// POST envoyés et la boucle d'attention, armée ou coupée.
import { createRequire } from "node:module";
import { text } from "node:stream/consumers";

const require = createRequire(new URL("../../front/package.json", import.meta.url));
const { JSDOM } = require("jsdom");

const entree = JSON.parse(await text(process.stdin));
const { page, tours } = entree;
const reponses = [...tours];
const envois = [];
/** Les armements et coupures de la boucle d'attention (`surAttention`). */
const attention = [];
/** Les rappels confiés à la boucle d'attention doublée. */
const rappels = [];
let sonder = null;

const reponse = (statut, corps) => ({ ok: statut >= 200 && statut < 300, status: statut, json: async () => corps });

const dom = new JSDOM(page, {
  url: `http://salon.test${entree.adresse ?? "/"}`,
  runScripts: "dangerously",
  pretendToBeVisual: true,
  beforeParse(window) {
    // jsdom n'a pas de toile: Aïn reste au repos, sans bruit sur la console.
    window.HTMLCanvasElement.prototype.getContext = () => null;
    window.fetch = async (adresse, options = {}) => {
      const chemin = new URL(adresse, "http://salon.test/").pathname;
      const methode = options.method ?? "GET";
      if (chemin === "/api/salles" && methode === "GET") {
        const corps = reponses.shift();
        if (corps === undefined) throw new Error("plus de tour de sondage prévu");
        return Array.isArray(corps) ? reponse(200, corps) : reponse(corps.statut, {});
      }
      if (chemin === "/api/salles" && methode === "POST") {
        envois.push(options.body ? JSON.parse(options.body) : null);
        const post = entree.post ?? { statut: 201, corps: {} };
        return reponse(post.statut, post.corps);
      }
      if (chemin === "/api/me") return entree.moi ? reponse(200, entree.moi) : reponse(404, {});
      if (chemin === "/api/imports/droits") return reponse(200, entree.droits ?? { peut_importer: false });
      return reponse(404, {});
    };
    window.setInterval = (rappel) => {
      sonder = rappel;
      return 1;
    };
    // La boucle d'attention du paquet, doublée au moment où le paquet la
    // pose : son armement et sa coupure sont relevés. Son rappel est gardé,
    // et joué une fois après le dernier tour quand l'entrée le demande
    // (`jouerAttention`) : un tour joué tout de suite décalait les scènes
    // que les autres essais lisent dans l'ordre.
    let salon;
    Object.defineProperty(window, "nel3abSalon", {
      configurable: true,
      get: () => salon,
      set(valeur) {
        salon = valeur;
        if (valeur && typeof valeur.surAttention === "function") {
          valeur.surAttention = (jouer) => {
            attention.push("arme");
            rappels.push(jouer);
            return () => attention.push("coupe");
          };
        }
      },
    });
  },
});
const { window } = dom;
const { document } = window;
const scenes = [];
if (!window.nel3abAin) throw new Error("le paquet du salon n'a pas posé nel3abAin");
window.nel3abAin.scene = (quoi) => {
  scenes.push(quoi);
  return "cle";
};
const attendre = () => new Promise((fin) => setTimeout(fin, 30));
await attendre();
if (sonder === null) throw new Error("la page n'a pas confié son sondage à setInterval");

const liste = document.getElementById("salles");
const annonce = document.getElementById("annonce");
const texte = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : null);
const cache = (el) => (el ? el.hidden || el.closest("[hidden]") !== null : null);

/** Ce que la page montre: ce qu'un pilote ou une personne lirait. */
function vue() {
  const pleins = [
    ...[...document.querySelectorAll("a.start[data-plein]")].map((a) => a.getAttribute("href")),
    ...[...document.querySelectorAll("button.plein")].filter((b) => !cache(b)).map((b) => `#${b.id}`),
  ];
  return {
    accroche: texte(document.getElementById("accroche")),
    sous: texte(document.getElementById("sous-accroche")),
    // Le texte qu'on voit: ni scripts, ni feuilles, ni ce qui est caché.
    texte: (() => {
      const copie = document.querySelector("main").cloneNode(true);
      for (const el of copie.querySelectorAll("script, style, [hidden]")) el.remove();
      return copie.textContent.replace(/\s+/g, " ").trim();
    })(),
    mot: texte(document.getElementById("mot")),
    credit: texte(document.getElementById("credit")),
    startCache: cache(document.getElementById("start")),
    ouvrirCache: cache(document.getElementById("ouvrir")),
    pleins,
    vide: liste.querySelector(".vide") !== null,
    jauge: document.querySelector(".jauge") !== null,
    horlogePerdue: document.getElementById("horloge").dataset.perdue ?? null,
    retour: { cache: cache(document.getElementById("retour")), texte: texte(document.getElementById("retour-mot")) },
    // Ce qui tient le focus du clavier: le témoin dit si c'est le NŒUD que
    // `focus` a focalisé, et pas un nœud refait au même nom.
    actif: (() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      return { temoin: el.dataset?.temoin === "oui", nom: el.getAttribute("aria-label"), lien: el.getAttribute("href") };
    })(),
    adresse: window.location.pathname + window.location.search,
    bornes: [...liste.querySelectorAll("article.salle")].map((art) => ({
      salle: art.dataset.salle,
      etat: art.dataset.etat,
      titre: texte(art.querySelector(".titre")),
      placesMot: texte(art.querySelector(".places-mot")),
      jeu: texte(art.querySelector(".jeu")),
      gens: texte(art.querySelector(".gens")),
      etiquettes: [...art.querySelectorAll(".gens .etiquette")].map(texte),
      jaquette: art.querySelector(".cartouche img")?.getAttribute("src") ?? null,
      boutons: art.querySelectorAll("a, button").length - art.querySelectorAll(".regarder[hidden]").length,
      starts: [...art.querySelectorAll(".start")].map((s) => ({
        place: s.dataset.place,
        lien: s.getAttribute("href"),
        mot: texte(s.querySelector(".start-mot")),
        etiquette: texte(s.querySelector(".etiquette")),
        plein: s.hasAttribute("data-plein"),
        arrive: s.hasAttribute("data-arrive"),
      })),
      regarder: {
        lien: art.querySelector(".regarder")?.getAttribute("href") ?? null,
        cache: cache(art.querySelector(".regarder")),
      },
    })),
    eteints: [...liste.querySelectorAll(".eteint")].map((bloc) => ({
      salle: bloc.dataset.salle,
      titre: texte(bloc.querySelector(".titre")),
      ouvrir: texte(bloc.querySelector("button")),
    })),
  };
}

const decrire = (r) => ({
  type: r.type,
  cible: String(r.target.className || r.target.parentElement?.className || r.target.nodeName),
  attribut: r.attributeName,
});
if (entree.focus) {
  // Le focus du clavier posé après le premier dessin, sur un nœud marqué.
  const cible = document.querySelector(entree.focus);
  if (!cible) throw new Error(`rien à focaliser: ${entree.focus}`);
  cible.dataset.temoin = "oui";
  cible.focus();
  if (document.activeElement !== cible) throw new Error(`le focus ne se pose pas sur ${entree.focus}`);
}
const rendus = [{ mutations: [], annonce: annonce.textContent, vue: vue() }];
for (let tour = 1; tour <= tours.length; tour += 1) {
  if (entree.cliquer?.apres === tour - 1) {
    // `touche:Enter` appuie sur Entrée hors de tout champ, comme APPUIE SUR START.
    if (entree.cliquer.cible.startsWith("touche:")) {
      const key = entree.cliquer.cible.slice("touche:".length);
      document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
    } else document.querySelector(entree.cliquer.cible).click();
    await attendre();
    rendus.push({ mutations: [], annonce: annonce.textContent, vue: vue(), clic: true });
  }
  if (reponses.length === 0) break;
  const vus = [];
  const observateur = new window.MutationObserver((lots) => vus.push(...lots.map(decrire)));
  observateur.observe(liste, { childList: true, subtree: true, characterData: true, attributes: true });
  sonder();
  await attendre();
  vus.push(...observateur.takeRecords().map(decrire));
  observateur.disconnect();
  rendus.push({ mutations: vus, annonce: annonce.textContent, vue: vue() });
}
if (entree.jouerAttention) for (const jouer of rappels) jouer("attente");
window.close();
process.stdout.write(
  JSON.stringify({
    rendus,
    scenes,
    envois,
    attention,
    vivante: liste.getAttribute("aria-live"),
    role: annonce.getAttribute("role"),
  }),
);
