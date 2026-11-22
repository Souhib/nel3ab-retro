import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Seats } from "./Seats";

it("montre les noms connus et aucun nom inventé sous les prises", () => {
  render(
    <Seats
      players={4}
      busy={[true, true, false, false]}
      mics={[true, false, false, false]}
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
    mics: [true, false, false, false],
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
      mics={[true, false, false, false]}
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

it("dit l'état de chaque prise dans son nom, et garde la sienne dans la tabulation", () => {
  // Audit A11Y-11: « Manette 2 » sans « libre » ni « occupée », et la prise à
  // soi `disabled`, donc absente de la tabulation et muette.
  const onTake = vi.fn();
  render(
    <Seats
      players={4}
      busy={[true, false, true, true]}
      mics={[false, false, false, false]}
      names={new Map([[3, "Bo"]])}
      mine={1}
      displaced={false}
      onTake={onTake}
      onAsk={vi.fn()}
    />,
  );
  const prise = (port: number) => document.querySelector<HTMLButtonElement>(`#port${port}`)!;
  // « place » pour l'emplacement, « manette » pour l'objet (audit T05).
  expect(prise(1).getAttribute("aria-label")).toBe("Place 1, la tienne");
  expect(prise(1).disabled).toBe(false);
  expect(prise(1).getAttribute("aria-disabled")).toBe("true");
  expect(prise(2).getAttribute("aria-label")).toBe("Place 2, libre");
  // Qui la tient, et ce qu'un clic fait: « Bo » seul ne disait ni l'un ni
  // l'autre (relecture du 22 novembre 2026).
  expect(prise(3).getAttribute("aria-label")).toBe("Place 3, prise par Bo, demander");
  expect(prise(4).getAttribute("aria-label")).toBe("Place 4, prise");
  // Le jumeau: rester focalisable ne la rend pas cliquable.
  prise(1).click();
  expect(onTake).not.toHaveBeenCalled();
  prise(2).click();
  expect(onTake).toHaveBeenCalledWith(2);
});

it("ne couronne pas une place libre, même désignée comme celle du chef", () => {
  // Venu de la colonne, dont la liste « joueurs » est partie (audit P7): le
  // droit d'administrateur n'invente pas un chef assis sur une place vide.
  render(
    <Seats
      players={4}
      busy={[true, false, false, false]}
      mics={[false, false, false, false]}
      names={new Map([[1, "Ami"]])}
      ownerSeat={3}
      mine={1}
      displaced={false}
      onTake={vi.fn()}
      onAsk={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText("chef de la salle")).not.toBeInTheDocument();
});

describe("ce qu'un toucher fait, écrit et pas seulement en infobulle (audit T10)", () => {
  const rendre = (mine: number | null, busy = [false, true, false, false]) =>
    render(
      <Seats
        players={4}
        busy={busy}
        mics={[false, false, false, false]}
        names={new Map([[2, "Bo"]])}
        mine={mine}
        displaced={false}
        onTake={vi.fn()}
        onAsk={vi.fn()}
      />,
    );

  it("dit à qui regarde comment prendre ou demander une place", () => {
    rendre(null);
    expect(
      screen.getByText("Choisis une place libre. Une place prise se demande à son joueur."),
    ).toBeVisible();
  });

  it("dit sa place à qui joue, et comment en changer", () => {
    rendre(1, [true, true, false, false]);
    expect(
      screen.getByText("Tu es à la place 1. Une place prise se demande à son joueur."),
    ).toBeVisible();
  });

  it("dit qu'il faut toucher encore une place tenue par personne", () => {
    rendre(null, [false, false, true, false]);
    fireEvent.click(document.querySelector("#port3")!);
    expect(
      screen.getByText("Personne ne répond sur cette place : touche-la encore pour la reprendre."),
    ).toBeVisible();
  });
});
