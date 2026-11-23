/** « Ils regardent » en étiquettes, et qui arrive sans place annoncée (T14). */
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Person } from "../client";
import { COLONNE, REGARDENT } from "../lib/mots";
import { IlsRegardent } from "./IlsRegardent";

const personne = (id: string, name: string, extra: Partial<Person> = {}): Person =>
  ({ id, name, seat: null, seat_pending: false, ...extra }) as Person;

it("montre chaque spectateur en étiquette tapée, et les compte", () => {
  render(<IlsRegardent people={[personne("a", "Lina"), personne("b", "Nour")]} />);
  expect(screen.getByRole("heading")).toHaveTextContent(`${COLONNE.regardent} · 2`);
  const etiquettes = document.querySelectorAll(".n3-etiquette");
  expect(etiquettes).toHaveLength(2);
  expect([...etiquettes].map((e) => e.querySelector(".sr-only")?.textContent)).toEqual([
    "Lina",
    "Nour",
  ]);
});

it("dit qui arrive sans place annoncée, avec son étiquette, hors du compte", () => {
  render(
    <IlsRegardent
      people={[personne("a", "Lina"), personne("s", "Sami", { seat_pending: true })]}
    />,
  );
  expect(screen.getByText(REGARDENT.arrive("Sami"))).toBeVisible();
  expect(screen.getByRole("heading")).toHaveTextContent(`${COLONNE.regardent} · 1`);
});

it("jumeau : un spectateur confirmé n'est jamais dit « arrive »", () => {
  render(<IlsRegardent people={[personne("a", "Lina")]} />);
  expect(screen.queryByText(/arrive :/)).toBeNull();
});

it("jumeau : une personne assise n'y est pas", () => {
  render(<IlsRegardent people={[personne("a", "Lina", { seat: 2 } as Partial<Person>)]} />);
  expect(document.querySelector(".n3-etiquette")).toBeNull();
  expect(screen.getByText(COLONNE.personne)).toBeVisible();
});

it("la couronne suit qui choisit le jeu", () => {
  render(
    <IlsRegardent
      people={[personne("a", "Lina"), personne("b", "Nour")]}
      owner={personne("b", "Nour")}
    />,
  );
  const items = screen.getAllByRole("listitem");
  expect(items[0].querySelector(".n3-couronne")).toBeNull();
  expect(items[1].querySelector(".n3-couronne")).not.toBeNull();
});
