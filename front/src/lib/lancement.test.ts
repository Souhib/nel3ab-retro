/**
 * Le panneau de lancement: le bon nom de console, le bon appareil, et un geste
 * par personne (audit P6, T03, T04, 22 novembre 2026).
 */
import { describe, expect, it } from "vitest";

import type { Preparation } from "../client";
import {
  ATTENTE_SANS_MS,
  attenteDesAbsents,
  choixAppareil,
  consoleDesTouches,
  enUneListe,
  gestesDuLancement,
  ligneJoueur,
  retenirArrivees,
  sauvegardeAnnoncee,
  titrePreparation,
} from "./lancement";

const AMI = "a".repeat(32) + "-1";
const BO = "b".repeat(32) + "-2";
const CLEO = "c".repeat(32) + "-3";

function preparation(allowed: number[], prets: Record<string, boolean> = {}): Preparation {
  return {
    id: "p",
    game: 0,
    save: 0,
    starter: AMI,
    allowed,
    players: [
      { port: 1, claim: AMI, name: "Ami", ready: prets[AMI] ?? false, pad: null },
      {
        port: 2,
        claim: BO,
        name: "Bo",
        ready: prets[BO] ?? false,
        pad: prets[BO] ? allowed[0] : null,
      },
    ],
  };
}

describe("l'en-tête", () => {
  it("nomme la console du jeu préparé, pas la Wii", () => {
    expect(titrePreparation("gc")).toBe("Avant de jouer · GameCube");
    expect(titrePreparation("x360")).toBe("Avant de jouer · Xbox 360");
    expect(titrePreparation("switch")).toBe("Avant de jouer · Switch");
    // Le jumeau: la Wii reste la Wii.
    expect(titrePreparation("wii")).toBe("Avant de jouer · Wii");
    // Une console inconnue n'en invente pas une.
    expect(titrePreparation(undefined)).toBe("Avant de jouer");
  });
});

describe("la ligne d'un joueur prêt", () => {
  const pret = (pad: number) => ({ port: 1, claim: AMI, name: "Ami", pad, ready: true });

  it("nomme l'appareil de la console de la salle", () => {
    expect(ligneJoueur(pret(4), "x360")).toBe("manette Xbox 360 · prêt");
    // Les jumeaux: la Switch garde la manette Pro, la Wii chaque appareil.
    expect(ligneJoueur(pret(4), "switch")).toBe("manette Pro · prêt");
    expect(ligneJoueur(pret(1), "wii")).toBe("Wiimote et Nunchuk · prêt");
    expect(ligneJoueur(pret(0), "gc")).toBe("manette GameCube · prêt");
    expect(ligneJoueur(pret(4), "x360")).not.toMatch(/Pro|Switch/);
  });

  it("ne dit pas prêt d'un joueur qui se prépare", () => {
    expect(ligneJoueur({ port: 2, claim: BO, name: "Bo", ready: false }, "gc")).toBe("se prépare");
  });
});

describe("le geste du chef", () => {
  it("lance en un geste quand les autres sont prêts, sans « Je suis prêt »", () => {
    const g = gestesDuLancement(preparation([0], { [BO]: true }), AMI, 0, "gc");
    expect(g.principal).toEqual({ quoi: "lancer", label: "Lancer le jeu", actif: true });
    expect(g.attente).toBeNull();
    expect(g.sansAttendre).toBeNull();
  });

  it("lance seul en un geste", () => {
    const seul = { ...preparation([1, 0]), players: [preparation([1, 0]).players[0]] };
    expect(gestesDuLancement(seul, AMI, 0, "wii").principal).toEqual({
      quoi: "lancer",
      label: "Lancer le jeu",
      actif: true,
    });
  });

  it("attend un absent, puis propose de lancer sans lui après le délai", () => {
    const tot = gestesDuLancement(preparation([0]), AMI, ATTENTE_SANS_MS - 1, "gc");
    expect(tot.principal).toEqual({ quoi: "lancer", label: "Lancer le jeu", actif: false });
    expect(tot.attente).toBe("En attente de Bo.");
    // Le jumeau: avant le délai, pas de raccourci.
    expect(tot.sansAttendre).toBeNull();
    const tard = gestesDuLancement(preparation([0]), AMI, ATTENTE_SANS_MS, "gc");
    expect(tard.sansAttendre).toEqual({
      label: "Lancer sans attendre Bo",
      note: "Bo garde sa place, avec la manette GameCube.",
    });
  });

  it("nomme tous les absents, et leur choix quand il y en a plusieurs", () => {
    const p = preparation([1, 0]);
    p.players.push({ port: 3, claim: CLEO, name: "Cleo", ready: false, pad: null });
    const g = gestesDuLancement(p, AMI, ATTENTE_SANS_MS, "wii");
    expect(g.sansAttendre?.label).toBe("Lancer sans attendre Bo et Cleo");
    expect(g.sansAttendre?.note).toBe(
      "Bo et Cleo gardent leur place, avec leur choix ou la Wiimote et Nunchuk.",
    );
  });
});

