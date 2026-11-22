import { describe, expect, it } from "vitest";
import { entreesDeLaFeuille, type EtatFeuille } from "./feuille";
import { fautes } from "./mots";

const TELEPHONE: EtatFeuille = {
  sonCoupe: false,
  manette: "montree",
  plein: "api",
  pleinActif: false,
};
const ids = (etat: EtatFeuille) => entreesDeLaFeuille(etat).map((entree) => entree.id);

describe("la feuille du bas", () => {
  it("porte chaque geste de page d'un téléphone, et la salle", () => {
    expect(ids(TELEPHONE)).toEqual(["son", "menu", "salle", "manette", "plein-ecran", "signaler"]);
  });

  it("met le son coupé en tête, en alerte, et le dit", () => {
    const [son] = entreesDeLaFeuille({ ...TELEPHONE, sonCoupe: true });
    expect(son?.id).toBe("son");
    expect(son?.alerte).toBe(true);
    expect(son?.titre).toBe("Rallumer le son");
    // Le jumeau: un son qui joue ne s'alerte pas, et propose un essai.
    const [joue] = entreesDeLaFeuille(TELEPHONE);
    expect(joue?.alerte).toBe(false);
    expect(joue?.titre).toBe("Tester le son");
  });

  it("propose l'écran d'accueil à un iPhone, et pas le plein écran", () => {
    expect(ids({ ...TELEPHONE, plein: "ecran-accueil" })).toContain("ecran-accueil");
    expect(ids({ ...TELEPHONE, plein: "ecran-accueil" })).not.toContain("plein-ecran");
    // Le jumeau: un téléphone qui a l'API n'a pas besoin du conseil.
    expect(ids(TELEPHONE)).not.toContain("ecran-accueil");
  });

  it("ne promet ni l'un ni l'autre quand rien ne tiendrait", () => {
    for (const plein of ["deja", "aucun"] as const) {
      expect(ids({ ...TELEPHONE, plein })).not.toContain("plein-ecran");
      expect(ids({ ...TELEPHONE, plein })).not.toContain("ecran-accueil");
    }
  });

  it("dit quitter le plein écran quand on y est", () => {
    const titre = (pleinActif: boolean) =>
      entreesDeLaFeuille({ ...TELEPHONE, pleinActif }).find((one) => one.id === "plein-ecran")
        ?.titre;
    expect(titre(true)).toBe("Quitter le plein écran");
    expect(titre(false)).toBe("Plein écran");
  });

  it("cache ou montre la manette selon son état, et n'en parle pas à la souris", () => {
    const titre = (manette: EtatFeuille["manette"]) =>
      entreesDeLaFeuille({ ...TELEPHONE, manette }).find((one) => one.id === "manette")?.titre;
    // Les commandes à l'écran ont un seul nom (`TACTILE`): « la manette » est
    // l'objet qu'on tient (lexique, vérification finale du 22 novembre 2026).
    expect(titre("montree")).toBe("Cacher les commandes tactiles");
    expect(titre("cachee")).toBe("Montrer les commandes tactiles");
    expect(titre(null)).toBeUndefined();
  });

  it("dit comment rallumer le son, sans parler d'un interrupteur que la page contourne", () => {
    // « regarde le bouton silence du téléphone » s'affichait aussi sur un
    // ordinateur en fenêtre étroite, et contredisait `media/sound.ts`, dont le
    // déblocage fait justement sortir le son du canal de la sonnerie
    // (relecture du 22 novembre 2026).
    const son = entreesDeLaFeuille({ ...TELEPHONE, sonCoupe: true }).find(
      (one) => one.id === "son",
    );
    expect(son?.detail).not.toMatch(/silence|interrupteur|téléphone/);
    expect(son?.detail).toMatch(/coupé/);
    expect(son?.detail).toMatch(/Touche ici/);
  });

  it("ne nomme pas Safari pour l'écran d'accueil, qui vaut aussi pour Chrome sur iPhone", () => {
    const accueil = entreesDeLaFeuille({ ...TELEPHONE, plein: "ecran-accueil" }).find(
      (one) => one.id === "ecran-accueil",
    );
    expect(accueil?.detail).not.toMatch(/Safari/);
    expect(accueil?.detail).toMatch(/barre/);
  });

  it("n'écrit aucun mot que le lexique refuse", () => {
    const toutes = [true, false].flatMap((sonCoupe) =>
      (["montree", "cachee"] as const).flatMap((manette) =>
        (["api", "ecran-accueil"] as const).flatMap((plein) =>
          entreesDeLaFeuille({ sonCoupe, manette, plein, pleinActif: false }),
        ),
      ),
    );
    for (const entree of toutes) {
      expect(fautes(entree.titre), entree.titre).toEqual([]);
      expect(fautes(entree.detail), entree.detail).toEqual([]);
    }
  });
});
