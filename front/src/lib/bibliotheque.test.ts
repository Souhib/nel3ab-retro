/**
 * La bibliothèque sans React (chantier menus) : rangées, suite d'un
 * lancement, conséquence, flèches et moment du dernier jeu. Chaque règle a
 * son jumeau : une phrase qui se tait doit aussi savoir parler.
 */
import { describe, expect, it } from "vitest";
import type { Game } from "../client";
import {
  cartoucheVoisine,
  consequence,
  moment,
  rangees,
  suiteDuLancement,
  type Place,
} from "./bibliotheque";

const jeu = (index: number, console: string | undefined, name = `Jeu ${index}`): Game => ({
  index,
  name,
  console,
});

describe("rangees", () => {
  it("suit l'ordre du manifeste, met « à classer » en dernier et ne crée aucune rangée vide", () => {
    const library = [jeu(0, "?"), jeu(1, "x360"), jeu(2, "gc"), jeu(3, "gc"), jeu(4, "wii")];
    const vu = rangees(library);
    expect(vu.map((r) => r.code)).toEqual(["gc", "wii", "x360", "?"]);
    expect(vu.map((r) => r.jeux.map((g) => g.index))).toEqual([[2, 3], [4], [1], [0]]);
    expect(vu[0]?.titre).toBe("GameCube, 2 jeux");
    expect(vu[1]?.titre).toBe("Wii, 1 jeu");
  });

  it("range un code inconnu dans « à classer » au lieu de le perdre", () => {
    const vu = rangees([jeu(0, "nes"), jeu(1, undefined)]);
    expect(vu.map((r) => r.code)).toEqual(["?"]);
    expect(vu[0]?.jeux.map((g) => g.index)).toEqual([0, 1]);
  });

  it("dit « à l'essai » sur la seule rangée de la Switch 2", () => {
    const vu = rangees([jeu(0, "switch2"), jeu(1, "switch"), jeu(2, "gc"), jeu(3, "x360")]);
    const essai = vu.filter((r) => r.essai).map((r) => r.code);
    expect(essai).toEqual(["switch2"]);
    expect(vu.find((r) => r.code === "switch2")?.titre).toBe("Switch 2 à l'essai, 1 jeu");
    // Le jumeau : aucune autre rangée ne porte le mot.
    for (const r of vu.filter((one) => one.code !== "switch2"))
      expect(r.titre).not.toMatch(/essai/);
  });

  it("ne rend rien pour une bibliothèque vide", () => {
    expect(rangees([])).toEqual([]);
  });
});

describe("suiteDuLancement", () => {
  const TOUT = "Le jeu part tout de suite.";
  const CHACUN = "Chacun dit qu'il est prêt, puis le jeu part.";

  it("part tout de suite : une place tenue, la sienne, et un seul appareil", () => {
    expect(suiteDuLancement({ console: "gc", tenues: 1, assis: true })).toBe(TOUT);
    expect(suiteDuLancement({ console: "x360", tenues: 1, assis: true })).toBe(TOUT);
  });

  it("attend chacun : deux places, ou une Wii à quatre appareils, ou le chef debout", () => {
    expect(suiteDuLancement({ console: "gc", tenues: 2, assis: true })).toBe(CHACUN);
    expect(suiteDuLancement({ console: "wii", tenues: 1, assis: true })).toBe(CHACUN);
    expect(suiteDuLancement({ console: "gc", tenues: 1, assis: false })).toBe(CHACUN);
    // Un code inconnu n'a aucun appareil : rien ne part tout seul.
    expect(suiteDuLancement({ console: "?", tenues: 1, assis: true })).toBe(CHACUN);
  });

  it("lit le guide d'une Wii, jamais celui d'une console à un appareil", () => {
    expect(suiteDuLancement({ console: "wii", allowed: [1], tenues: 1, assis: true })).toBe(TOUT);
    // Le jumeau : un guide à deux appareils attend chacun.
    expect(suiteDuLancement({ console: "wii", allowed: [1, 0], tenues: 1, assis: true })).toBe(
      CHACUN,
    );
    // La GameCube n'a qu'un appareil : un guide n'y change rien.
    expect(suiteDuLancement({ console: "gc", allowed: [0, 1], tenues: 1, assis: true })).toBe(TOUT);
  });

  it("ne compte que le chef pour une console à un joueur", () => {
    expect(suiteDuLancement({ console: "switch2", tenues: 3, assis: true })).toBe(TOUT);
    expect(suiteDuLancement({ console: "switch2", tenues: 3, assis: false })).toBe(CHACUN);
  });
});

