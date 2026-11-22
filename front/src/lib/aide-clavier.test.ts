/**
 * La carte des touches lit le profil qui joue (audit T02).
 *
 * Le piège à éviter: une liste écrite à la main, juste le premier jour. Chaque
 * essai qui lit une touche par défaut a donc un jumeau qui la change et exige
 * que la carte suive.
 */
import { describe, expect, it } from "vitest";

import { keyLabel } from "../media/describe";
import { DEFAULT_KEYS, type KeyProfile } from "../media/pad";
import { defaultSwitchProfile } from "../media/switch";
import { aideDejaVue, aideDolphin, aidePro, retenirAideVue } from "./aide-clavier";

const nom = (code: string) => keyLabel(code, null);
const fait = (lignes: { touches: string; fait: string }[], quoi: string) =>
  lignes.find((ligne) => ligne.fait === quoi)?.touches;

describe("la carte d'une salle GameCube ou Wii", () => {
  it("dit les touches par défaut: flèches pour le stick, Entrée pour Start", () => {
    const lignes = aideDolphin(DEFAULT_KEYS, nom);
    expect(fait(lignes, "stick")).toBe("Flèches");
    expect(fait(lignes, "Start")).toBe("Entrée");
    expect(fait(lignes, "A")).toBe("X");
    expect(fait(lignes, "Z")).toBe("A");
    expect(fait(lignes, "L")).toBe("Q");
    // Toutes les commandes de la GameCube restent dites: le plan dessiné qui
    // décide de la présence a une pièce pour chacune.
    expect(fait(lignes, "R")).toBe("E");
    expect(fait(lignes, "B")).toBe("C");
    expect(fait(lignes, "Y")).toBe("D");
    expect(
      fait(
        aideDolphin(
          {
            ...DEFAULT_KEYS,
            KeyI: { kind: "button", name: "D_UP" },
            KeyL: { kind: "stick", stick: "cx", sign: 1 },
          },
          nom,
        ),
        "croix",
      ),
    ).toBe("I");
    expect(lignes[0]?.fait).toBe("stick");
    expect(lignes[1]?.fait).toBe("Start");
  });

  it("suit un profil changé, et ne montre pas une commande sans touche", () => {
    const keys: KeyProfile = { ...DEFAULT_KEYS, Space: { kind: "button", name: "START" } };
    delete keys.Enter;
    delete keys.KeyD;
    keys.KeyW = { kind: "stick", stick: "y", sign: 1 };
    delete keys.ArrowUp;
    const lignes = aideDolphin(keys, nom);
    expect(fait(lignes, "Start")).toBe("Espace");
    expect(fait(lignes, "Y")).toBeUndefined();
    // Trois flèches et un W ne sont plus « les flèches ».
    expect(fait(lignes, "stick")).toBe("W ← ↓ →");
  });

  it("montre deux touches pour une même commande", () => {
    const keys: KeyProfile = { ...DEFAULT_KEYS, KeyJ: { kind: "button", name: "A" } };
    expect(fait(aideDolphin(keys, nom), "A")).toBe("X ou J");
  });

  it("nomme les touches comme le clavier de la personne", () => {
    // Sur un azerty, la touche `KeyQ` est imprimée A.
    const azerty = new Map([["KeyQ", "a"]]);
    expect(
      fait(
        aideDolphin(DEFAULT_KEYS, (code) => keyLabel(code, azerty)),
        "L",
      ),
    ).toBe("A");
  });
});

/**
 * Une salle Wii: la même trame, trois lectures (docs/ecran-manettes.md).
 *
 * Le défaut de la relecture du 22 novembre 2026: la carte disait « Entrée →
 * Start » et « S → X » à qui tenait une Wiimote, où la même trame se lit +, 1
 * et 2. Chaque lecture a donc son essai, et son jumeau GameCube dans la même
 * salle: une manette GameCube reste une manette GameCube sur un jeu Wii.
 */
