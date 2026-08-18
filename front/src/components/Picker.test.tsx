/**
 * Le sélecteur, et le défaut qui l'a rendu faux pendant une soirée.
 *
 * Ce fichier existe parce que dix-neuf composants n'avaient aucun test que la
 * CI exécute, alors que `@testing-library/react` était déjà installé. Deux
 * bogues de la semaine du 17 août 2026 vivaient exactement ici, et les deux ont
 * été trouvés à la main.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Picker, type Costume } from "./Picker";
import type { Picking } from "./shell";

const COSTUME: Costume = {
  panel: "#111",
  ink: "#eee",
  edge: "#333",
  accent: "#7c6ce0",
};

function picking(overrides: Partial<Picking> = {}): Picking {
  return {
    item: {
      id: "theme",
      label: "ambiance",
      icon: null,
      picks: [
        { id: "sombre", label: "sombre" },
        { id: "clair", label: "clair" },
        { id: "encre", label: "encre" },
      ],
    },
    cursor: 0,
    moveTo: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    previewing: false,
    ...overrides,
  };
}

describe("le sélecteur", () => {
  it("valide l'option CLIQUÉE, pas celle sous le curseur", () => {
    // Le défaut exact: cliquer déplaçait le curseur puis validait, et la
    // validation relisait l'ancien curseur parce que le déplacement est un
    // changement d'état asynchrone. Choisir « encre » donnait « sombre ».
    const confirm = vi.fn();
    render(<Picker picking={picking({ cursor: 0, confirm })} costume={COSTUME} />);

    fireEvent.click(screen.getByText("encre"));

    expect(confirm).toHaveBeenCalledWith(2);
  });

  it("ne bouge pas le curseur quand le panneau apparaît sous un pointeur immobile", () => {
    // `mouseenter` se déclenche aussi quand le panneau APPARAÎT sous la souris,
    // donc ouvrir le sélecteur envoyait le curseur là où le pointeur se
    // trouvait par hasard. Seul un vrai mouvement doit compter.
    const moveTo = vi.fn();
    render(<Picker picking={picking({ moveTo })} costume={COSTUME} />);
    const option = screen.getByText("clair");

    fireEvent.mouseEnter(option);
    expect(moveTo).not.toHaveBeenCalled();

    fireEvent.mouseMove(option);
    expect(moveTo).toHaveBeenCalledWith(1);
  });

  it("montre laquelle est sous le curseur", () => {
    render(<Picker picking={picking({ cursor: 1 })} costume={COSTUME} />);

    expect(document.querySelector("#pick-clair")).toHaveAttribute("data-at", "true");
    expect(document.querySelector("#pick-sombre")).toHaveAttribute("data-at", "false");
  });

  it("ne montre rien quand rien n'est en train d'être réglé", () => {
    // Le jumeau: sans lui, un sélecteur toujours affiché passerait les autres.
    render(<Picker picking={null} costume={COSTUME} />);

    expect(document.querySelector("#picker")).toBeNull();
  });
});
