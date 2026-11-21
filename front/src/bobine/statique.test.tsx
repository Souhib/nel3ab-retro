/**
 * Bobine hors de React: les pages du salon (accueil, import, profil) sont du
 * HTML servi par Python, sans la page de la salle. Elles reçoivent le MÊME
 * dessin et la MÊME feuille, recopiés depuis ce dossier.
 *
 * Une copie qui peut diverger doit être vérifiée: cet essai échoue si les
 * fichiers du salon ne sont plus ceux que ce composant produit. Pour les
 * remettre à jour après un changement du dessin:
 *
 *     N3_BOBINE_ECRIRE=1 npx vitest run src/bobine/statique.test.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Bobine } from "./Bobine";

/* Ce fichier tourne sous Node (vitest) mais appartient au projet TypeScript
   de la page, qui n'a pas les types de Node, et ne doit pas les avoir: ils
   changeraient le type de `setTimeout` dans toute la page. Les deux modules
   utilisés sont donc importés dynamiquement, avec la seule forme qu'on en lit. */
type Fs = {
  readFileSync: (chemin: string, codage: "utf-8") => string;
  writeFileSync: (chemin: string, contenu: string) => void;
};
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
const ici = (relatif: string) => new URL(relatif, import.meta.url).pathname;
const SALON = ici("../../../control/nel3ab_control/api/routes/bobine/");
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const TENUES = ["aucune", "fiche", "loupe", "tampon", "cartouche", "disque", "carte"] as const;

function attendus(): Map<string, string> {
  const fichiers = new Map<string, string>();
  for (const tenue of TENUES) {
    const dessin = renderToStaticMarkup(
      <Bobine taille={72} tenue={tenue === "aucune" ? undefined : tenue} />,
    );
    fichiers.set(`bobine-${tenue}.svg`, `${dessin}\n`);
  }
  fichiers.set("bobine.css", fs.readFileSync(ici("bobine.css"), "utf-8"));
  return fichiers;
}

it("les copies du salon sont celles que le composant produit", () => {
  const ecrire = env?.N3_BOBINE_ECRIRE === "1";
  for (const [nom, contenu] of attendus()) {
    const chemin = `${SALON}${nom}`;
    if (ecrire) fs.writeFileSync(chemin, contenu);
    expect(fs.readFileSync(chemin, "utf-8"), `${nom} est périmé`).toBe(contenu);
  }
});
