/**
 * À qui va une touche: la règle, et ses jumeaux.
 *
 * Une règle qui rendrait toujours vrai remettrait le défaut A11Y-01 (Entrée sur
 * un bouton part au jeu); une règle qui rendrait toujours faux couperait le
 * clavier de toute partie. Chaque oui a donc son non.
 */
import { afterEach, describe, expect, it } from "vitest";

import { clavierAuJeu, clavierEnPause, ZONE_JEU } from "./focus-jeu";

function salle() {
  document.body.innerHTML = `
    <main>
      <div id="zone" ${ZONE_JEU} tabindex="0"><canvas id="image"></canvas></div>
      <button id="calque">relancer l'image</button>
    </main>
    <aside id="colonne" tabindex="-1">
      <button id="details">détails</button>
      <a id="salles" href="/">les salles</a>
      <select id="micro"><option>défaut</option></select>
    </aside>`;
  const $ = (id: string) => document.getElementById(id)!;
  return $;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("le clavier va au jeu", () => {
  it("dans la zone de jeu et sur l'image qu'elle contient", () => {
    const $ = salle();
    expect(clavierAuJeu($("zone"))).toBe(true);
    expect(clavierAuJeu($("image"))).toBe(true);
  });

  it("quand personne n'a le focus", () => {
    // Un clic sur un texte de la colonne laisse le focus au document: la partie
    // ne doit pas s'arrêter pour autant.
    salle();
    expect(clavierAuJeu(document.body)).toBe(true);
    expect(clavierAuJeu(document.documentElement)).toBe(true);
    expect(clavierAuJeu(document)).toBe(true);
    expect(clavierAuJeu(window)).toBe(true);
    expect(clavierAuJeu(null)).toBe(true);
  });
});

describe("le clavier reste à la page", () => {
  it("sur un bouton, un lien ou une liste de la colonne", () => {
    // Le défaut A11Y-01: Entrée sur « détails » partait au jeu comme START.
    const $ = salle();
    for (const id of ["details", "salles", "micro"]) expect(clavierAuJeu($(id)), id).toBe(false);
  });

  it("sur un bouton posé PAR-DESSUS l'image, hors de la zone", () => {
    // Les calques de la salle (bandeau d'état, avis de fermeture) sont frères de
    // la zone dans `<main>`, pas ses enfants: leurs boutons gardent Entrée.
    const $ = salle();
    expect(clavierAuJeu($("calque"))).toBe(false);
  });

  it("sur une colonne qui a pris le focus pour défiler", () => {
    // Chrome rend une zone qui défile focalisable au clavier. Ses flèches font
    // défiler, elles ne poussent pas le stick.
    const $ = salle();
    expect(clavierAuJeu($("colonne"))).toBe(false);
  });

  it("sur une cible qui n'est pas un élément", () => {
    expect(clavierAuJeu(new EventTarget())).toBe(false);
  });
});

describe("dire que le clavier ne joue plus", () => {
  const joue = {
    partie: true,
    place: true,
    appareil: "clavier" as const,
    menu: false,
    auJeu: false,
  };

  it("à qui joue au clavier pendant que le focus est sur la colonne", () => {
    expect(clavierEnPause(joue)).toBe(true);
  });

  it("jamais quand le clavier joue, ni à qui ne joue pas au clavier", () => {
    expect(clavierEnPause({ ...joue, auJeu: true })).toBe(false);
    expect(clavierEnPause({ ...joue, partie: false })).toBe(false);
    expect(clavierEnPause({ ...joue, place: false })).toBe(false);
    expect(clavierEnPause({ ...joue, appareil: "manette" })).toBe(false);
    expect(clavierEnPause({ ...joue, appareil: "tactile" })).toBe(false);
    expect(clavierEnPause({ ...joue, menu: true })).toBe(false);
  });
});