describe("la carte d'une salle Wii lit l'appareil de la place", () => {
  it("à la Wiimote et au Nunchuk: Entrée vaut +, S vaut 1", () => {
    const lignes = aideDolphin(DEFAULT_KEYS, nom, { console: "wii", pad: 1 });
    expect(fait(lignes, "bouton +")).toBe("Entrée");
    expect(fait(lignes, "1")).toBe("S");
    expect(fait(lignes, "2")).toBe("D");
    expect(fait(lignes, "secouer")).toBe("A");
    expect(fait(lignes, "C")).toBe("Q");
    expect(fait(lignes, "Z")).toBe("E");
    expect(fait(lignes, "stick")).toBe("Flèches");
    // Les noms de la GameCube n'y sont plus.
    expect(fait(lignes, "Start")).toBeUndefined();
    expect(fait(lignes, "X")).toBeUndefined();
    expect(fait(lignes, "L")).toBeUndefined();
  });

  it("le jumeau: une manette GameCube dans la même salle garde Start et X", () => {
    const lignes = aideDolphin(DEFAULT_KEYS, nom, { console: "wii", pad: 0 });
    expect(fait(lignes, "Start")).toBe("Entrée");
    expect(fait(lignes, "X")).toBe("S");
    expect(fait(lignes, "bouton +")).toBeUndefined();
  });

  it("une salle GameCube ignore l'appareil retenu pour la Wii", () => {
    const lignes = aideDolphin(DEFAULT_KEYS, nom, { console: "gc", pad: 1 });
    expect(fait(lignes, "Start")).toBe("Entrée");
    expect(fait(lignes, "1")).toBeUndefined();
  });

  it("la Wiimote seule s'incline, et n'a ni C ni Z du Nunchuk", () => {
    const lignes = aideDolphin(DEFAULT_KEYS, nom, { console: "wii", pad: 3 });
    expect(fait(lignes, "incliner")).toBe("Flèches");
    expect(fait(lignes, "bouton +")).toBe("Entrée");
    expect(fait(lignes, "secouer")).toBe("A");
    // Q et E tiennent C et Z du Nunchuk, absent: aucune ligne ne les nomme.
    const touches = lignes.flatMap((ligne) => ligne.touches.split(/ ou | /));
    expect(touches).not.toContain("Q");
    expect(touches).not.toContain("E");
    // Le jumeau: les mêmes touches sont bien lues avec le Nunchuk.
    const nunchuk = aideDolphin(DEFAULT_KEYS, nom, { console: "wii", pad: 1 });
    expect(nunchuk.flatMap((ligne) => ligne.touches.split(/ ou | /))).toContain("Q");
    expect(lignes.some((ligne) => /extension/.test(ligne.fait))).toBe(false);
  });

  it("la guitare: les frettes, + et −, et rien de ce qu'elle n'a pas", () => {
    const keys: KeyProfile = {
      ...DEFAULT_KEYS,
      KeyI: { kind: "button", name: "D_UP" },
      KeyK: { kind: "button", name: "D_DOWN" },
      KeyJ: { kind: "button", name: "D_LEFT" },
      KeyL: { kind: "stick", stick: "cx", sign: 1 },
      KeyO: { kind: "stick", stick: "cx", sign: -1 },
      KeyP: { kind: "stick", stick: "cy", sign: 1 },
    };
    const lignes = aideDolphin(keys, nom, { console: "wii", pad: 2 });
    expect(fait(lignes, "verte")).toBe("X");
    expect(fait(lignes, "rouge")).toBe("C");
    expect(fait(lignes, "jaune")).toBe("S");
    expect(fait(lignes, "bleue")).toBe("D");
    expect(fait(lignes, "orange")).toBe("A");
    expect(fait(lignes, "bouton +")).toBe("Entrée");
    expect(fait(lignes, "bouton −")).toBe("Q");
    // Le grattage: la croix haut et bas, pas sa gauche (`guitar_binds`).
    expect(fait(lignes, "gratter")).toBe("I K");
    // Le vibrato: le stick C poussé à droite, et rien d'autre.
    expect(fait(lignes, "vibrato")).toBe("L");
    // Ni deuxième gâchette, ni croix gauche, ni stick C vertical.
    for (const absente of ["E", "J", "O", "P"])
      expect(
        lignes.some((ligne) => ligne.touches.split(/ ou | /).includes(absente)),
        absente,
      ).toBe(false);
  });
});

describe("la carte d'une salle Switch ou Xbox 360", () => {
  it("parle Switch dans une salle Switch", () => {
    const lignes = aidePro(defaultSwitchProfile().keys, false, nom);
    expect(fait(lignes, "stick gauche")).toBe("Flèches");
    expect(fait(lignes, "bouton +")).toBe("Entrée");
    expect(fait(lignes, "ZL")).toBe("Q");
    expect(fait(lignes, "LT")).toBeUndefined();
  });

  it("parle Xbox dans une salle Xbox 360", () => {
    const lignes = aidePro(defaultSwitchProfile().keys, true, nom);
    expect(fait(lignes, "Start")).toBe("Entrée");
    expect(fait(lignes, "LT")).toBe("Q");
    expect(fait(lignes, "bouton +")).toBeUndefined();
  });

  it("suit un profil changé", () => {
    const keys = { ...defaultSwitchProfile().keys, PLUS: "KeyP" };
    expect(fait(aidePro(keys, false, nom), "bouton +")).toBe("P");
  });
});

describe("se souvenir de la carte", () => {
  it("lue et repliée, elle reste repliée; rouverte, elle se remontre", () => {
    const boite = new Map<string, string>();
    const stockage = {
      getItem: (cle: string) => boite.get(cle) ?? null,
      setItem: (cle: string, valeur: string) => void boite.set(cle, valeur),
    };
    expect(aideDejaVue(stockage)).toBe(false);
    retenirAideVue(true, stockage);
    expect(aideDejaVue(stockage)).toBe(true);
    retenirAideVue(false, stockage);
    expect(aideDejaVue(stockage)).toBe(false);
  });

  it("survit à un stockage qui lève", () => {
    const casse = {
      getItem: () => {
        throw new Error("bloqué");
      },
      setItem: () => {
        throw new Error("bloqué");
      },
    };
    expect(aideDejaVue(casse)).toBe(false);
    expect(() => retenirAideVue(true, casse)).not.toThrow();
  });
});
