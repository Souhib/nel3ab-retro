import { expect, it } from "vitest";
import { diagnose, diagnostic } from "./diagnosis";
import { dire } from "./liaison-mots";
import type { Liaison } from "../media/liaison";
import { VideoStream } from "../media/video";
const sample = () => ({
  ...new VideoStream(document.createElement("canvas"), (p) => p).stats(),
  connected: true,
  paintedSince: 40,
});

it("distingue l'attente, le décodage et la réception sans réduire les autres joueurs", () => {
  const video = sample();
  expect(diagnose({ ...video, paintedSince: 0 }).reduce).toBe(false);
  expect(diagnose({ ...video, backlog: 10 }).title).toContain("Décodage");
  expect(diagnose({ ...video, backlog: 9 }).title).not.toContain("Décodage");
  expect(diagnose({ ...video, overloaded: true }).reduce).toBe(true);
  expect(diagnose({ ...video, overloaded: true, half: true }).reduce).toBe(false);
  expect(diagnose({ ...video, overloaded: true, halfDenied: true }).reduce).toBe(false);
  expect(diagnose(video).title).toBe("Aucune surcharge détectée");
});

it("dit quand l'écran affiche moins d'images que le jeu n'en envoie, sans en deviner la cause", () => {
  // Le 25 septembre 2026, un navigateur est passé de 110 à 21 Hz sur un
  // ordinateur fixe: les 60 images arrivaient, 39 par seconde étaient sautées à
  // l'affichage, et rien ne le disait. La cause n'est pas connue: le texte ne la
  // devine pas, et il ne propose pas le format réduit, qui n'y changerait rien.
  const video = { ...sample(), sourceHz: 60, refreshHz: 21 };
  const said = diagnose(video);
  expect(said.title).toBe("Affichage plus lent que le jeu");
  expect(said.detail).toContain("21 images par seconde");
  expect(said.detail).toContain("60");
  expect(said.detail.toLowerCase()).not.toContain("énergie");
  expect(said.reduce).toBe(false);
});

it("un écran qui suit le jeu, ou plus rapide que lui, ne déclenche rien", () => {
  const video = sample();
  expect(diagnose({ ...video, sourceHz: 60, refreshHz: 60 }).title).toBe(
    "Aucune surcharge détectée",
  );
  expect(diagnose({ ...video, sourceHz: 60, refreshHz: 55 }).title).toBe(
    "Aucune surcharge détectée",
  );
  expect(diagnose({ ...video, sourceHz: 50, refreshHz: 144 }).title).toBe(
    "Aucune surcharge détectée",
  );
  // Et une vraie surcharge de réception reste prioritaire sur l'affichage.
  expect(diagnose({ ...video, overloaded: true, sourceHz: 60, refreshHz: 21 }).title).toContain(
    "Réception",
  );
});

it("jumeau: une image arrivée il y a un instant n'est pas un gel", () => {
  const vit = { ...sample(), painted: 4000, sinceHeardMs: 16, sinceUnitMs: 16 };
  expect(diagnose(vit).title).not.toBe("Image figée");
});

// La colonne et le bandeau lisent la même machine à états (`media/liaison`).
// Avant, la colonne recalculait le gel et la coupure avec ses propres règles,
// et les deux pouvaient se contredire: pendant la reprise après un gel, le
// bandeau disait encore « image figée » et la colonne « aucune surcharge »
// (vérification finale du 22 novembre 2026).
const figee: Liaison = {
  etat: "figee",
  depuisMs: 9000,
  son: true,
  manette: true,
  niveau: "bandeau",
  apresRelance: false,
};

it("la colonne dit l'état de la liaison, avec les mots du bandeau", () => {
  // L'image repart déjà, mais la liaison n'est pas encore sortie du gel.
  const repart = { ...sample(), painted: 4000, sinceHeardMs: 16, sinceUnitMs: 16 };
  const dit = diagnostic(figee, repart, 1);
  expect(dit.title).toBe("image figée");
  expect(dit.detail).toContain(dire(figee, 1).titre);
  expect(dit.reduce).toBe(false);
  const decodeur = diagnostic({ etat: "decodeur", depuisMs: 5000 }, sample(), 1);
  expect(decodeur.title).toBe("affichage arrêté");
  expect(decodeur.detail).toContain("ton appareil ne l'affiche plus");
  const coupee = diagnostic({ etat: "coupee", cause: "reseau", depuisMs: 3000 }, sample(), 2);
  expect(coupee.title).toBe("coupée");
  expect(diagnostic({ etat: "fermee", a: null, pour: null }, sample(), 2).detail).toContain(
    "La salle 2 est fermée.",
  );
});

it("jumeau: une liaison en marche garde ce que seule la colonne sait", () => {
  const video = sample();
  expect(diagnostic({ etat: "ok" }, { ...video, backlog: 10 }, 1).title).toContain("Décodage");
  expect(diagnostic({ etat: "ok" }, { ...video, overloaded: true }, 1).reduce).toBe(true);
  expect(diagnostic({ etat: "irreguliere" }, { ...video, overloaded: true }, 1).title).toContain(
    "Réception",
  );
  expect(diagnostic({ etat: "ok" }, video, 1).title).toBe("Aucune surcharge détectée");
  // Un gel que la liaison ne voit pas (pas encore, ou plus) ne se dit pas ici.
  const gel = { ...video, painted: 4000, sinceHeardMs: 200, sinceUnitMs: 14_000 };
  expect(diagnostic({ etat: "ok" }, gel, 1).title).not.toBe("Image figée");
});
