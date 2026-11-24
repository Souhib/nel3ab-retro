/**
 * Le menu de la salle sans React (chantier menus) : la forme de chaque
 * ligne, les groupes, les flèches et la place du menu. Chaque règle a son
 * jumeau : une flèche qui ne bouge pas doit aussi savoir bouger.
 */
import { describe, expect, it } from "vitest";
import { ICONES_PIXEL } from "../retro/icones";
import { MANETTES, miseEnPage, SANS_ZONES, type Entree, type Rect } from "./cadre";
import { FENTE } from "./faces";
import {
  AIDE_MAX,
  aidesTropLongues,
  BANDE_MIN,
  HAUTEUR_MIN,
  enGroupes,
  formeDe,
  ICONE_DE_RUBRIQUE,
  pas,
  placeDuMenu,
  RUBRIQUES,
  voisin,
  type Ligne,
  type Rubrique,
} from "./menu";

const ligne = (plus: Partial<Ligne> = {}): Ligne => ({
  id: "x",
  label: "x",
  ...plus,
});

describe("les rubriques", () => {
  it("sont quatre, dans l'ordre des onglets", () => {
    expect(RUBRIQUES).toEqual(["jeux", "manettes", "salle", "reglages"]);
  });

  it("ont chacune une icône du jeu du socle, et jamais la même (M14)", () => {
    const icones = RUBRIQUES.map((r) => ICONE_DE_RUBRIQUE[r]);
    for (const nom of icones) expect(Object.keys(ICONES_PIXEL)).toContain(nom);
    // Le jumeau : deux rubriques au même dessin ne se distinguent plus.
    expect(new Set(icones).size).toBe(RUBRIQUES.length);
  });
});

describe("la forme d'une ligne", () => {
  it("dit ce que la ligne dessine", () => {
    expect(formeDe(ligne({ onEnter: () => {} }))).toBe("action");
    expect(formeDe(ligne({ picks: [{ id: "a", label: "a" }] }))).toBe("choix");
    expect(
      formeDe(
        ligne({
          slide: {
            value: 1,
            min: 0,
            max: 2,
            step: 1,
            say: String,
            onSet: () => {},
          },
        }),
      ),
    ).toBe("glissiere");
    expect(formeDe(ligne({ bascule: false }))).toBe("bascule");
    expect(formeDe(ligne({ deplie: false }))).toBe("depli");
  });

  // Le jumeau : une décision n'agit jamais d'un seul geste, même quand la
  // ligne porte aussi des choix (les sauvegardes d'un jeu).
  it("ouvre une fiche pour une décision, même avec des choix", () => {
    const fiche = {
      consequence: "c",
      agir: "Lancer",
      annuler: "Revenir",
      onAgir: () => {},
    };
    expect(formeDe(ligne({ fiche, picks: [{ id: "a", label: "a" }], onEnter: () => {} }))).toBe(
      "fiche",
    );
  });
});

describe("les groupes", () => {
  it("posent un titre avant la première ligne de chaque groupe", () => {
    const blocs = enGroupes([
      ligne({ id: "a", group: "Image et son" }),
      ligne({ id: "b", group: "Image et son" }),
      ligne({ id: "c", group: "Cet appareil" }),
    ]);
    expect(blocs.map((b) => [b.group, b.lignes.map((l) => l.id)])).toEqual([
      ["Image et son", ["a", "b"]],
      ["Cet appareil", ["c"]],
    ]);
  });

  it("le jumeau : des lignes sans groupe forment un bloc sans titre", () => {
    expect(enGroupes([ligne({ id: "a" }), ligne({ id: "b" })])).toEqual([
      { group: null, lignes: [ligne({ id: "a" }), ligne({ id: "b" })] },
    ]);
  });
});

describe("les aides (M8)", () => {
  const rubrique = (hint: string): Rubrique => ({
    id: "salle",
    label: "Salle",
    lignes: [ligne({ id: "l", hint })],
  });

  it("refusent une aide de 70 caractères", () => {
    expect(aidesTropLongues([rubrique("a".repeat(AIDE_MAX))])).toEqual(["salle/l"]);
  });

  it("le jumeau : acceptent une aide de 69 caractères", () => {
    expect(aidesTropLongues([rubrique("a".repeat(AIDE_MAX - 1))])).toEqual([]);
  });
});

