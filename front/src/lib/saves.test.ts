/**
 * Le panneau de lancement, et le défaut qu'il a caché deux jours.
 *
 * Le panneau croisait les emplacements avec les manettes et numérotait ses
 * entrées « 0-0 » à « 1-1 ». Quand la manette a déménagé dans les réglages, le
 * lecteur de choix est passé à `id === "1"`, vrai pour aucune des quatre. Tout
 * jeu Wii démarrait donc sur « partie neuve » quoi qu'on demande, sans rien
 * échouer: le jeu se lançait, simplement pas celui qu'on avait demandé.
 *
 * Ce fichier existe pour que les deux moitiés du choix ne puissent plus
 * diverger sans que quelque chose devienne rouge.
 */
import { describe, expect, it } from "vitest";

import { PERSONAL, SLOTS, launchPicks, slotFromPick } from "./saves";

describe("le panneau de lancement", () => {
  it("propose une entrée par emplacement, et rien de plus", () => {
    // Comparé à SLOTS plutôt qu'à une liste écrite ici: une liste recopiée à la
    // main serait la même erreur, écrite deux fois.
    expect(launchPicks(true)).toHaveLength(SLOTS.length);
  });

  it("ne propose la sauvegarde personnelle que si le salon sait qui tu es", () => {
    // Le worker ne peut pas nommer un dossier d'après quelqu'un qu'il ne
    // connaît pas: la proposer sans identité ferait cliquer sur un choix qui
    // retombe en silence sur la partie neuve.
    expect(launchPicks(true).map((pick) => pick.id)).toContain(String(PERSONAL));
    expect(launchPicks().map((pick) => pick.id)).not.toContain(String(PERSONAL));
  });

  it("ne propose plus de manette, qui est un réglage et pas une décision de partie", () => {
    const said = launchPicks(true)
      .map((pick) => `${pick.label} ${pick.hint}`)
      .join(" ");

    expect(said).not.toMatch(/manette|Wiimote|Nunchuk/i);
  });

  it("relit chacun de ses identifiants comme l'emplacement qu'il désigne", () => {
    // LE défaut, épinglé: « tout débloqué » doit rendre 1, pas 0. Un lecteur qui
    // se tromperait rendrait ici l'emplacement d'à côté.
    for (const pick of launchPicks(true)) {
      const wanted = SLOTS.find((choice) => choice.label === pick.label);
      expect(slotFromPick(pick.id), pick.label).toBe(wanted?.id);
    }
    // Et les deux entrées ne désignent pas le même emplacement, sinon un lecteur
    // qui rendrait toujours zéro passerait la boucle sur un panneau à une entrée.
    const seen = new Set(launchPicks(true).map((pick) => slotFromPick(pick.id)));
    expect(seen.size).toBe(SLOTS.length);
  });

  it("ne lance rien sur un identifiant qu'il ne connaît pas", () => {
    // Le jumeau négatif, et la forme exacte du défaut: l'ancien lecteur repliait
    // tout inconnu sur zéro, donc « 1-1 » lançait une partie neuve en silence.
    expect(slotFromPick("1-1")).toBeNull();
    expect(slotFromPick("")).toBeNull();
    // Deux est l'emplacement personnel depuis le 12 septembre 2026: l'inconnu
    // commence après lui, et cet essai a signalé le changement.
    expect(slotFromPick("3")).toBeNull();
  });
});
