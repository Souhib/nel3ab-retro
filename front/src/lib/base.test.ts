import { afterEach, describe, expect, it } from "vitest";

import { base, socketUnder, under } from "./base";

const servieA = (path: string) => window.history.pushState({}, "", path);

afterEach(() => servieA("/"));

describe("le préfixe d'une salle", () => {
  it("ne change rien à la racine", () => {
    servieA("/");
    expect(base()).toBe("/");
    expect(under("/roms").pathname).toBe("/roms");
  });

  it("préfixe toutes les adresses de la salle", () => {
    servieA("/r/1/");
    expect(under("/roms").pathname).toBe("/r/1/roms");
    expect(under("/art/3.png").pathname).toBe("/r/1/art/3.png");
  });

  it("reste juste sans la barre finale", () => {
    servieA("/r/2");
    expect(under("/roms").pathname).toBe(
      "/r/2/roms",
      // Le jumeau qui compte: sans normalisation, une adresse atteinte sans
      // barre finale renverrait à `/roms`, c'est-à-dire au salon.
    );
  });

  it("garde les paramètres, qui portent l'identité et la place voulue", () => {
    servieA("/r/1/");
    const url = under("/input?identity=1&prefer=2");
    expect(url.pathname).toBe("/r/1/input");
    expect(url.search).toBe("?identity=1&prefer=2");
  });

  it("ouvre la socket sur la même origine, en clair ou chiffré", () => {
    servieA("/r/1/");
    // jsdom sert en http, donc la socket doit être en clair.
    expect(socketUnder("/video")).toBe("ws://localhost:3000/r/1/video");
    expect(socketUnder("video")).toBe("ws://localhost:3000/r/1/video");
  });
});