describe("les flèches (M4)", () => {
  it("↑ ↓ passent de ligne en ligne, ← → de rubrique", () => {
    expect(pas("bas", "ligne")).toEqual({ vers: "ligne", sens: 1 });
    expect(pas("haut", "ligne")).toEqual({ vers: "ligne", sens: -1 });
    expect(pas("droite", "ligne")).toEqual({ vers: "rubrique", sens: 1 });
    expect(pas("gauche", "onglet")).toEqual({ vers: "rubrique", sens: -1 });
    expect(pas("bas", "onglet")).toEqual({ vers: "ligne", sens: 1 });
  });

  // Le jumeau : une pastille radio et un curseur gardent ← →. Sans cette
  // règle, ← sur « légère » changeait de rubrique au lieu de choix.
  it("laissent ← → à une pastille et à un curseur, ↑ ↓ passent de ligne", () => {
    for (const sous of ["choix", "glissiere"] as const) {
      expect(pas("gauche", sous)).toBeNull();
      expect(pas("droite", sous)).toBeNull();
      expect(pas("bas", sous)).toEqual({ vers: "ligne", sens: 1 });
      expect(pas("haut", sous)).toEqual({ vers: "ligne", sens: -1 });
    }
  });

  it("ne prennent rien hors des onglets et des lignes, ni ↑ sur un onglet", () => {
    for (const geste of ["haut", "bas", "gauche", "droite"] as const)
      expect(pas(geste, "ailleurs")).toBeNull();
    expect(pas("haut", "onglet")).toBeNull();
  });

  it("ne font pas le tour : après la dernière ligne, ↓ reste sur la dernière", () => {
    expect(voisin(4, 5, 1)).toBe(4);
    expect(voisin(0, 5, -1)).toBe(0);
    expect(voisin(2, 5, 1)).toBe(3);
    expect(voisin(2, 5, -1)).toBe(1);
    expect(voisin(0, 0, 1)).toBe(0);
  });
});

/** Une entrée du cadre. Sa base par défaut est l'image reçue et son
 * réglage, comme après un changement de mise en page (`baseDuPanneau`) ;
 * sans image, aucune. */
const entree = (plus: Partial<Entree>): Entree => {
  const image = plus.image ?? { width: 1216, height: 896 };
  const ajustement = plus.ajustement ?? "remplir";
  return {
    mode: "bureau",
    fenetre: { width: 1440, height: 900 },
    zonesSures: SANS_ZONES,
    image,
    ajustement,
    base: image.width > 0 && image.height > 0 ? { image, ajustement } : null,
    etat: "vit",
    role: "joueur",
    manette: null,
    largeurColonne: 304,
    largeurPanneau: null,
    agrandie: false,
    ...plus,
  };
};

/** Aucun rectangle : une pose sans image n'a rien à couvrir. */
const AUCUN: Rect = { x: 0, y: 0, w: 0, h: 0 };

const coupe = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

