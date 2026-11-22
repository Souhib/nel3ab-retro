// Exécute la VRAIE page d'accueil servie par le salon dans jsdom, tour après tour.
//
// Reçoit sur son entrée `{ page, tours }`: le HTML que le salon sert, et la
// réponse de `/api/salles` à chaque tour de sondage. Le premier tour est celui
// du chargement; chaque suivant est déclenché par le rappel que la page a
// confié à `setInterval`, comme le navigateur le ferait toutes les cinq
// secondes. Rend, pour chaque tour suivant, ce qu'un observateur a vu changer
// dans la liste des salles et ce que la ligne d'annonce dit.
import { createRequire } from "node:module";
import { text } from "node:stream/consumers";

const require = createRequire(new URL("../../front/package.json", import.meta.url));
const { JSDOM } = require("jsdom");

const { page, tours } = JSON.parse(await text(process.stdin));
const reponses = [...tours];
let sonder = null;

const dom = new JSDOM(page, {
  url: "http://salon.test/",
  runScripts: "dangerously",
  beforeParse(window) {
    window.fetch = async (adresse, options = {}) => {
      const chemin = new URL(adresse, "http://salon.test/").pathname;
      if (chemin === "/api/salles" && (options.method ?? "GET") === "GET") {
        const corps = reponses.shift();
        return { ok: true, status: 200, json: async () => corps };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    window.setInterval = (rappel) => {
      sonder = rappel;
      return 1;
    };
  },
});
const { window } = dom;
const attendre = () => new Promise((fin) => setTimeout(fin, 30));
await attendre();
if (sonder === null) throw new Error("la page n'a pas confié son sondage à setInterval");

const liste = window.document.getElementById("salles");
const annonce = window.document.getElementById("annonce");
const decrire = (r) => ({
  type: r.type,
  cible: String(r.target.className || r.target.parentElement?.className || r.target.nodeName),
  attribut: r.attributeName,
});
const rendus = [];
for (let tour = 1; tour < tours.length; tour += 1) {
  const vus = [];
  const observateur = new window.MutationObserver((lots) => vus.push(...lots.map(decrire)));
  observateur.observe(liste, { childList: true, subtree: true, characterData: true, attributes: true });
  sonder();
  await attendre();
  vus.push(...observateur.takeRecords().map(decrire));
  observateur.disconnect();
  rendus.push({ mutations: vus, annonce: annonce?.textContent ?? null });
}
rendus.push({
  vivante: liste.getAttribute("aria-live"),
  role: annonce?.getAttribute("role") ?? null,
  texte: liste.textContent,
});
window.close();
process.stdout.write(JSON.stringify(rendus));
