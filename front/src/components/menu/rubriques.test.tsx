/**
 * Les rubriques Jeux et Réglages et la fiche d'un jeu, sorties d'`App.tsx`
 * (chantier menus, relecture du 24 novembre 2026). Les essais du câblage
 * restent dans les pilotes (parcours.mjs lancer-seul, save-options.mjs) ;
 * ceux-ci tiennent les règles que le déplacement aurait pu perdre. Chaque
 * règle a son jumeau.
 */
import { describe, expect, it, vi } from "vitest";
import type { Game } from "../../client";
import { BIBLIO } from "../../lib/mots";
import { ficheDuJeu, lignesJeux, type EntreeJeux } from "./RubriqueJeux";
import { lignesReglages, type EntreeReglages } from "./RubriqueReglages";

const ZELDA: Game = { index: 0, key: "z.iso", name: "Zelda", console: "gc" };
/** Un disque dont la console n'est pas décrite (ADR D22). */
const INCONNU: Game = { index: 1, key: "x.iso", name: "Inconnu", console: "?" };

const entree = (plus: Partial<EntreeJeux> = {}): EntreeJeux => ({
  enCours: null,
  port: 1,
  tenues: 1,
  login: null,
  unlockedSaves: [false, false],
  checkingIdentity: false,
  mine: true,
  chef: "Bo",
  whyNotChoose: null,
  lancerJeu: vi.fn(),
  ...plus,
});

describe("la fiche d'un jeu", () => {
  it("lance sur la sauvegarde choisie, et rien sur un identifiant inconnu", () => {
    const lancerJeu = vi.fn();
    const fiche = ficheDuJeu(ZELDA, entree({ lancerJeu }));
    expect(fiche.refus).toBeUndefined();
    expect(fiche.occupe).toBe(false);
    fiche.onAgir("0");
    expect(lancerJeu).toHaveBeenCalledWith(ZELDA, 0);
    fiche.onAgir("inconnu");
    expect(lancerJeu).toHaveBeenCalledTimes(1);
  });

  it("le jumeau : grisée tant que /saves n'a pas répondu, sans rien lancer", () => {
    const lancerJeu = vi.fn();
    const fiche = ficheDuJeu(ZELDA, entree({ unlockedSaves: null, lancerJeu }));
    expect(fiche.occupe).toBe(true);
    fiche.onAgir("0");
    expect(lancerJeu).not.toHaveBeenCalled();
  });

  it("pour qui ne choisit pas, dit qui choisit à la place du bouton (B8)", () => {
    const fiche = ficheDuJeu(ZELDA, entree({ mine: false }));
    expect(fiche.refus).toBe(BIBLIO.choisit("Bo"));
  });
});

describe("la rubrique Jeux", () => {
  it("range les jeux sous leur console quand il y en a plusieurs", () => {
    const lignes = lignesJeux({
      ...entree(),
      shelves: [
        { label: "GameCube", games: [ZELDA] },
        { label: "À classer", games: [INCONNU] },
      ],
      appareil: "clavier",
      armed: null,
      setArmed: vi.fn(),
    });
    expect(lignes.map((l) => [l.id, l.group])).toEqual([
      ["game0", "GameCube"],
      ["game1", "À classer"],
    ]);
    // Une console du manifeste ouvre une fiche ; un disque de console
    // inconnue s'arme d'une première pression, sans fiche.
    expect(lignes[0]!.fiche).toBeDefined();
    expect(lignes[1]!.fiche).toBeUndefined();
  });

  it("le jumeau : une seule console ne porte pas de titre, et rien ne se choisit sans décider", () => {
    const lignes = lignesJeux({
      ...entree({ mine: false }),
      shelves: [{ label: "GameCube", games: [ZELDA] }],
      appareil: "clavier",
      armed: null,
      setArmed: vi.fn(),
    });
    expect(lignes[0]!.group).toBeUndefined();
    expect(lignes[0]!.disabled).toBe(true);
  });
});

describe("la rubrique Réglages", () => {
  const reglages = (plus: Partial<EntreeReglages> = {}): EntreeReglages => ({
    shot: null,
    session: null,
    half: false,
    setHalf: vi.fn(),
    sizes: { full: "", half: "" },
    prixImage: "c'est autant de wifi rendu",
    fit: "remplir",
    setFit: vi.fn(),
    picture: { width: 0, height: 0 },
    space: { width: 0, height: 0 },
    volume: 1,
    setVolume: vi.fn(),
    theme: "nuit",
    setTheme: vi.fn(),
    effets: { niveau: "conseille", sons: false },
    deviceRate: false,
    setDeviceRate: vi.fn(),
    lipsync: false,
    setLipsync: vi.fn(),
    bare: false,
    setBare: vi.fn(),
    column: 304,
    setColumn: vi.fn(),
    rememberColumn: vi.fn(),
    fullscreen: false,
    toggleFullscreen: vi.fn(),
    avances: false,
    setAvances: vi.fn(),
    liaison: { etat: "ok" },
    port: 1,
    appareil: "clavier",
    tenu: false,
    voirDetail: vi.fn(),
    pleinEcranApi: true,
    ...plus,
  });

  it("garde les réglages avancés repliés, et le réglage des effets rétro sous Cet appareil", () => {
    const lignes = lignesReglages(reglages());
    const ids = lignes.map((l) => l.id);
    expect(ids).toContain("effets");
    expect(ids).toContain("advanced");
    expect(ids).not.toContain("lipsync");
    expect(ids).not.toContain("connexion");
    // Le jumeau : dépliés, ils paraissent.
    const ouverts = lignesReglages(reglages({ avances: true })).map((l) => l.id);
    expect(ouverts).toContain("lipsync");
    expect(ouverts).toContain("connexion");
  });

  it("« légère » règle l'image de la salle et le choix de la page", () => {
    const setHalf = vi.fn();
    const ligne = lignesReglages(reglages({ setHalf })).find((l) => l.id === "half")!;
    expect(ligne.picked).toBe("full");
    ligne.onPick!("half");
    expect(setHalf).toHaveBeenCalledWith(true);
  });

  it("tenue en main, ni colonne ni largeur de colonne", () => {
    const ids = lignesReglages(reglages({ tenu: true })).map((l) => l.id);
    expect(ids).not.toContain("bare");
    expect(ids).not.toContain("columnWidth");
    // Le jumeau : au bureau, les deux.
    const bureau = lignesReglages(reglages()).map((l) => l.id);
    expect(bureau).toEqual(expect.arrayContaining(["bare", "columnWidth"]));
  });
});
