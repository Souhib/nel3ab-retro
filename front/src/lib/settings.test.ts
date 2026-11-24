/**
 * L'ordre des réglages, et la règle qui empêche d'en perdre un.
 */
import { describe, expect, it } from "vitest";

import { arrange, AVANCE, avecAvances, MANETTES, selonAppareil, SETTINGS } from "./settings";

const ids = (items: { id: string }[]) => items.map((one) => one.id);

describe("ranger les réglages", () => {
  it("met les entrées dans l'ordre de la table, quel que soit l'ordre reçu", () => {
    const shuffled = [{ id: "theme" }, { id: "sound" }, { id: "fullscreen" }];

    expect(ids(arrange(shuffled))).toEqual(["fullscreen", "sound", "theme"]);
  });

  it("pose le sujet sur chaque entrée", () => {
    expect(arrange([{ id: "volume" }])[0]?.group).toBe("Image et son");
  });

  it("garde une entrée inconnue, à la fin", () => {
    // La règle qui compte: un réglage ajouté sans penser à la table doit rester
    // atteignable. Mal placé se remarque et se corrige; disparu se cherche.
    const withNew = [{ id: "nouveau" }, { id: "sound" }];

    expect(ids(arrange(withNew))).toEqual(["sound", "nouveau"]);
    expect(arrange(withNew)[1]?.group).toBeUndefined();
  });

  it("ne perd et ne duplique jamais une entrée", () => {
    // Le jumeau: un tri qui filtrerait au lieu de trier passerait les essais du
    // dessus tant qu'on ne lui donne que des entrées connues.
    const many = SETTINGS.map((one) => ({ id: one.id })).concat([{ id: "inconnu" }]);

    expect(arrange(many)).toHaveLength(many.length);
    expect(new Set(ids(arrange(many))).size).toBe(many.length);
  });

  it("groupe les entrées d'un même sujet de façon CONTIGUË", () => {
    // C'est tout l'intérêt: sans séparateurs, l'adjacence EST le groupement.
    // Une table où « son » réapparaîtrait après « manettes » ne grouperait rien.
    const seen: string[] = [];
    for (const one of SETTINGS) {
      if (seen.at(-1) !== one.group) seen.push(one.group);
    }
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("ne nomme pas deux fois le même réglage", () => {
    expect(new Set(SETTINGS.map((one) => one.id)).size).toBe(SETTINGS.length);
  });

  it("ne garde aucun réglage de manette sous « réglages » (P12)", () => {
    // Le défaut: « touches et manettes » était la dixième entrée sur quinze, et
    // trois autres réglages de manette l'entouraient.
    const reglages = new Set(SETTINGS.map((one) => one.id));
    for (const one of MANETTES) expect(reglages.has(one.id), one.id).toBe(false);
    expect(ids(arrange([{ id: "pad" }, { id: "bindings" }], MANETTES))).toEqual([
      "bindings",
      "pad",
    ]);
  });

  it("montre au plus douze entrées à plat sous « réglages »", () => {
    const tous = arrange(SETTINGS.map((one) => ({ id: one.id })));
    expect(avecAvances(tous, false).length).toBeLessThanOrEqual(12);
  });
});

describe("le groupe avancé, replié", () => {
  const tous = arrange(SETTINGS.map((one) => ({ id: one.id })).concat([{ id: "inconnu" }]));

  it("cache les réglages avancés et garde l'entrée qui les déplie", () => {
    const vus = ids(avecAvances(tous, false));
    expect(vus).toContain("advanced");
    expect(vus).not.toContain("deviceRate");
    expect(vus).not.toContain("lipsync");
    expect(vus).not.toContain("connexion");
  });

  it("les montre dépliés, juste après l'entrée qui les déplie", () => {
    const vus = ids(avecAvances(tous, true));
    const at = vus.indexOf("advanced");
    expect(vus.slice(at + 1, at + 4)).toEqual(["deviceRate", "lipsync", "connexion"]);
  });

  it("ne replie jamais ce qui n'est pas avancé, même inconnu", () => {
    // Le jumeau: un filtre trop large replierait tout ce qu'il ne connaît pas.
    const vus = ids(avecAvances(tous, false));
    expect(vus).toContain("inconnu");
    expect(vus).toContain("volume");
    expect(
      avecAvances(tous, false).every((one) => one.group !== AVANCE || one.id === "advanced"),
    ).toBe(true);
  });
});

describe("les réglages selon l'appareil", () => {
  const tous = SETTINGS.map((one) => ({ id: one.id }));

  it("retire le repli et la largeur de la colonne quand elle est un tiroir", () => {
    const vus = ids(selonAppareil(tous, { tiroir: true, pleinEcran: true }));
    expect(vus).not.toContain("bare");
    expect(vus).not.toContain("columnWidth");
  });

  it("garde le repli et la largeur à côté de l'image", () => {
    // Le jumeau: la colonne d'un grand écran se règle comme avant.
    const vus = ids(selonAppareil(tous, { tiroir: false, pleinEcran: true }));
    expect(vus).toContain("bare");
    expect(vus).toContain("columnWidth");
  });

  it("ne propose le plein écran que là où il existe", () => {
    // Audit M8: sur un iPhone, l'entrée promettait un plein écran qui
    // n'arrivait jamais.
    expect(ids(selonAppareil(tous, { tiroir: true, pleinEcran: false }))).not.toContain(
      "fullscreen",
    );
    expect(ids(selonAppareil(tous, { tiroir: true, pleinEcran: true }))).toContain("fullscreen");
  });

  it("ne retire rien d'autre", () => {
    const vus = ids(selonAppareil(tous, { tiroir: true, pleinEcran: false }));
    const attendus = tous
      .map((one) => one.id)
      .filter((id) => !["bare", "columnWidth", "fullscreen"].includes(id));
    expect(vus).toEqual(attendus);
  });
});
