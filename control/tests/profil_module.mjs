// Exécute la VRAIE page du carnet servie par le salon dans jsdom.
//
// Reçoit sur son entrée `{ page, reponses, stockage?, nom?, complet? }`: le HTML
// que le salon sert, la réponse de chaque lecture (`/api/me/profil`,
// `/api/me/sauvegardes`, `/api/me/parties`, `/api/me`), ce que le navigateur
// garde déjà (`localStorage`), et un nom à écrire dans « Changer ton nom ».
//
// Sans `complet`, rend le texte de chaque ligne du tableau des parties (la
// forme des premiers essais du carnet commun). Avec, rend la vue entière:
// groupes par soirée, lignes, phrase du haut, bouton plein, scènes d'Aïn,
// stockage après ouverture, et les PUT de /api/me.
import { createRequire } from "node:module";
import { text } from "node:stream/consumers";

const require = createRequire(new URL("../../front/package.json", import.meta.url));
const { JSDOM } = require("jsdom");

const { page, reponses, stockage = {}, nom = null, complet = false } = JSON.parse(await text(process.stdin));
const puts = [];
const dom = new JSDOM(page, {
  url: "http://salon.test/profil",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = () => null;
    for (const [cle, valeur] of Object.entries(stockage)) window.localStorage.setItem(cle, valeur);
    window.fetch = async (adresse, options = {}) => {
      const chemin = new URL(adresse, "http://salon.test/").pathname;
      if (chemin === "/api/me" && options.method === "PUT") {
        const corps = JSON.parse(options.body);
        puts.push(corps);
        return { ok: true, status: 200, json: async () => ({ login: "x", name: corps.name, display: corps.name }) };
      }
      const corps = reponses[chemin];
      if (corps === undefined) return { ok: false, status: 404, json: async () => ({}) };
      if (corps === 401) return { ok: false, status: 401, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => corps };
    };
  },
});
const { window } = dom;
const { document } = window;
const scenes = [];
if (window.nel3abAin) window.nel3abAin.scene = (quoi) => { scenes.push(quoi); return "cle"; };
const ouvert = () =>
  document.querySelector("#parties tr.partie") || !document.getElementById("aucune").hidden
  || !document.getElementById("voir-salles").hidden;
for (let essai = 0; essai < 50; essai += 1) {
  await new Promise((fin) => setTimeout(fin, 20));
  if (ouvert()) break;
}
const lignes = [...document.querySelectorAll("#parties tr.partie")].map((tr) => ({
  texte: tr.textContent,
  avec: tr.querySelector(".partie-avec")?.textContent ?? null,
  duree: tr.querySelector(".duree")?.textContent ?? null,
  lancePar: tr.querySelector(".lance-par")?.textContent ?? null,
  sauvegarde: tr.querySelector(".sauvegarde")?.textContent ?? null,
  nouvelle: tr.hasAttribute("data-nouvelle"),
}));
if (!complet) {
  process.stdout.write(JSON.stringify(lignes));
  process.exit(0);
}
if (nom !== null) {
  document.getElementById("changer-nom").click();
  document.getElementById("nom-champ").value = nom;
  document.getElementById("nom-forme").requestSubmit();
  await new Promise((fin) => setTimeout(fin, 40));
}
process.stdout.write(JSON.stringify({
  lignes,
  groupes: [...document.querySelectorAll("#parties tbody")].map((g) => ({
    soiree: g.dataset.soiree,
    lignes: g.querySelectorAll("tr.partie").length,
  })),
  phrase: document.getElementById("depuis").textContent,
  voirSalles: !document.getElementById("voir-salles").hidden,
  scenes,
  vu: window.localStorage.getItem("nel3ab:carnet-vu"),
  puts,
  etiquette: document.getElementById("etiquette").textContent,
  boiteOuverte: document.getElementById("nom").hasAttribute("open"),
}));