describe("consequence", () => {
  const kart = jeu(0, "gc", "Kart des Ruelles");
  const tennis = jeu(1, "gc", "Tennis Lunaire");

  it("dit qui le jeu en cours arrête", () => {
    expect(consequence({ enCours: kart, choisi: tennis, tenues: 4, assis: true })).toBe(
      "Kart des Ruelles s'arrête pour les 4 joueurs.",
    );
    expect(consequence({ enCours: kart, choisi: tennis, tenues: 1, assis: true })).toBe(
      "Kart des Ruelles s'arrête pour toi.",
    );
    expect(consequence({ enCours: kart, choisi: tennis, tenues: 1, assis: false })).toBe(
      "Kart des Ruelles s'arrête pour 1 joueur.",
    );
    expect(consequence({ enCours: kart, choisi: tennis, tenues: 0, assis: false })).toBe(
      "Kart des Ruelles s'arrête.",
    );
  });

  it("ne dit rien sans jeu, et « repart » pour le jeu qui tourne", () => {
    expect(consequence({ enCours: null, choisi: tennis, tenues: 4, assis: true })).toBeNull();
    expect(consequence({ enCours: kart, choisi: kart, tenues: 4, assis: true })).toBe(
      "La partie repart de la sauvegarde choisie.",
    );
  });
});

describe("cartoucheVoisine", () => {
  // Deux rangées : trois cartouches en haut, deux en bas, décalées.
  const places: Place[] = [
    { rangee: 0, centre: 50 },
    { rangee: 0, centre: 150 },
    { rangee: 0, centre: 250 },
    { rangee: 1, centre: 90 },
    { rangee: 1, centre: 230 },
  ];

  it("↓ va à la cartouche de la rangée suivante dont le centre est le plus proche", () => {
    expect(cartoucheVoisine(places, 2, "bas")).toBe(4);
    expect(cartoucheVoisine(places, 0, "bas")).toBe(3);
    expect(cartoucheVoisine(places, 4, "haut")).toBe(2);
    // 150 est à 60 de 90 et à 80 de 230 : la plus proche gagne.
    expect(cartoucheVoisine(places, 1, "bas")).toBe(3);
    // À égalité exacte, la première de la rangée gagne.
    const egales: Place[] = [
      { rangee: 0, centre: 150 },
      { rangee: 1, centre: 100 },
      { rangee: 1, centre: 200 },
    ];
    expect(cartoucheVoisine(egales, 0, "bas")).toBe(1);
  });

  it("ne bouge pas au-delà de la première ou de la dernière rangée", () => {
    expect(cartoucheVoisine(places, 1, "haut")).toBe(1);
    expect(cartoucheVoisine(places, 3, "bas")).toBe(3);
  });

  it("← → suivent l'ordre, sans faire le tour", () => {
    expect(cartoucheVoisine(places, 2, "droite")).toBe(3);
    expect(cartoucheVoisine(places, 3, "gauche")).toBe(2);
    expect(cartoucheVoisine(places, 0, "gauche")).toBe(0);
    expect(cartoucheVoisine(places, 4, "droite")).toBe(4);
  });

  it("garde l'index d'une place absente", () => {
    expect(cartoucheVoisine(places, 9, "bas")).toBe(9);
  });
});

describe("moment", () => {
  // Un mardi soir, 21 h, à l'heure de l'appareil.
  const maintenant = new Date(2026, 10, 24, 21, 0);

  it("dit le moment comme on le dit", () => {
    expect(moment(new Date(2026, 10, 24, 19, 30).toISOString(), maintenant)).toBe("ce soir");
    expect(moment(new Date(2026, 10, 24, 9, 0).toISOString(), maintenant)).toBe("ce matin");
    expect(moment(new Date(2026, 10, 24, 14, 0).toISOString(), maintenant)).toBe("cet après-midi");
    expect(moment(new Date(2026, 10, 24, 2, 0).toISOString(), maintenant)).toBe("cette nuit");
    expect(moment(new Date(2026, 10, 23, 20, 0).toISOString(), maintenant)).toBe("hier soir");
    expect(moment(new Date(2026, 10, 23, 3, 0).toISOString(), maintenant)).toBe("la nuit dernière");
    expect(moment(new Date(2026, 10, 19, 22, 0).toISOString(), maintenant)).toBe("jeudi soir");
    // Six jours avant, le nom du jour ; sept, la date : « mardi soir » serait
    // ambigu un mardi.
    expect(moment(new Date(2026, 10, 18, 22, 0).toISOString(), maintenant)).toBe("mercredi soir");
    expect(moment(new Date(2026, 10, 17, 22, 0).toISOString(), maintenant)).toBe("le 17 novembre");
    expect(moment(new Date(2026, 10, 12, 22, 0).toISOString(), maintenant)).toBe("le 12 novembre");
  });

  it("se tait sur une date illisible ou à venir", () => {
    expect(moment("pas une date", maintenant)).toBeNull();
    expect(moment(new Date(2026, 10, 25, 9, 0).toISOString(), maintenant)).toBeNull();
  });
});
