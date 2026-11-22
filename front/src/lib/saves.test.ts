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
import { afterEach, describe, expect, it, vi } from "vitest";

import { PERSONAL, SLOTS, launchPicks, padLabel, readUnlocked, slotFromPick } from "./saves";

afterEach(() => vi.unstubAllGlobals());

it("lit un catalogue booléen frais et refuse une ancienne page HTML ou des codes de sauvegarde", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("[false,true]"));
  vi.stubGlobal("fetch", fetcher);
  expect(await readUnlocked("/saves")).toEqual([false, true]);
  expect(fetcher).toHaveBeenCalledWith("/saves", { cache: "no-store" });
  for (const body of ["<html>old worker</html>", "[0,1]", '{"available":true}', "[true,null]"]) {
    fetcher.mockResolvedValue(new Response(body));
    await expect(readUnlocked("/saves")).rejects.toThrow();
  }
  fetcher.mockResolvedValue(new Response("[]", { status: 503 }));
  await expect(readUnlocked("/saves")).rejects.toThrow();
});

describe("le panneau de lancement", () => {
  it("ne propose tout débloqué que si le worker trouve un import disponible", () => {
    expect(launchPicks(true, false).map((pick) => pick.id)).toEqual(["0", "2"]);
    expect(launchPicks(false, false).map((pick) => pick.id)).toEqual(["0"]);
    expect(launchPicks(true, true).map((pick) => pick.id)).toEqual(["0", "1", "2"]);
    expect(launchPicks(false, true).map((pick) => pick.id)).toEqual(["0", "1"]);
    expect(slotFromPick("1", false)).toBeNull();
    expect(slotFromPick("1", true)).toBe(1);
    expect(slotFromPick("0", false)).toBe(0);
    expect(slotFromPick("2", false)).toBe(PERSONAL);
  });

  it("propose une entrée par emplacement, et rien de plus", () => {
    // Comparé à SLOTS plutôt qu'à une liste écrite ici: une liste recopiée à la
    // main serait la même erreur, écrite deux fois.
    expect(launchPicks(true, true)).toHaveLength(SLOTS.length);
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
    for (const pick of launchPicks(true, true)) {
      const wanted = SLOTS.find((choice) => choice.label === pick.label);
      expect(slotFromPick(pick.id, true), pick.label).toBe(wanted?.id);
    }
    // Et les deux entrées ne désignent pas le même emplacement, sinon un lecteur
    // qui rendrait toujours zéro passerait la boucle sur un panneau à une entrée.
    const seen = new Set(launchPicks(true, true).map((pick) => slotFromPick(pick.id, true)));
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

it("ne nomme jamais la GameCube pour un appareil qu'elle ne connaît pas", () => {
  // Le code 4 est la manette Pro, le seul appareil des salles Switch, Switch 2
  // et Xbox 360 (consoles.json). L'ancien repli l'appelait « manette GameCube »
  // (audit du 22 novembre 2026). La première correction disait « appareil 4
  // inconnu », un message de panne sur le chemin normal : la préparation d'un
  // jeu Switch l'affichait pour chaque joueur prêt (revue du même jour).
  expect(padLabel(4)).toBe("manette Pro");
  expect(padLabel(4)).not.toMatch(/GameCube|inconnu/);
  // Le jumeau: un code que personne ne présente reste inconnu, et le dit.
  expect(padLabel(7)).toBe("appareil 7 inconnu");
  // Et les quatre codes Wii gardent leur nom.
  expect(padLabel(0)).toBe("manette GameCube");
  expect(padLabel(3)).toBe("Wiimote seule");
});
