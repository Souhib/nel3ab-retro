/**
 * L'ordre des réglages, et la règle qui empêche d'en perdre un.
 */
import { describe, expect, it } from "vitest";

import { arrange, SETTINGS } from "./settings";

const ids = (items: { id: string }[]) => items.map((one) => one.id);

describe("ranger les réglages", () => {
  it("met les entrées dans l'ordre de la table, quel que soit l'ordre reçu", () => {
    const shuffled = [{ id: "shell" }, { id: "sound" }, { id: "fullscreen" }];

    expect(ids(arrange(shuffled))).toEqual(["fullscreen", "sound", "shell"]);
  });

  it("pose le sujet sur chaque entrée", () => {
    expect(arrange([{ id: "volume" }])[0]?.group).toBe("son");
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
});
