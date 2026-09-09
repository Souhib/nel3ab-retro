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
