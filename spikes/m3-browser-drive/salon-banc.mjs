// Le banc du salon: les trois pages du salon telles que ses modules Python les
// assemblent (`accueil.PAGE`, `importer.PAGE`, `profil.PAGE`), servies par un
// petit serveur local avec des API simulées. Aucun salon ne démarre, aucune
// salle ne s'ouvre: le POST d'ouverture est noté et répondu par le banc (K40).
//
//   const banc = await demarrerSalon({ port: 5462 });
//   banc.regler({ salles: [...], post: { statut: 201, corps: {...}, delai: 800 } });
//   banc.envois  // les corps des POST /api/salles reçus
//
// `pages` remplace l'assemblage par un fichier JSON `{ "/": html, ... }`:
// c'est ainsi que le contrôle rouge sert les pages d'un commit plus ancien.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

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
  await new Promise((ok, refus) => {
    serveur.once("error", refus);
    serveur.listen(port, "127.0.0.1", ok);
  });
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    url: `${base}/`,
    envois,
    reinitialiser,
    regler(reglage) { Object.assign(etat, reglage); },
    fermer: () => new Promise((ok) => serveur.close(ok)),
  };
}
