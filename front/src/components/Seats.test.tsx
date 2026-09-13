import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Seats } from "./Seats";

it("montre les noms connus et aucun nom inventé sous les prises", () => {
  render(
    <Seats
      players={4}
      busy={[true, true, false, false]}
      names={new Map([[1, "Souhib"]])}
      mine={1}
      displaced={false}
      onTake={vi.fn()}
      onAsk={vi.fn()}
    />,
  );
  expect(screen.getByText("Souhib")).toBeInTheDocument();
  expect(document.querySelector("#port1")?.textContent).toContain("P1");
  expect(document.querySelector("#port1")?.textContent).not.toContain("TOI");
  expect(screen.queryByText(/occupée|occupé/)).not.toBeInTheDocument();
  expect(document.querySelector("#port2")?.textContent).not.toContain("toi");
});

it("place la couronne sur la place du chef, même si ce n'est pas le premier joueur", () => {
  const props = {
    players: 4,
    busy: [true, true, false, false],
    names: new Map([
      [1, "Souhib"],
      [2, "Yassine"],
    ]),
    mine: 1,
    displaced: false,
    onTake: vi.fn(),
    onAsk: vi.fn(),
  };
  const { rerender } = render(<Seats {...props} ownerSeat={2} />);
  expect(document.querySelector('#port2 [aria-label="chef de la salle"]')).not.toBeNull();
  expect(document.querySelector('#port1 [aria-label="chef de la salle"]')).toBeNull();
  rerender(<Seats {...props} ownerSeat={null} />);
  expect(screen.queryByLabelText("chef de la salle")).not.toBeInTheDocument();
});

/* La couronne marque la PRISE, elle ne partage pas le cadre du nom.
   Dans la cellule de 65 px, « Souhib » occupe 55 px en sans-serif et la
   couronne 16: le nom se coupait en « Sou… » dès qu'on était chef. Signalé par
   Souhib sur sa propre partie le 13 septembre 2026, capture à l'appui.
   L'essai porte sur la STRUCTURE et non sur des pixels, parce que jsdom ne fait
   pas de mise en page: ce qui doit rester vrai est que la couronne n'est jamais
   à l'intérieur du cadre qui tronque. */
it("garde la couronne hors du cadre qui tronque le nom", () => {
  render(
    <Seats
      players={4}
      busy={[true, true, false, false]}
      names={
        new Map([
          [1, "Souhib"],
          [2, "Yassine"],
        ])
      }
      mine={1}
      displaced={false}
      ownerSeat={2}
      onTake={vi.fn()}
      onAsk={vi.fn()}
    />,
  );
  const prise = document.querySelector("#port2");
  expect(
    prise?.querySelector('[aria-label="chef de la salle"]'),
    "la couronne marque bien la prise du chef",
  ).not.toBeNull();
  expect(
    prise?.querySelector('.truncate [aria-label="chef de la salle"]'),
    "mais jamais DANS le cadre qui tronque, où elle vole sa place au nom",
  ).toBeNull();
  expect(prise?.querySelector(".truncate")?.textContent?.trim()).toBe("Yassine");
});
