import { expect, it } from "vitest";
import { cn } from "./cn";

/* Le défaut exact, et il était invisible: une taille et une couleur dans le
   même appel, et `tailwind-merge` n'en gardait qu'une. */
it("garde le palier de texte quand une couleur l'accompagne", () => {
  const rendu = cn("block truncate text-note", "text-faint").split(" ");
  expect(rendu, "la taille ne doit pas disparaître").toContain("text-note");
  expect(rendu, "la couleur non plus").toContain("text-faint");
});

/* La couleur d'abord, le palier ensuite. Vérifier le palier seul ne prouvait
   rien: la fusion par défaut garde la DERNIÈRE classe, qui est justement le
   palier, et l'essai restait vert avec le défaut remis. C'est la couleur qui
   disparaît dans cet ordre-là. */
it("garde le palier et la couleur quel que soit l'ordre", () => {
  const rendu = cn("text-faint", "text-corps").split(" ");
  expect(rendu).toContain("text-corps");
  expect(rendu, "la couleur posée avant le palier ne doit pas disparaître").toContain("text-faint");
});

/* Le jumeau négatif: apprendre à l'outil que ce sont des tailles ne doit pas
   lui faire oublier de FONDRE deux tailles entre elles. Sans cet essai, une
   correction qui se contenterait de tout laisser passer serait verte. */
it("fond toujours deux paliers en un seul, le dernier gagne", () => {
  const rendu = cn("text-note", "text-corps").split(" ");
  expect(rendu).toContain("text-corps");
  expect(rendu).not.toContain("text-note");
});

it("continue de fondre deux couleurs entre elles", () => {
  const rendu = cn("text-faint", "text-indigo").split(" ");
  expect(rendu).toContain("text-indigo");
  expect(rendu).not.toContain("text-faint");
});