describe("le geste des autres", () => {
  it("confirme, puis peut modifier", () => {
    expect(gestesDuLancement(preparation([0]), BO, 0, "gc").principal).toEqual({
      quoi: "pret",
      label: "Je suis prêt",
      actif: true,
    });
    const pret = gestesDuLancement(preparation([0], { [BO]: true }), BO, 0, "gc");
    expect(pret.principal?.label).toBe("Modifier ma configuration");
    expect(pret.attente).toBe("Ami lance le jeu.");
  });

  it("ne lance jamais, même après le délai", () => {
    const g = gestesDuLancement(preparation([0]), BO, ATTENTE_SANS_MS * 10, "gc");
    expect(g.principal?.quoi).toBe("pret");
    expect(g.sansAttendre).toBeNull();
  });

  it("n'a aucun geste sans place", () => {
    expect(gestesDuLancement(preparation([0]), CLEO, 0, "gc")).toEqual({
      principal: null,
      sansAttendre: null,
      attente: null,
    });
  });
});

describe("la liste d'appareils", () => {
  it("n'existe qu'avec plus d'un choix", () => {
    expect(choixAppareil([0])).toBe(false);
    expect(choixAppareil([4])).toBe(false);
    expect(choixAppareil([1, 0])).toBe(true);
  });
});

it("met des noms en une phrase", () => {
  expect(enUneListe(["Bo"])).toBe("Bo");
  expect(enUneListe(["Bo", "Cleo"])).toBe("Bo et Cleo");
  expect(enUneListe(["Bo", "Cleo", "Dami"])).toBe("Bo, Cleo et Dami");
  expect(enUneListe([])).toBe("");
});

describe("l'écran des touches pendant une préparation", () => {
  it("dessine la console du jeu préparé, pas la Wii (audit T04)", () => {
    expect(consoleDesTouches(true, "gc", "wii")).toBe("gc");
    expect(consoleDesTouches(true, "x360", undefined)).toBe("x360");
    // Le jumeau: sans préparation, la console du jeu en cours.
    expect(consoleDesTouches(false, "gc", "wii")).toBe("wii");
    // Les replis: un jeu préparé inconnu, une salle sans jeu.
    expect(consoleDesTouches(true, undefined, "gc")).toBe("wii");
    expect(consoleDesTouches(false, undefined, undefined)).toBe("gc");
  });
});

describe("la sauvegarde annoncée au chargement", () => {
  const annonce = { save: "la sauvegarde d'Ami", saveSlot: 2 as const, starter: AMI };

  it("dit « ma sauvegarde » à qui a lancé", () => {
    expect(sauvegardeAnnoncee(annonce, AMI)).toBe("ma sauvegarde");
  });

  it("garde le mot du salon pour les autres et pour les autres emplacements", () => {
    expect(sauvegardeAnnoncee(annonce, BO)).toBe("la sauvegarde d'Ami");
    expect(sauvegardeAnnoncee(annonce, null)).toBe("la sauvegarde d'Ami");
    expect(sauvegardeAnnoncee({ save: "nouvelle partie", saveSlot: 0, starter: AMI }, AMI)).toBe(
      "nouvelle partie",
    );
    // Un salon d'avant n'envoie pas `starter`: son mot reste.
    expect(sauvegardeAnnoncee({ save: "reprendre", saveSlot: 2 }, AMI)).toBe("reprendre");
  });
});

describe("l'attente d'un absent", () => {
  it("part de l'arrivée du dernier absent", () => {
    const p = preparation([0]);
    const ouverture = retenirArrivees(null, p, 0);
    expect(attenteDesAbsents(p, ouverture, ATTENTE_SANS_MS)).toBe(ATTENTE_SANS_MS);
    p.players.push({ port: 3, claim: CLEO, name: "Cleo", ready: false, pad: null });
    const tard = retenirArrivees(ouverture, p, 19_000);
    expect(tard.vus.get(BO)).toBe(0);
    expect(tard.vus.get(CLEO)).toBe(19_000);
    expect(attenteDesAbsents(p, tard, ATTENTE_SANS_MS)).toBe(1_000);
    expect(attenteDesAbsents(p, tard, 19_000 + ATTENTE_SANS_MS)).toBe(ATTENTE_SANS_MS);
  });

  it("ne compte pas un joueur prêt, ni le chef", () => {
    const p = preparation([0], { [BO]: true });
    p.players.push({ port: 3, claim: CLEO, name: "Cleo", ready: true, pad: 0 });
    expect(attenteDesAbsents(p, retenirArrivees(null, p, 5_000), 30_000)).toBe(0);
  });

  it("rend le même objet quand personne n'arrive, et repart de zéro pour une autre préparation", () => {
    const p = preparation([0]);
    const a = retenirArrivees(null, p, 0);
    expect(retenirArrivees(a, { ...p, players: [...p.players] }, 9_000)).toBe(a);
    const autre = retenirArrivees(a, { ...p, id: "q" }, 9_000);
    expect(autre.vus.get(BO)).toBe(9_000);
  });

  it("élide l'attente devant une voyelle", () => {
    const p = preparation([0]);
    p.players[1].name = "Éloi";
    expect(gestesDuLancement(p, AMI, 0, "gc").attente).toBe("En attente d'Éloi.");
  });
});
