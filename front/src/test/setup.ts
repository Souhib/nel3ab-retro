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
