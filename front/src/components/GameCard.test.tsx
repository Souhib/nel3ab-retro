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

/** Une fiche de jeu Pro, telle que `game_controls.py` l'écrit pour Mario Tennis Aces. */
function proGame(console: string) {
  return {
    index: 0,
    name: "Jeu Pro",
    console,
    guide: {
      players: 4,
      allowed: [4],
      devices: ["Manette Pro"],
      source: "https://www.nintendo.com/",
      note: "Commandes standard.",
      actions: { "4": { A: "Frapper", ZR: "Instinct", PLUS: "Pause", "lx+": "Aller à droite" } },
    },
  };
}

it("la fiche d'un jeu Switch nomme la manette Pro, jamais la manette GameCube", () => {
  // Trouvé par l'audit du 22 novembre 2026: `padLabel(4)` retombait sur la
  // GameCube, faute de connaître la manette Pro.
  const { container } = render(<GameCard game={proGame("switch")} />);
  expect(container.textContent).not.toMatch(/GameCube/);
  expect(screen.getByText("manette Pro")).toBeInTheDocument();
  expect(screen.getByText("Repères · manette Pro")).toBeInTheDocument();
  // Les commandes sous les noms du configurateur Switch, pas ceux de la trame.
  expect(screen.getByText("ZR · gâchette droite")).toBeInTheDocument();
  expect(screen.getByText("+ · pause")).toBeInTheDocument();
  expect(screen.getByText("Stick gauche · droite")).toBeInTheDocument();
});

it("la fiche d'un jeu Xbox 360 parle Xbox", () => {
  const { container } = render(<GameCard game={proGame("x360")} />);
  expect(container.textContent).not.toMatch(/GameCube|manette Pro/);
  expect(screen.getByText("Repères · manette Xbox 360")).toBeInTheDocument();
  expect(screen.getByText("RT · gâchette droite")).toBeInTheDocument();
  expect(screen.getByText("Start")).toBeInTheDocument();
});

it("la fiche d'un jeu GameCube garde la manette GameCube, et un code inconnu le dit", () => {
  // Le jumeau: la GameCube reste nommée là où elle est vraie.
  render(
    <GameCard
      game={{
        index: 0,
        name: "Melee",
        console: "gc",
        guide: { allowed: [0], source: "", note: "", actions: {} },
      }}
    />,
  );
  expect(screen.getByText("manette GameCube")).toBeInTheDocument();
  const { container } = render(
    <GameCard
      game={{
        index: 1,
        name: "Mod",
        console: "wii",
        guide: { allowed: [7], source: "", note: "", actions: {} },
      }}
    />,
  );
  expect(container.textContent).toMatch(/appareil 7 inconnu/);
  expect(container.textContent).not.toMatch(/GameCube/);
});
