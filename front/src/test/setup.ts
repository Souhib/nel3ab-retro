import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom ne sait pas faire défiler, parce qu'il ne dessine rien.
//
// `scrollIntoView` n'existe donc pas, et tout composant qui garde son curseur
// visible plante au premier rendu de test. Ce n'est pas un défaut du produit:
// c'est la limite d'un navigateur sans écran. Le stub vit ici plutôt que dans
// chaque fichier de test, parce que c'est une propriété de l'environnement et
// non de ce qu'on vérifie.
//
// Il a coûté les trois premiers tests de composant jamais écrits dans ce dépôt.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Et on vide le document entre deux tests.
//
// Testing Library le fait tout seul quand vitest tourne en mode `globals`, ce
// qui n'est pas le cas ici: les tests importent `describe` et `it`
// explicitement. Sans ce nettoyage, le deuxième rendu s'ajoute au premier au
// lieu de le remplacer, et une recherche par texte trouve deux éléments ou le
// mauvais. Le symptôme ressemble à un défaut du composant et n'en est pas un.
afterEach(cleanup);

// jsdom n'a pas `showModal` ni `close` sur `<dialog>`.
//
// Le menu en est un depuis le 22 novembre 2026 (audit A11Y-04), comme l'écran
// des touches. Le remplaçant fait le minimum observable: l'attribut `open` et
// l'événement `close`. Il ne rend RIEN inerte et ne garde pas Tab: ce qui en
// dépend se vérifie dans un vrai navigateur (`just focus-navigateur`).
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

// jsdom n'a pas de contexte 2D : `getContext` y rend `null` et écrit « Not
// implemented » dans la console à chaque appel. Depuis que le logo d'Aïn se
// peint au montage du coin (23 novembre 2026), chaque rendu de la salle en
// écrivait une ligne, et le journal de `just check` noyait les vraies erreurs.
// Le remplaçant rend le même `null`, sans bruit ; un essai qui veut une toile
// la simule lui-même.
HTMLCanvasElement.prototype.getContext = function getContext() {
  return null;
} as typeof HTMLCanvasElement.prototype.getContext;
