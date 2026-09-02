/**
 * La garde qui manquait à la boucle d'entrée.
 *
 * Elle existait en trois exemplaires recopiés et pas dans le quatrième endroit,
 * celui qui appelle `preventDefault`. Personne ne pouvait donc taper un `a` ni
 * un `s` dans un champ: ces touches-là pilotent la manette. Le pseudo du salon
 * en souffrait depuis le début.
 */
import { describe, expect, it } from "vitest";

import { typingIn } from "./typing";

describe("est-ce qu'on écrit", () => {
  it("dit oui dans un champ de texte", () => {
    expect(typingIn(document.createElement("input"))).toBe(true);
    expect(typingIn(document.createElement("textarea"))).toBe(true);
  });

  it("dit oui dans un élément éditable", () => {
    // Ni `input` ni `textarea`, et ça se tape quand même. Une garde qui ne
    // regarderait que le nom de balise le raterait.
    //
    // C'est l'ATTRIBUT qui est lu ici: jsdom n'implémente pas
    // `isContentEditable`, donc cet essai passe par le repli et un navigateur
    // passerait par la propriété. Dit plutôt que tu, parce qu'un essai qui
    // couvre un chemin différent de celui de la vraie page doit s'annoncer.
    const rich = document.createElement("div");
    rich.setAttribute("contenteditable", "true");

    expect(typingIn(rich)).toBe(true);
  });

  it("rend un vrai booléen, jamais autre chose", () => {
    // La première version faisait `a || b || target.isContentEditable`, et
    // rendait donc `undefined` là où son type promettait `boolean`. Utilisée
    // dans un `if`, ça marchait; le type mentait quand même.
    for (const tag of ["input", "div"]) {
      expect(typeof typingIn(document.createElement(tag)), tag).toBe("boolean");
    }
  });

  it("dit non partout ailleurs", () => {
    // LE jumeau: une garde qui rendrait toujours vrai désarmerait la manette au
    // complet, et le clavier ne jouerait plus jamais. C'est un défaut bien pire
    // que celui qu'on corrige, et parfaitement silencieux.
    for (const tag of ["div", "button", "canvas", "body"]) {
      expect(typingIn(document.createElement(tag)), tag).toBe(false);
    }
  });

  it("dit non sur rien du tout", () => {
    // `event.target` peut être nul, et une lecture qui ferait confiance
    // lèverait dans un écouteur de clavier — donc à chaque touche.
    expect(typingIn(null)).toBe(false);
    expect(typingIn(new EventTarget())).toBe(false);
  });
});