describe("la place du menu (M2)", () => {
  it("se pose dans la colonne au bureau et en fenêtre étroite", () => {
    for (const mode of ["bureau", "etroit"] as const) {
      const e = entree({ mode });
      expect(placeDuMenu(miseEnPage(e), e.fenetre, SANS_ZONES)).toEqual({
        lieu: "colonne",
      });
    }
  });

  it("tenu droit, sous l'image jusqu'au bas de l'écran, sans la toucher", () => {
    for (const fenetre of [
      { width: 390, height: 844 },
      { width: 375, height: 667 },
      { width: 320, height: 568 },
    ]) {
      for (const image of [
        { width: 1216, height: 896 },
        { width: 1280, height: 720 },
      ]) {
        const e = entree({
          mode: "portrait",
          fenetre,
          image,
          manette: MANETTES.dolphin,
        });
        const geo = miseEnPage(e);
        const place = placeDuMenu(geo, fenetre, SANS_ZONES);
        if (place.lieu === "colonne") throw new Error("tenu en main, pas de colonne");
        expect(place.cacheImage).toBe(false);
        expect(coupe(place.rect, geo.image!)).toBe(0);
        expect(place.rect.y + place.rect.h).toBe(fenetre.height);
        expect(place.rect.h).toBeGreaterThan(200);
      }
    }
  });

  it("garde les zones sûres d'un téléphone", () => {
    const zones = { haut: 47, droite: 0, bas: 34, gauche: 0 };
    const fenetre = { width: 390, height: 844 };
    const geo = miseEnPage(entree({ mode: "portrait", fenetre, zonesSures: zones }));
    const place = placeDuMenu(geo, fenetre, zones);
    if (place.lieu === "colonne") throw new Error("tenu en main, pas de colonne");
    expect(place.rect.y + place.rect.h).toBe(fenetre.height - zones.bas);
  });

  it("couché, dans la plus large bande à côté de l'image", () => {
    const fenetre = { width: 844, height: 390 };
    for (const manette of [MANETTES.dolphin, null]) {
      const geo = miseEnPage(entree({ mode: "paysage", fenetre, manette }));
      const place = placeDuMenu(geo, fenetre, SANS_ZONES);
      if (place.lieu === "colonne") throw new Error("tenu en main, pas de colonne");
      expect(place.lieu).toBe("cote");
      expect(place.cacheImage).toBe(false);
      expect(place.rect.w).toBeGreaterThanOrEqual(BANDE_MIN);
      expect(coupe(place.rect, geo.image!)).toBe(0);
      expect(geo.boutonSalle).not.toBeNull();
      expect(coupe(place.rect, geo.boutonSalle!)).toBe(0);
    }
  });

  // Le défaut de la relecture du 24 novembre 2026 : un téléphone couché, une
  // image 16:9 et la manette Pro (Switch, Xbox 360) laissent deux bandes de
  // 148 px. Le repli posait le menu sur 380 px à gauche : 42 % de l'image
  // vivante couverts, et « La salle » par-dessus une ligne du menu. Le menu
  // prend maintenant la place de l'écran, et l'image se cache le temps du
  // menu : rien ne passe sur une image qu'on voit.
  it("sans bande lisible, prend l'écran et cache l'image, sans toucher « La salle »", () => {
    const fenetre = { width: 844, height: 390 };
    const geo = miseEnPage(
      entree({
        mode: "paysage",
        fenetre,
        image: { width: 1280, height: 720 },
        manette: MANETTES.pro,
      }),
    );
    const place = placeDuMenu(geo, fenetre, SANS_ZONES);
    if (place.lieu === "colonne") throw new Error("tenu en main, pas de colonne");
    expect(place.lieu).toBe("ecran");
    expect(place.cacheImage).toBe(true);
    expect(place.rect).toEqual(geo.ecran);
    expect(geo.boutonSalle).not.toBeNull();
    expect(coupe(place.rect, geo.boutonSalle!)).toBe(0);
    expect(geo.manette?.grappes).toBeTruthy();
    expect(coupe(place.rect, geo.manette!.grappes!.g)).toBe(0);
    expect(coupe(place.rect, geo.manette!.grappes!.d)).toBe(0);
  });

  // Le jumeau : la même fenêtre et la même manette avec une image 4:3 laissent
  // une bande assez large ; l'image reste visible, et « La salle », posé sous
  // l'image dans cette bande, n'écrase plus le menu à 2 px de haut.
  it("garde l'image visible quand une bande suffit, et passe au-dessus de « La salle »", () => {
    const fenetre = { width: 844, height: 390 };
    const geo = miseEnPage(
      entree({
        mode: "paysage",
        fenetre,
        image: { width: 640, height: 480 },
        manette: MANETTES.pro,
      }),
    );
    const place = placeDuMenu(geo, fenetre, SANS_ZONES);
    if (place.lieu === "colonne") throw new Error("tenu en main, pas de colonne");
    expect(place.lieu).toBe("cote");
    expect(place.cacheImage).toBe(false);
    expect(coupe(place.rect, geo.image!)).toBe(0);
    expect(geo.boutonSalle).not.toBeNull();
    expect(coupe(place.rect, geo.boutonSalle!)).toBe(0);
    expect(place.rect.h).toBeGreaterThanOrEqual(HAUTEUR_MIN);
  });

  // Toutes les poses couchées d'un téléphone et d'une tablette : jamais sur
  // une image visible, jamais sous « La salle » ni sous ton étiquette, dans
  // la zone sûre. Les gardes comptent leurs cas : une boucle qui ne
  // rencontrerait aucun bouton ne prouverait rien.
  it("couché, ne couvre jamais une image visible, ni « La salle », ni ton étiquette", () => {
    const cas = { total: 0, bouton: 0, etiquette: 0, cachee: 0, cote: 0, grappes: 0 };
    for (const [width, height] of [
      [844, 390],
      [780, 360],
      [932, 430],
      [667, 375],
      [736, 414],
      [568, 320],
      [1024, 600],
      [1180, 820],
    ] as const)
      for (const image of [
        { width: 1280, height: 720 },
        { width: 640, height: 480 },
        { width: 1216, height: 896 },
      ])
        for (const manette of [MANETTES.pro, MANETTES.dolphin, null])
          for (const role of ["joueur", "regarde"] as const)
            for (const zones of [SANS_ZONES, { haut: 0, droite: 47, bas: 21, gauche: 47 }]) {
              const fenetre = { width, height };
              const geo = miseEnPage(
                entree({ mode: "paysage", fenetre, zonesSures: zones, image, manette, role }),
              );
              const place = placeDuMenu(geo, fenetre, zones);
              if (place.lieu === "colonne") throw new Error("tenu en main, pas de colonne");
              const ici = `${width}x${height} ${image.width} ${role} ${zones.gauche}`;
              cas.total += 1;
              const r = place.rect;
              expect(r.w, ici).toBeGreaterThan(0);
              expect(r.h, ici).toBeGreaterThan(0);
              expect(r.x, ici).toBeGreaterThanOrEqual(zones.gauche);
              expect(r.y, ici).toBeGreaterThanOrEqual(zones.haut);
              expect(r.x + r.w, ici).toBeLessThanOrEqual(width - zones.droite);
              expect(r.y + r.h, ici).toBeLessThanOrEqual(height - zones.bas);
              expect(place.cacheImage, ici).toBe(place.lieu === "ecran");
              if (place.cacheImage) {
                cas.cachee += 1;
                // Sur l'écran, le menu laisse aussi les deux grappes de la
                // manette à l'écran.
                for (const grappe of Object.values(geo.manette?.grappes ?? {})) {
                  cas.grappes += 1;
                  expect(coupe(r, grappe), `${ici} grappe`).toBe(0);
                }
              } else {
                cas.cote += 1;
                expect(coupe(r, geo.image ?? AUCUN), ici).toBe(0);
              }
              for (const [nom, obstacle] of [
                ["bouton", geo.boutonSalle],
                ["etiquette", geo.etiquette?.lieu === "cote" ? geo.etiquette.rect : null],
              ] as const) {
                if (obstacle === null) continue;
                cas[nom] += 1;
                expect(coupe(r, obstacle), `${ici} ${nom}`).toBe(0);
              }
            }
    expect(cas.bouton).toBeGreaterThan(100);
    expect(cas.etiquette).toBeGreaterThan(0);
    expect(cas.cachee).toBeGreaterThan(20);
    expect(cas.cote).toBeGreaterThan(20);
    expect(cas.grappes).toBeGreaterThan(10);
  });

  // Ton étiquette en tête de la bande, quand le panneau n'a que ses lampes
  // (décision du chef de chantier, 24 novembre 2026) : le cadre donne son
  // rectangle, le menu l'évite. salle-telephone le mesure dans Chrome.
  it("couché, ne couvre jamais ton étiquette posée en tête de la bande", () => {
    let vus = 0;
    for (let width = 480; width <= 1000; width += 4)
      for (let height = 300; height <= Math.min(width - 1, 480); height += 4)
        for (const image of [
          { width: 640, height: 480 },
          { width: 1280, height: 720 },
        ])
          for (const manette of [MANETTES.pro, MANETTES.dolphin]) {
            const fenetre = { width, height };
            const geo = miseEnPage(entree({ mode: "paysage", fenetre, image, manette }));
            if (geo.etiquette?.lieu !== "bande" || !geo.bande || !geo.ecran?.w) continue;
            vus += 1;
            const ici = `${width}x${height} ${image.width}`;
            // Calcul indépendant : les bords intérieurs de la bande
            // (`.n3-bande`, 8 px en haut, 12 de côté), la hauteur et la
            // largeur la plus grande de la fente.
            expect(geo.etiquette.rect, ici).toEqual({
              x: geo.bande.x + 12,
              y: geo.bande.y + 8,
              w: Math.max(0, Math.min(geo.bande.w - 24, FENTE.MAX)),
              h: FENTE.HAUT,
            });
            const place = placeDuMenu(geo, fenetre, SANS_ZONES);
            if (place.lieu === "colonne") throw new Error("tenu en main, pas de colonne");
            expect(coupe(place.rect, geo.etiquette.rect), ici).toBe(0);
          }
    // Le balayage rencontre l'étiquette dans la bande (GameCube à 568×320,
    // 640×360, 667×375 ; manette Pro à 640×360 en 16:9).
    expect(vus).toBeGreaterThan(100);
  });

  it("le jumeau : une étiquette de bande posée dans la bande gauche y est évitée", () => {
    // La géométrie d'aujourd'hui ne met jamais la bande sous la bande gauche
    // du menu : l'image la couvre en largeur. Ce cas construit le prouve
    // quand même, pour qu'un menu qui oublierait l'étiquette rougisse.
    const fenetre = { width: 667, height: 375 };
    const geo = miseEnPage(
      entree({
        mode: "paysage",
        fenetre,
        image: { width: 640, height: 480 },
        manette: MANETTES.dolphin,
      }),
    );
    if (geo.etiquette?.lieu !== "bande") throw new Error("pas d'étiquette dans la bande à 667×375");
    const avant = placeDuMenu(geo, fenetre, SANS_ZONES);
    if (avant.lieu !== "cote") throw new Error("le menu n'est pas dans une bande à 667×375");
    const surLeMenu = { x: avant.rect.x + 8, y: 180, w: 120, h: FENTE.HAUT };
    const apres = placeDuMenu(
      { ...geo, etiquette: { lieu: "bande", rect: surLeMenu } },
      fenetre,
      SANS_ZONES,
    );
    if (apres.lieu === "colonne") throw new Error("tenu en main, pas de colonne");
    expect(coupe(avant.rect, surLeMenu)).toBeGreaterThan(0);
    expect(coupe(apres.rect, surLeMenu)).toBe(0);
  });
});
