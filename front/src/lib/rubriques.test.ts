/**
 * Les rubriques du menu construites hors d'App.tsx (M8, M9) : leurs aides,
 * pour chaque console, et leurs gestes.
 */
import { describe, expect, it, vi } from "vitest";
import { aidesTropLongues, type Ligne } from "./menu";
import { MENU } from "./mots";
import {
  lignesManettes,
  lignesSalle,
  qui,
  type EntreeManettes,
  type EntreeSalle,
} from "./rubriques";

const CONSOLES = ["gc", "wii", "switch", "switch2", "x360", "inconnue", undefined] as const;

function manettes(plus: Partial<EntreeManettes> = {}) {
  const e: EntreeManettes = {
    aConfigurer: false,
    profilClavier: "défaut",
    console: "gc",
    pad: 0,
    touchPref: "auto",
    ouvrirTouches: vi.fn(),
    switchPad: vi.fn(),
    setTouchPref: vi.fn(),
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
  it("porte ses quatre lignes, dans l'ordre, les touches en tête, sans « manette seule »", () => {
    const { lignes } = manettes();
    expect(lignes.map((l) => l.id)).toEqual(["bindings", "touches-clavier", "pad", "touchpad"]);
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
          const { lignes } = manettes({ console, aConfigurer, pad });
          expect(
            aidesTropLongues([{ id: "manettes", label: "", lignes }]),
            `${console} ${aConfigurer} ${pad}`,
          ).toEqual([]);
        }
  });

  it("le jumeau : une aide de 107 caractères ne tient pas", () => {
    // L'aide d'avant de « manette seule » (retirée le 27 novembre 2026), qui
    // a montré que la borne sait refuser.
    const avant: Ligne = {
      id: "exemple",
      label: "exemple",
      hint: "Ce téléphone sans image ni son : mesuré à 13,6 Mbit/s par appareil, c'est autant de wifi et de batterie rendus.",
    };
    expect(aidesTropLongues([{ id: "manettes", label: "", lignes: [avant] }])).toEqual([
      "manettes/exemple",
    ]);
  });
});

describe("la rubrique Salle (M10, K25)", () => {
  const base = (plus: Partial<EntreeSalle> = {}): EntreeSalle => ({
    chef: { nom: "Nour", place: 1, moi: false },
    reprise: false,
    jeu: { index: 3 },
    peutFermer: false,
    fermeture: null,
    tenues: 4,
    sousUnSalon: true,
    nomSalle: "salle 1",
    tenu: false,
    aideSalle: "Places, qui regarde, signaler, quitter.",
    regarde: false,
    signaler: null,
    reprendre: vi.fn(),
    fermerJeu: vi.fn(),
    fermerSalle: vi.fn(),
    ouvrirSalle: vi.fn(),
    basculerPlace: vi.fn(),
    quitter: vi.fn(),
    ...plus,
  });
  const ids = (lignes: Ligne[]) => lignes.map((l) => l.id);

  it("qui choisit le jeu ferme le jeu par une fiche qui dit la conséquence", () => {
    const e = base({ peutFermer: true, chef: { nom: "Nour", place: 1, moi: true } });
    const lignes = lignesSalle(e);
    const fermer = lignes.find((l) => l.id === "close-game");
    expect(fermer?.fiche?.consequence).toBe(
      "La partie s'arrête pour les 4 joueurs. La salle reste ouverte.",
    );
    // Le jumeau : la ligne seule n'agit pas, seule la fiche agit.
    fermer?.onEnter?.();
    expect(e.fermerJeu).not.toHaveBeenCalled();
    fermer?.fiche?.onAgir(null);
    expect(e.fermerJeu).toHaveBeenCalledOnce();
    expect(e.fermerJeu).toHaveBeenCalledWith(3);
    expect(ids(lignes)).toContain("close-room");
  });

  it("à qui ne choisit pas le jeu, ni Fermer le jeu ni Fermer la salle", () => {
    expect(ids(lignesSalle(base()))).not.toContain("close-game");
    expect(ids(lignesSalle(base()))).not.toContain("close-room");
    // Sans salon, pas de salle à fermer, même pour qui choisit.
    expect(ids(lignesSalle(base({ peutFermer: true, sousUnSalon: false })))).toEqual([
      "close-game",
      "watch",
      "leave",
    ]);
  });

  it("Signaler est une ligne quand le menu remplace la colonne, et seulement là", () => {
    const signaler = "le bouton Signaler";
    const lignes = lignesSalle(base({ signaler }));
    expect(lignes[0]).toMatchObject({ id: "signaler", element: signaler });
    expect(ids(lignesSalle(base()))).not.toContain("signaler");
  });

  it("une fermeture demandée est l'état de la ligne et de sa fiche", () => {
    const lignes = lignesSalle(base({ peutFermer: true, fermeture: 3 }));
    const fermer = lignes.find((l) => l.id === "close-game");
    expect(fermer?.value).toBe("fermeture…");
    expect(fermer?.fiche?.occupe).toBe(true);
  });

  it("aucune aide ne dépasse 70 caractères, pour chaque rôle", () => {
    for (const plus of [
      {},
      { peutFermer: true },
      { reprise: true },
      { tenu: true },
      { regarde: true },
      { sousUnSalon: false },
    ])
      expect(
        aidesTropLongues([{ id: "salle", label: "", lignes: lignesSalle(base(plus)) }]),
      ).toEqual([]);
  });
});

describe("la tête de la rubrique Salle (M10)", () => {
  it("dit qui choisit le jeu, avec la place de son étiquette", () => {
    expect(qui({ nom: "Nour", place: 2, moi: false })).toEqual({
      nom: "Nour",
      place: 2,
      texte: "choisit le jeu.",
    });
    expect(qui({ nom: "Nour", place: null, moi: true })).toEqual({
      nom: null,
      place: null,
      texte: "Tu choisis le jeu.",
    });
    expect(qui(null)).toBeNull();
  });
});
