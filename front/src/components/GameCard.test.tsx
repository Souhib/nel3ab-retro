import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { GameCard } from "./GameCard";
it("affiche les capacités vérifiées et distingue les huit joueurs du jeu des quatre places", () => {
  render(
    <GameCard
      game={{
        index: 0,
        name: "Mario Party 7",
        console: "gc",
        guide: {
          players: 8,
          allowed: [0],
          devices: ["Manette GameCube"],
          source: "https://www.nintendo.com/",
          checked: "2026-09-07",
          multiplayer: "Huit personnes partagent quatre manettes.",
          note: "Microphone indisponible.",
          actions: {},
        },
      }}
    />,
  );
  expect(screen.getByText("1–4 joueurs dans la salle")).toBeInTheDocument();
  expect(screen.getByText(/Huit personnes/)).toBeInTheDocument();
  expect(screen.getByRole("link")).toHaveAttribute("href", "https://www.nintendo.com/");
});
it("ne donne pas de capacité inventée à un jeu inconnu", () => {
  render(<GameCard game={{ index: 0, name: "Mod", console: "wii" }} />);
  expect(screen.getByText("Nombre de joueurs non vérifié")).toBeInTheDocument();
  expect(screen.getByText("Manettes compatibles non vérifiées")).toBeInTheDocument();
  expect(screen.queryByRole("link")).toBeNull();
});
