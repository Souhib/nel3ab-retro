import { describe, expect, it } from "vitest";
import { aideDolphin, aidePro, type Ligne } from "./aide-clavier";
import { activiteDolphin, activitePro } from "../media/activite";
import { BUTTON, DEFAULT_KEYS, standardProfile, type PadReading } from "../media/pad";
import { defaultSwitchProfile, emptySwitch } from "../media/switch";
import {
  allumees,
  ECHO_FRAIS_MS,
  RIEN,
  suivie,
  toutesVues,
  verificationDolphin,
  verificationPro,
  type Garde,
  type ManetteLue,
} from "./verification";

const XBOX: ManetteLue = {
  id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)",
  mapping: "standard",
  boutons: 17,
  axes: 4,
};
const GC = { console: "gc", pad: 0 as const };
const ligne = (lignes: Ligne[], touches: RegExp) => {
  const trouvee = lignes.find((l) => touches.test(l.touches));
  if (!trouvee)
    throw new Error(`aucune ligne ${touches}: ${lignes.map((l) => l.touches).join(", ")}`);
  return trouvee;
};

describe("la vue de la manette, salle Dolphin", () => {
  const lignes = verificationDolphin(XBOX, null, GC);

  it("liste les quinze commandes d'une manette standard", () => {
    expect(lignes).toHaveLength(15);
  });

  it("RB presse Z, et A presse A", () => {
    expect(ligne(lignes, /^RB/).fait).toBe("Z");
    expect(ligne(lignes, /^RB/).commandes).toEqual(["Z"]);
    expect(ligne(lignes, /^A /).fait).toBe("A");
  });

  it("Back et les clics de stick ne pressent rien, et le disent", () => {
    expect(ligne(lignes, /^View/).fait).toBe(RIEN);
    expect(ligne(lignes, /^LS/).fait).toBe(RIEN);
    expect(ligne(lignes, /^RS/).commandes).toEqual([]);
  });

  it("les sticks et la croix pressent les commandes de la GameCube", () => {
    expect(ligne(lignes, /^stick gauche/).fait).toBe("stick");
    expect(ligne(lignes, /^stick droit/).fait).toBe("stick C");
    expect(ligne(lignes, /^croix/).commandes).toEqual(["D_UP", "D_DOWN", "D_LEFT", "D_RIGHT"]);
  });

  it("suit le profil de la place au lieu d'une table : RB appris comme A presse A", () => {
    const profil = standardProfile(XBOX.id);
    profil.buttons.A = { button: 5 };
    profil.buttons.Z = { button: 0 };
    const lues = verificationDolphin(XBOX, profil, GC);
    expect(ligne(lues, /^RB/).fait).toBe("A");
    // Le jumeau : sans profil, la même manette garde Z sur RB.
    expect(ligne(lignes, /^RB/).fait).not.toBe("A");
  });

  it("nomme comme la Wiimote dans une salle Wii", () => {
    const wii = verificationDolphin(XBOX, null, { console: "wii", pad: 1 });
    expect(ligne(wii, /^Menu/).fait).toBe("bouton +");
    expect(ligne(lignes, /^Menu/).fait).toBe("Start");
  });
});

