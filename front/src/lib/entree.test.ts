/** L'adresse porte l'entrée, l'invitation et la sortie (audit P8, P9, P11). */
import { describe, expect, it } from "vitest";

import {
  adresseAvec,
  entreeDeLAdresse,
  entreeDeLaSession,
  lienDInvitation,
  lienDeLaPlace,
  oublierPlace,
  placeDeLAdresse,
  retenirPlace,
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

  it("entre pour regarder quand l'invitation le demande", () => {
    expect(lienDInvitation("https://nel3ab.app", "/r/1/", "watch")).toBe(
      "https://nel3ab.app/r/1/?entrer=regarder",
    );
    expect(
      entreeDeLAdresse(new URL(lienDInvitation("https://n.invalid", "/r/1", "watch")).search),
    ).toBe("watch");
    // Jumeau : demander « jouer » ne donne pas « regarder ».
    expect(lienDInvitation("https://nel3ab.app", "/r/1/", "play")).toBe(
      "https://nel3ab.app/r/1/?entrer=jouer",
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

describe("une place précise dans l'adresse (?place=N)", () => {
  it("lit une place de 1 à 4", () => {
    for (const n of [1, 2, 3, 4]) expect(placeDeLAdresse(`?entrer=jouer&place=${n}`)).toBe(n);
  });

  it("refuse 0, 5 et tout ce qui n'est pas un chiffre seul", () => {
    for (const search of [
      "",
      "?entrer=jouer",
      "?place=0",
      "?place=5",
      "?place=03",
      "?place=1.5",
      "?place=-1",
      "?place=3a",
      "?place= 3",
      "?place=",
    ])
      expect(placeDeLAdresse(search), search).toBeNull();
  });

  it("le lien d'une place entre pour jouer à cette place", () => {
    expect(lienDeLaPlace("/r/2/", 3)).toBe("/r/2/?entrer=jouer&place=3");
    expect(lienDeLaPlace("/r/2", 1)).toBe("/r/2/?entrer=jouer&place=1");
  });

  it("une entrée pour regarder, ou la sortie, oublie la place ; jouer la garde", () => {
    const href = "https://x.invalid/r/1/?entrer=jouer&place=3#b";
    expect(adresseAvec(href, "watch")).toBe("/r/1/?entrer=regarder#b");
    expect(adresseAvec(href, null)).toBe("/r/1/#b");
    expect(adresseAvec(href, "play")).toBe("/r/1/?entrer=jouer&place=3#b");
  });

  it("oublierPlace la retire sans étape d'historique, et seulement si elle y est", () => {
    const ecrites: string[] = [];
    const historique = {
      state: { garde: 1 },
      replaceState: (_e: unknown, _t: string, url: string) => void ecrites.push(url),
    };
    oublierPlace({ href: "https://x.invalid/r/1/?entrer=jouer&place=2" }, historique);
    expect(ecrites).toEqual(["/r/1/?entrer=jouer"]);
    oublierPlace({ href: "https://x.invalid/r/1/?entrer=jouer" }, historique);
    expect(ecrites).toHaveLength(1);
  });
});

describe("la place retenue par l'avant-salle", () => {
  it("écrit jouer et la place en gardant le reste, sans étape d'historique", () => {
    const ecrites: string[] = [];
    const historique = {
      state: null,
      replaceState: (_e: unknown, _t: string, url: string) => void ecrites.push(url),
    };
    retenirPlace(3, { href: "https://x.invalid/r/2/?banc=1#h" }, historique);
    expect(ecrites).toEqual(["/r/2/?banc=1&entrer=jouer&place=3#h"]);
    expect(placeDeLAdresse(new URL(`https://x.invalid${ecrites[0]}`).search)).toBe(3);
  });
});
