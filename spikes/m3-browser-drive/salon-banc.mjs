// Le banc du salon: les trois pages du salon telles que ses modules Python les
// assemblent (`accueil.PAGE`, `importer.PAGE`, `profil.PAGE`), servies par un
// petit serveur local avec des API simulées. Aucun salon ne démarre, aucune
// salle ne s'ouvre: le POST d'ouverture est noté et répondu par le banc (K40).
//
//   const banc = await demarrerSalon({ port: 0 });   // 0 : un port libre (`port.mjs`)
//   banc.regler({ salles: [...], post: { statut: 201, corps: {...}, delai: 800 } });
//   banc.envois  // les corps des POST /api/salles reçus
//
// `pages` remplace l'assemblage par un fichier JSON `{ "/": html, ... }`:
// c'est ainsi que le contrôle rouge sert les pages d'un commit plus ancien.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { ecouter } from "./port.mjs";

const ASSEMBLER = [
  "import json, sys",
  "from nel3ab_control.api.routes import accueil, importer, profil",
  "json.dump({'/': accueil.PAGE, '/importer': importer.PAGE, '/profil': profil.PAGE}, sys.stdout)",
].join("\n");

/** Les pages du salon, assemblées par ses vrais modules (`uv run`). */
export function assembler() {
  const sortie = spawnSync("uv", ["run", "--quiet", "python", "-c", ASSEMBLER], {
    cwd: new URL("../../control/", import.meta.url).pathname,
    encoding: "utf-8",
    maxBuffer: 1 << 27,
  });
  if (sortie.status !== 0) throw new Error(`le salon n'a pas assemblé ses pages: ${sortie.stderr.slice(0, 600)}`);
  return JSON.parse(sortie.stdout);
}

export async function demarrerSalon({ port, pages = null }) {
  const servies = pages ? JSON.parse(readFileSync(pages, "utf-8")) : assembler();
  const etat = {};
  const envois = [];
  const reinitialiser = () => {
    Object.assign(etat, {
      salles: [],
      statut: 200,
      post: { statut: 201, corps: {}, delai: 0 },
      moi: null,
      droits: { peut_importer: false },
      apres: null,
      carnet: null,
      catalogue: null,
      imports: [],
      importeurs: null,
      suivis: {},
      catalogueApres: null,
    });
    envois.length = 0;
  };
  reinitialiser();

  const json = (res, statut, corps) => {
    res.writeHead(statut, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(corps));
  };
  const serveur = createServer((req, res) => {
    const adresse = new URL(req.url, "http://banc");
    const chemin = adresse.pathname;
    let corps = "";
    req.on("data", (b) => { corps += b; });
    req.on("end", () => {
      if (req.method === "GET" && servies[chemin]) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(servies[chemin]);
        return;
      }
      if (chemin === "/api/salles" && req.method === "GET") {
        if (etat.statut !== 200) return json(res, etat.statut, { detail: "banc" });
        return json(res, 200, etat.salles);
      }
      if (chemin === "/api/salles" && req.method === "POST") {
        envois.push(corps ? JSON.parse(corps) : null);
        const { statut, corps: reponse, delai } = etat.post;
        setTimeout(() => {
          // Ce que la liste dit après l'ouverture, comme un vrai salon.
          if (etat.apres) etat.salles = etat.apres;
          json(res, statut, reponse);
        }, delai ?? 0);
        return;
      }
      if (chemin === "/api/me" && req.method === "PUT") {
        envois.push({ me: JSON.parse(corps) });
        etat.moi = { ...(etat.moi ?? { login: "banc" }), name: JSON.parse(corps).name };
        return json(res, 200, etat.moi);
      }
      if (chemin === "/api/me") return etat.moi ? json(res, 200, etat.moi) : json(res, 200, { login: null, name: "", display: "" });
      // Le carnet: `carnet` donne chaque lecture de /api/me/…; sans lui, 401.
      if (chemin.startsWith("/api/me/")) {
        const cle = chemin.slice("/api/me/".length);
        return etat.carnet?.[cle] !== undefined ? json(res, 200, etat.carnet[cle]) : json(res, 401, { detail: "banc" });
      }
      if (chemin === "/api/imports/droits") return json(res, 200, etat.droits);
      // Le trousseau de l'administrateur: la liste, puis donner (PUT) ou
      // retirer (DELETE) le droit d'une personne, qui revient changée.
      if (chemin === "/api/importeurs" && etat.importeurs) return json(res, 200, etat.importeurs);
      if (chemin.startsWith("/api/importeurs/") && etat.importeurs && (req.method === "PUT" || req.method === "DELETE")) {
        const login = decodeURIComponent(chemin.slice("/api/importeurs/".length));
        const personne = etat.importeurs.personnes.find((p) => p.login === login);
        if (!personne) return json(res, 404, { detail: "inconnue du banc" });
        personne.droit = req.method === "PUT" ? "nomme" : "aucun";
        envois.push({ importeur: login, methode: req.method });
        return json(res, 200, personne);
      }
      // Les envois d'avant le chargement de la page de dépôt.
      if (chemin === "/api/imports" && req.method === "GET") return json(res, 200, etat.imports);
      // Un envoi suivi: chaque relevé rend l'état suivant de sa liste, puis
      // garde le dernier. Le dernier servi change le catalogue, comme un jeu
      // rangé l'ajoute à la bibliothèque.
      if (chemin.startsWith("/api/imports/") && req.method === "GET" && etat.suivis[chemin.slice("/api/imports/".length)]) {
        const suite = etat.suivis[chemin.slice("/api/imports/".length)];
        const envoi = suite.length > 1 ? suite.shift() : suite[0];
        if (suite.length === 1 && envoi === suite[0] && etat.catalogueApres) {
          etat.catalogue = etat.catalogueApres;
          etat.catalogueApres = null;
        }
        return json(res, 200, envoi);
      }
      if (chemin === "/api/catalogue") return etat.catalogue ? json(res, 200, etat.catalogue) : json(res, 404, { detail: "banc" });
      if (chemin.startsWith("/api/catalogue/art/") && (req.method === "PUT" || req.method === "DELETE")) {
        envois.push({ art: decodeURIComponent(chemin.slice("/api/catalogue/art/".length)), methode: req.method, octets: corps.length });
        res.writeHead(204);
        res.end();
        return;
      }
      return json(res, 404, { detail: "absent du banc" });
    });
  });
  const ecoute = await ecouter(serveur, port);
  const base = `http://127.0.0.1:${ecoute}`;
  return {
    port: ecoute,
    base,
    url: `${base}/`,
    envois,
    reinitialiser,
    regler(reglage) { Object.assign(etat, reglage); },
    fermer: () => new Promise((ok) => serveur.close(ok)),
  };
}
