import { describe, expect, it } from "vitest";
import { entreesDeLaFeuille, type EtatFeuille } from "./feuille";
import { fautes } from "./mots";

const TELEPHONE: EtatFeuille = {
  sonCoupe: false,
  manette: "montree",
  plein: "api",
  pleinActif: false,
  clip: { phase: "prêt" },
};
const CLIPS: EtatFeuille["clip"][] = [
  null,
  { phase: "prêt" },
  { phase: "en cours" },
  { phase: "attendre", seconds: 9 },
  { phase: "fait", url: "blob:x", name: "c.mp4", bytes: 1 },
  { phase: "raté", why: "La salle n'a pas pu." },
];
const ids = (etat: EtatFeuille) => entreesDeLaFeuille(etat).map((entree) => entree.id);

describe("la feuille « La salle » à mi-hauteur", () => {
  it("porte chaque geste de la partie, puis la salle entière en dernier", () => {
    expect(ids(TELEPHONE)).toEqual([
      "son",
      "menu",
      "clip",
      "manette",
      "plein-ecran",
      "toute-la-salle",
    ]);
  });

  it("garde les 45 dernières secondes à mi-hauteur, et seulement pendant une partie", () => {
    const clip = (etat: EtatFeuille) => entreesDeLaFeuille(etat).find((une) => une.id === "clip");
    expect(clip(TELEPHONE)?.titre).toBe("Garder les 45 dernières secondes");
    expect(clip(TELEPHONE)?.inactif).toBeUndefined();
    // Le jumeau : sans partie, rien à garder.
    expect(ids({ ...TELEPHONE, clip: null })).not.toContain("clip");
    // En travers, la colonne unique de la feuille défilait : le clip reste
    // dans la salle entière.
    expect(ids({ ...TELEPHONE, travers: true })).not.toContain("clip");
    // Pendant l'emballage et le délai, le geste ne fait rien ; prêt, il
    // enregistre ; raté, il le dit en alerte.
    expect(clip({ ...TELEPHONE, clip: { phase: "en cours" } })?.inactif).toBe(true);
    expect(clip({ ...TELEPHONE, clip: { phase: "attendre", seconds: 12 } })?.inactif).toBe(true);
    const fait = clip({
      ...TELEPHONE,
      clip: { phase: "fait", url: "blob:x", name: "c.mp4", bytes: 1 },
    });
    expect(fait?.titre).toBe("Enregistrer le clip");
    expect(fait?.inactif).toBeUndefined();
    expect(clip({ ...TELEPHONE, clip: { phase: "raté", why: "non" } })?.alerte).toBe(true);
  });

  it("ne répète pas Signaler, qui vit en tête de la colonne de la feuille agrandie", () => {
    for (const etat of [
      TELEPHONE,
      { ...TELEPHONE, sonCoupe: true, plein: "ecran-accueil" as const },
    ])
      expect(ids(etat)).not.toContain("signaler");
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
          CLIPS.flatMap((clip) =>
            // Avec « Touches et manettes », qui a la place de sa rangée.
            entreesDeLaFeuille({
              sonCoupe,
              manette,
              plein,
              pleinActif: false,
              clip,
              reglage: true,
              hauteurMi: 500,
            }),
          ),
        ),
      ),
    );
    // La précondition : l'entrée du réglage est bien lue.
    expect(toutes.some((entree) => entree.id === "reglage")).toBe(true);
    for (const entree of toutes) {
      expect(fautes(entree.titre), entree.titre).toEqual([]);
      expect(fautes(entree.detail), entree.detail).toEqual([]);
    }
  });
});

describe("« Touches et manettes » à mi-hauteur", () => {
  /** La feuille d'un téléphone de 390×844 (380 px mesurés), et celle d'un
   * 375×667 (287 px), où trois rangées tiennent tout juste. */
  const HAUTE = 380;
  const BASSE = 287;
  const reglage = (etat: EtatFeuille) => entreesDeLaFeuille(etat).find((e) => e.id === "reglage");

  it("vient juste après le menu pour qui tient une place, quand sa rangée tient", () => {
    expect(ids({ ...TELEPHONE, reglage: true, hauteurMi: HAUTE })).toEqual([
      "son",
      "menu",
      "reglage",
      "clip",
      "manette",
      "plein-ecran",
      "toute-la-salle",
    ]);
    expect(reglage({ ...TELEPHONE, reglage: true, hauteurMi: HAUTE })?.titre).toBe(
      "Touches et manettes",
    );
  });

  it("le jumeau : sans place, pas d'entrée", () => {
    expect(ids({ ...TELEPHONE, reglage: false, hauteurMi: HAUTE })).not.toContain("reglage");
    expect(ids({ ...TELEPHONE, hauteurMi: HAUTE })).not.toContain("reglage");
  });

  it("ne fait pas défiler la feuille : une quatrième rangée ne tient pas à 287 px", () => {
    expect(ids({ ...TELEPHONE, reglage: true, hauteurMi: BASSE })).not.toContain("reglage");
    // Au repos, sans clip, six entrées tiennent en trois rangées.
    expect(ids({ ...TELEPHONE, clip: null, reglage: true, hauteurMi: BASSE })).toContain("reglage");
    // Sans hauteur connue, rien n'est promis.
    expect(ids({ ...TELEPHONE, clip: null, reglage: true })).not.toContain("reglage");
  });

  it("en travers, la colonne unique défilerait : l'entrée reste en tête de la salle entière", () => {
    expect(ids({ ...TELEPHONE, reglage: true, hauteurMi: HAUTE, travers: true })).not.toContain(
      "reglage",
    );
  });
});
