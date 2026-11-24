/**
 * Les rubriques du menu construites hors d'App.tsx (M8, M9) : leurs aides,
 * pour chaque console, et leurs gestes.
 */
import { describe, expect, it, vi } from "vitest";
import { moteurDe } from "./consoles";
import { aidesTropLongues, type Ligne } from "./menu";
import { MENU } from "./mots";
import { lignesManettes, type EntreeManettes } from "./rubriques";

const CONSOLES = ["gc", "wii", "switch", "switch2", "x360", "inconnue", undefined] as const;

function manettes(plus: Partial<EntreeManettes> = {}) {
  const e: EntreeManettes = {
    aConfigurer: false,
    profilClavier: "défaut",
    console: "gc",
    moteur: moteurDe("gc"),
    pad: 0,
    touchPref: "auto",
    padOnly: false,
    ouvrirTouches: vi.fn(),
    switchPad: vi.fn(),
    setTouchPref: vi.fn(),
    onPadOnly: vi.fn(),
    ...plus,
  };
  return { e, lignes: lignesManettes(e) };
}

const ligne = (lignes: Ligne[], id: string): Ligne => {
  const trouvee = lignes.find((l) => l.id === id);
  // La précondition : sans la ligne, les attentes d'en dessous ne
  // vérifieraient rien.
  if (!trouvee) throw new Error(`pas de ligne ${id}`);
  return trouvee;
};

describe("la rubrique Manettes (M9)", () => {
  it("porte ses cinq lignes, dans l'ordre, les touches en tête", () => {
    const { lignes } = manettes();
    expect(lignes.map((l) => l.id)).toEqual([
      "bindings",
      "touches-clavier",
      "pad",
      "touchpad",
      "padonly",
    ]);
    expect(lignes.slice(0, 2).map((l) => l.group)).toEqual([
      MENU.groupes.manette,
      MENU.groupes.manette,
    ]);
  });

  it("ouvre le réglage des manettes sur l'onglet de chaque ligne, sans le copier", () => {
    const { e, lignes } = manettes();
    ligne(lignes, "touches-clavier").onEnter?.();
    expect(e.ouvrirTouches).toHaveBeenLastCalledWith("clavier");
    ligne(lignes, "bindings").onEnter?.();
    expect(e.ouvrirTouches).toHaveBeenLastCalledWith("manette");
  });

  it("choisit l'appareil Wii relu dans la table, et rien pour un code inconnu", () => {
    const { e, lignes } = manettes();
    ligne(lignes, "pad").onPick?.("3");
    expect(e.switchPad).toHaveBeenCalledWith(3);
    ligne(lignes, "pad").onPick?.("9");
    expect(e.switchPad).toHaveBeenCalledTimes(1);
    // Le même garde pour les commandes tactiles.
    ligne(lignes, "touchpad").onPick?.("on");
    ligne(lignes, "touchpad").onPick?.("parfois");
    expect(vi.mocked(e.setTouchPref).mock.calls).toEqual([["on"]]);
  });

  it("garde chaque aide sous 70 caractères, pour chaque console (M8)", () => {
    for (const console of CONSOLES)
      for (const aConfigurer of [false, true])
        for (const pad of [0, 1] as const) {
          const { lignes } = manettes({ console, moteur: moteurDe(console), aConfigurer, pad });
          expect(
            aidesTropLongues([{ id: "manettes", label: "", lignes }]),
            `${console} ${aConfigurer} ${pad}`,
          ).toEqual([]);
        }
  });

  it("le jumeau : l'aide d'avant de la manette seule ne tenait pas", () => {
    // « Ce téléphone sans image ni son : mesuré à 13,6 Mbit/s par appareil,
    // c'est autant de wifi et de batterie rendus. » : 107 caractères.
    const avant: Ligne = {
      id: "padonly",
      label: "manette seule",
      hint: "Ce téléphone sans image ni son : mesuré à 13,6 Mbit/s par appareil, c'est autant de wifi et de batterie rendus.",
    };
    expect(aidesTropLongues([{ id: "manettes", label: "", lignes: [avant] }])).toEqual([
      "manettes/padonly",
    ]);
  });

  it("ne dit le chiffre mesuré que dans une salle GameCube et Wii", () => {
    expect(ligne(manettes().lignes, "padonly").hint).toContain("13,6 Mbit/s");
    for (const console of ["switch", "x360", undefined] as const)
      expect(
        ligne(manettes({ console, moteur: moteurDe(console) }).lignes, "padonly").hint,
      ).not.toMatch(/[0-9]/);
  });
});
