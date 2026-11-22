import { expect, it } from "vitest";
import { diagnose } from "./diagnosis";
import { VideoStream } from "../media/video";
const sample = () => ({
  ...new VideoStream(document.createElement("canvas"), (p) => p).stats(),
  connected: true,
  paintedSince: 40,
});

it("distingue l'attente, le décodage et la réception sans réduire les autres joueurs", () => {
  const video = sample();
  expect(diagnose({ ...video, connected: false }).title).toContain("Reconnexion");
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

it("dit l'image figée quand la liaison reste ouverte et qu'aucune image n'arrive", () => {
  // Le 21 novembre 2026, le résumé disait « aucune surcharge détectée » pendant
  // vingt minutes d'image figée (audit, P1 et E1).
  const gel = { ...sample(), painted: 4000, sinceHeardMs: 200, sinceUnitMs: 14_000 };
  const said = diagnose(gel);
  expect(said.title).toBe("Image figée");
  expect(said.detail).toContain("14 s");
  expect(said.reduce).toBe(false);
});

it("jumeau: une image arrivée il y a un instant n'est pas un gel", () => {
  const vit = { ...sample(), painted: 4000, sinceHeardMs: 16, sinceUnitMs: 16 };
  expect(diagnose(vit).title).not.toBe("Image figée");
});