describe("la vue de la manette, salle Switch ou Xbox 360", () => {
  const profil = defaultSwitchProfile();

  it("l'indice 0 presse A et l'indice 2 presse X", () => {
    const lignes = verificationPro(XBOX, profil, false);
    expect(lignes).toHaveLength(15);
    expect(ligne(lignes, /^A /).commandes).toEqual(["A"]);
    expect(ligne(lignes, /^X /).commandes).toEqual(["X"]);
  });

  it("l'indice 2 ne presse jamais Y (incident du 11 septembre 2026)", () => {
    for (const xbox of [false, true]) {
      const lignes = verificationPro(XBOX, profil, xbox);
      expect(ligne(lignes, /^X /).commandes).not.toContain("Y");
    }
  });

  it("nomme pour une salle Xbox 360 : Start et LB", () => {
    const lignes = verificationPro(XBOX, profil, true);
    expect(ligne(lignes, /^Menu/).fait).toBe("Start");
    expect(ligne(lignes, /^LB/).fait).toBe("LB");
    expect(ligne(verificationPro(XBOX, profil, false), /^Menu/).fait).toBe("bouton +");
  });

  it("suit l'appareil réglé dans le profil, pas une table recopiée", () => {
    const regle = defaultSwitchProfile();
    regle.devices[XBOX.id] = {
      standard: false,
      buttons: { Y: { button: 2 }, X: { button: 3 } },
      sticks: {},
    };
    const lignes = verificationPro(XBOX, regle, true);
    expect(ligne(lignes, /^X /).commandes).toEqual(["Y"]);
    expect(ligne(lignes, /^stick gauche/).fait).toBe(RIEN);
  });

  it("dit les sticks et la croix par leur nom", () => {
    const lignes = verificationPro(XBOX, profil, false);
    expect(ligne(lignes, /^stick gauche/).fait).toBe("stick gauche");
    expect(ligne(lignes, /^stick droit/).fait).toBe("stick droit");
    expect(ligne(lignes, /^croix/).fait).toBe("croix");
    expect(ligne(lignes, /^LS/).fait).toBe("Clic du stick gauche");
  });
});

describe("une manette à la disposition inconnue", () => {
  it("dit chaque bouton par son numéro, sans inventer de nom", () => {
    const inconnue = { id: "Adaptateur", mapping: "", boutons: 6, axes: 2 };
    const lignes = verificationDolphin(inconnue, null, GC);
    expect(lignes.map((l) => l.touches)).toEqual([
      "bouton 0",
      "bouton 1",
      "bouton 2",
      "bouton 3",
      "bouton 4",
      "bouton 5",
      "axe 0",
      "axe 1",
    ]);
  });
});

/** La trame Dolphin telle que l'instantané la dit (`media/activite`), avec
 * ces boutons pressés : la lecture du produit, pas une liste recopiée. */
const REPOS: PadReading = { buttons: 0, x: 0, y: 0, cx: 0, cy: 0, l: 0, r: 0 };
const dolphin = (boutons: (keyof typeof BUTTON)[], axes: Partial<PadReading> = {}) =>
  activiteDolphin({
    ...REPOS,
    ...axes,
    buttons: boutons.reduce((tous, nom) => tous | BUTTON[nom], 0),
  });
/** Une activité qui ne suit rien : une trame que l'instantané ne dirait pas. */
const RIEN_SUIVI = { suivies: new Set<string>(), actives: new Set<string>() };

