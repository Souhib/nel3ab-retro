/** L'adresse porte l'entrée, l'invitation et la sortie (audit P8, P9, P11). */
import { describe, expect, it } from "vitest";

import {
  adresseAvec,
  entreeDeLAdresse,
  lienDInvitation,
  salonAuDessus,
  sortieVers,
} from "./entree";

describe("l'entrée lue dans l'adresse", () => {
  it("reconnaît jouer et regarder", () => {
    expect(entreeDeLAdresse("?entrer=jouer")).toBe("play");
    expect(entreeDeLAdresse("?entrer=regarder")).toBe("watch");
    expect(entreeDeLAdresse("?a=1&entrer=jouer")).toBe("play");
  });

  it("ne devine rien d'un mot inconnu ni d'une adresse sans entrée", () => {
    for (const search of ["", "?", "?entrer=", "?entrer=Jouer", "?entrer=play", "?jouer"])
      expect(entreeDeLAdresse(search), search).toBeNull();
  });
});

describe("l'adresse réécrite", () => {
  it("pose l'entrée en gardant le reste", () => {
    expect(adresseAvec("https://x.invalid/r/1/?a=1#b", "play")).toBe("/r/1/?a=1&entrer=jouer#b");
    expect(adresseAvec("https://x.invalid/r/1/?entrer=jouer", "watch")).toBe(
      "/r/1/?entrer=regarder",
    );
  });

  it("la retire en sortant, et rien d'autre", () => {
    expect(adresseAvec("https://x.invalid/r/1/?entrer=jouer", null)).toBe("/r/1/");
    expect(adresseAvec("https://x.invalid/r/1/?a=1&entrer=regarder", null)).toBe("/r/1/?a=1");
  });
});

describe("la sortie", () => {
  it("mène aux autres salles sous un salon", () => {
    expect(sortieVers("/r/1/")).toBe("/");
    expect(sortieVers("/r/12/")).toBe("/");
  });

  it("revient à l'avant-salle quand la page est la racine", () => {
    // Le jumeau: un retour vers « / » rechargerait la salle qu'on quitte.
    expect(sortieVers("/")).toBeNull();
    expect(sortieVers("/r/0/")).toBeNull();
    expect(salonAuDessus("/roms")).toBe(false);
  });
});

describe("l'invitation", () => {
  it("entre dans cette salle pour jouer", () => {
    expect(lienDInvitation("https://nel3ab.app", "/r/2/")).toBe(
      "https://nel3ab.app/r/2/?entrer=jouer",
    );
    expect(lienDInvitation("https://nel3ab.app", "/r/2")).toBe(
      "https://nel3ab.app/r/2/?entrer=jouer",
    );
    expect(entreeDeLAdresse(new URL(lienDInvitation("https://n.invalid", "/r/3/")).search)).toBe(
      "play",
    );
  });
});
