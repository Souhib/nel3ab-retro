// Exécute la VRAIE page du carnet servie par le salon dans jsdom.
//
// Reçoit sur son entrée `{ page, reponses }`: le HTML que le salon sert, et la
// réponse de chaque lecture (`/api/me/profil`, `/api/me/jeux`,
// `/api/me/sauvegardes`, `/api/me/parties`). Rend le texte de chaque ligne de
// la liste des parties, une fois la page ouverte.
import { createRequire } from "node:module";
import { text } from "node:stream/consumers";

const require = createRequire(new URL("../../front/package.json", import.meta.url));
const { JSDOM } = require("jsdom");

const { page, reponses } = JSON.parse(await text(process.stdin));
const dom = new JSDOM(page, {
  url: "http://salon.test/profil",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  beforeParse(window) {
    window.fetch = async (adresse) => {
      const chemin = new URL(adresse, "http://salon.test/").pathname;
      const corps = reponses[chemin];
      if (corps === undefined) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => corps };
    };
  },
});
const { window } = dom;
for (let essai = 0; essai < 50; essai += 1) {
  await new Promise((fin) => setTimeout(fin, 20));
  if (window.document.querySelector("#parties li")) break;
}
const lignes = [...window.document.querySelectorAll("#parties li")].map((li) => ({
  texte: li.textContent,
  avec: li.querySelector(".partie-avec")?.textContent ?? null,
}));
process.stdout.write(JSON.stringify(lignes));
