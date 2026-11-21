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
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Bobine } from "./Bobine";

const SALON = resolve(__dirname, "../../../control/nel3ab_control/api/routes/bobine");
const TENUES = ["aucune", "fiche", "loupe", "tampon", "cartouche", "disque", "carte"] as const;

function attendus(): Map<string, string> {
  const fichiers = new Map<string, string>();
  for (const tenue of TENUES) {
    const dessin = renderToStaticMarkup(
      <Bobine taille={72} tenue={tenue === "aucune" ? undefined : tenue} />,
    );
    fichiers.set(`bobine-${tenue}.svg`, `${dessin}\n`);
  }
  fichiers.set("bobine.css", readFileSync(resolve(__dirname, "bobine.css"), "utf-8"));
  return fichiers;
}

it("les copies du salon sont celles que le composant produit", () => {
  const ecrire = process.env.N3_BOBINE_ECRIRE === "1";
  for (const [nom, contenu] of attendus()) {
    const chemin = resolve(SALON, nom);
    if (ecrire) writeFileSync(chemin, contenu);
    expect(readFileSync(chemin, "utf-8"), `${nom} est périmé`).toBe(contenu);
  }
});
