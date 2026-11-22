/** L'adresse porte l'entrée, l'invitation et la sortie (audit P8, P9, P11). */
import { describe, expect, it } from "vitest";

import {
  adresseAvec,
  entreeDeLAdresse,
  entreeDeLaSession,
  lienDInvitation,
  retenirEntree,
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

describe("l'adresse suit la place", () => {
  // Relecture du 22 novembre 2026: entré pour regarder, puis assis, un
  // rechargement rendait la place; entré pour jouer, puis levé, il la
  // reprenait avant l'ami à qui on la laissait. L'adresse suit maintenant ce
  // que la session fait, et non la porte par laquelle on est entré.
  it("dit jouer pour qui tient ou demande une place, regarder sinon", () => {
    expect(entreeDeLaSession(false)).toBe("play");
    expect(entreeDeLaSession(true)).toBe("watch");
  });

  /** Une adresse et un historique de jeu: ce que `retenirEntree` réécrit. */
  function faux(href: string) {
    const ecrites: string[] = [];
    const loc = { href };
    const hist = {
      state: { garde: 1 },
      replaceState: (_etat: unknown, _titre: string, url: string) => {
        ecrites.push(url);
        loc.href = new URL(url, loc.href).href;
      },
    };
    return { loc, hist, ecrites };
  }

  it("réécrit l'adresse quand la place change, sans étape d'historique", () => {
    const { loc, hist, ecrites } = faux("https://x.invalid/r/1/?entrer=regarder");
    retenirEntree("play", loc, hist);
    expect(ecrites).toEqual(["/r/1/?entrer=jouer"]);
    retenirEntree("watch", loc, hist);
    expect(ecrites).toEqual(["/r/1/?entrer=jouer", "/r/1/?entrer=regarder"]);
  });

  it("ne réécrit rien quand l'adresse dit déjà la même chose", () => {
    const { loc, hist, ecrites } = faux("https://x.invalid/r/1/?entrer=jouer");
    retenirEntree("play", loc, hist);
    expect(ecrites).toEqual([]);
  });

  it("laisse l'état en mémoire quand l'adresse refuse d'être réécrite", () => {
    const loc = { href: "https://x.invalid/r/1/" };
    const hist = {
      state: null,
      replaceState: () => {
        throw new DOMException("refusé", "SecurityError");
      },
    };
    expect(() => retenirEntree("play", loc, hist)).not.toThrow();
  });
});