describe("quand une ligne s'allume", () => {
  const nom = (code: string) => code;
  const clavier = aideDolphin(DEFAULT_KEYS, nom, GC);
  const garde: Garde = { focusAuJeu: true, clavier: true, sinceHeardMs: 300 };
  const indexDe = (fait: string) => clavier.findIndex((l) => l.fait === fait);

  it("A pressé dans la trame allume la ligne A, et elle seule", () => {
    const lu = allumees(clavier, dolphin(["A"]), garde);
    expect(lu[indexDe("A")]).toBe(true);
    expect(lu.filter(Boolean)).toHaveLength(1);
  });

  it("hors de la zone de jeu, rien ne s'allume au clavier", () => {
    const lu = allumees(clavier, dolphin(["A"]), { ...garde, focusAuJeu: false });
    expect(lu.some(Boolean)).toBe(false);
    // Le jumeau : une manette n'a pas besoin du focus pour jouer.
    const manette = allumees(clavier, dolphin(["A"]), {
      ...garde,
      clavier: false,
      focusAuJeu: false,
    });
    expect(manette[indexDe("A")]).toBe(true);
  });

  it("un écho de plus de deux secondes, ou aucun, n'allume rien", () => {
    const a = dolphin(["A"]);
    expect(allumees(clavier, a, { ...garde, sinceHeardMs: ECHO_FRAIS_MS })[indexDe("A")]).toBe(
      false,
    );
    expect(allumees(clavier, a, { ...garde, sinceHeardMs: null })[indexDe("A")]).toBe(false);
    expect(allumees(clavier, a, { ...garde, sinceHeardMs: ECHO_FRAIS_MS - 1 })[indexDe("A")]).toBe(
      true,
    );
  });

  it("la croix s'allume par n'importe laquelle de ses quatre directions", () => {
    const avecCroix = aideDolphin(
      {
        ...DEFAULT_KEYS,
        KeyT: { kind: "button", name: "D_UP" },
        KeyF: { kind: "button", name: "D_LEFT" },
        KeyG: { kind: "button", name: "D_DOWN" },
        KeyH: { kind: "button", name: "D_RIGHT" },
      },
      nom,
      GC,
    );
    const croix = avecCroix.findIndex((l) => l.commandes.includes("D_UP"));
    expect(croix).toBeGreaterThanOrEqual(0);
    expect(allumees(avecCroix, dolphin(["D_LEFT"]), garde)[croix]).toBe(true);
    expect(allumees(avecCroix, dolphin(["A"]), garde)[croix]).toBe(false);
  });

  // Jusqu'au 24 novembre 2026, la vue lisait `pressed`, sans les sticks :
  // la ligne des flèches n'avait pas de case. L'instantané dit maintenant
  // chaque axe hors du repos (K34).
  it("la ligne des flèches a sa case, et s'allume quand le stick quitte le repos", () => {
    const stickIndex = clavier.findIndex((l) => l.commandes.includes("x"));
    expect(stickIndex).toBeGreaterThanOrEqual(0);
    expect(suivie(clavier[stickIndex]!, dolphin([]))).toBe(true);
    expect(allumees(clavier, dolphin([], { y: -32767 }), garde)[stickIndex]).toBe(true);
    // Le jumeau : un stick au repos, ou le second stick, ne l'allume pas.
    expect(allumees(clavier, dolphin([]), garde)[stickIndex]).toBe(false);
    expect(allumees(clavier, dolphin([], { cx: 32767 }), garde)[stickIndex]).toBe(false);
  });

  it("une activité qui ne suit pas une commande ne donne pas de case à sa ligne", () => {
    expect(suivie(clavier[indexDe("A")]!, RIEN_SUIVI)).toBe(false);
    // Une activité qui dirait le stick sans le suivre ne l'allume pas.
    const melee = { suivies: new Set(["A"]), actives: new Set(["A", "x"]) };
    const stickIndex = clavier.findIndex((l) => l.commandes.includes("x"));
    expect(allumees(clavier, melee, garde)[stickIndex]).toBe(false);
  });

  it("dans une salle Pro, chaque ligne a sa case, et le stick gauche s'allume par son sens", () => {
    const pro = aidePro(defaultSwitchProfile().keys, true, nom);
    expect(pro.length).toBeGreaterThan(0);
    expect(pro.every((l) => suivie(l, activitePro(null)))).toBe(true);
    const gauche = pro.findIndex((l) => l.commandes.includes("lx+"));
    expect(gauche).toBeGreaterThanOrEqual(0);
    const pousse = activitePro({ ...emptySwitch(), lx: 20000 });
    const lu = allumees(pro, pousse, garde);
    expect(lu[gauche]).toBe(true);
    expect(lu.filter(Boolean)).toHaveLength(1);
    // Le jumeau : au repos, rien.
    expect(allumees(pro, activitePro(emptySwitch()), garde).some(Boolean)).toBe(false);
  });

  it("fier attend chaque ligne suivie et vue, et jamais une ligne sans case", () => {
    const deux: Ligne[] = [
      { touches: "X", fait: "A", commandes: ["A"] },
      { touches: "C", fait: "B", commandes: ["B"] },
    ];
    const a = dolphin([]);
    expect(toutesVues(deux, new Set([0, 1]), a)).toBe(true);
    expect(toutesVues(deux, new Set([0]), a)).toBe(false);
    // Toutes les lignes du clavier sont suivies depuis K34 : fier est à portée.
    expect(toutesVues(clavier, new Set(clavier.keys()), a)).toBe(true);
    // Le jumeau : une seule commande non suivie, et fier n'arrive jamais.
    const sansY = {
      suivies: new Set([...a.suivies].filter((c) => c !== "y")),
      actives: new Set<string>(),
    };
    expect(toutesVues(clavier, new Set(clavier.keys()), sansY)).toBe(false);
    expect(toutesVues([], new Set(), a)).toBe(false);
  });
});
