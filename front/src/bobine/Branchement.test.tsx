import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Seats } from "../components/Seats";
import { CHRONO } from "./Branchement";

const base = {
  players: 4,
  mics: [false, false, false, false],
  mine: null,
  displaced: false,
  onTake: vi.fn(),
  onAsk: vi.fn(),
};

/** La fiche d'une prise se lit à sa couleur: libre, elle montre ses broches. */
const branchee = (port: number) =>
  document.querySelector(`#port${port} path[fill^="#"]:not([fill="#07070b"])`) !== null;

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

it("une première arrivée cache la fiche jusqu'à ce que Bobine l'enfonce", () => {
  const { rerender } = render(
    <Seats {...base} busy={[false, false, false, false]} names={new Map()} />,
  );
  rerender(<Seats {...base} busy={[false, true, false, false]} names={new Map([[2, "Bo"]])} />);
  // La scène est là, la prise se dessine encore libre, et le nom attend.
  expect(document.querySelector(".n3-scene")).not.toBeNull();
  expect(branchee(2)).toBe(false);
  expect(document.querySelector("#port2")?.textContent).not.toContain("Bo");
  act(() => {
    vi.advanceTimersByTime(CHRONO.branche + 20);
  });
  expect(branchee(2)).toBe(true);
  expect(document.querySelector("#port2")?.textContent).toContain("Bo");
  act(() => {
    vi.advanceTimersByTime(CHRONO.fin);
  });
  expect(document.querySelector(".n3-scene")).toBeNull();
});

it("un retour ne rejoue pas la scène: la fiche claque tout de suite", () => {
  window.localStorage.setItem("n3-bobine-vus:1", JSON.stringify(["Bo"]));
  const { rerender } = render(
    <Seats {...base} busy={[false, false, false, false]} names={new Map()} />,
  );
  rerender(<Seats {...base} busy={[false, true, false, false]} names={new Map([[2, "Bo"]])} />);
  expect(document.querySelector(".n3-scene")).toBeNull();
  expect(branchee(2)).toBe(true);
  expect(document.querySelector("#port2 .n3-fiche-claque")).not.toBeNull();
});

it("ouvrir la page sur une salle pleine ne joue aucune scène", () => {
  render(
    <Seats
      {...base}
      busy={[true, true, true, true]}
      names={
        new Map([
          [1, "Ami"],
          [2, "Bo"],
        ])
      }
    />,
  );
  expect(document.querySelector(".n3-scene")).toBeNull();
  expect(document.querySelector(".n3-fiche-claque")).toBeNull();
  expect(branchee(1)).toBe(true);
});

it("une prise libérée laisse sauter sa fiche, puis montre ses broches", () => {
  const avec = new Map([[3, "Cléo"]]);
  const { rerender } = render(<Seats {...base} busy={[false, false, true, false]} names={avec} />);
  rerender(<Seats {...base} busy={[false, false, false, false]} names={new Map()} />);
  expect(document.querySelector("#port3 .n3-fiche-saute")).not.toBeNull();
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(document.querySelector("#port3 .n3-fiche-saute")).toBeNull();
});

it("sans mouvement permis, l'arrivée branche tout de suite et sans scène", () => {
  const avant = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduce"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  try {
    const { rerender } = render(
      <Seats {...base} busy={[false, false, false, false]} names={new Map()} />,
    );
    rerender(<Seats {...base} busy={[true, false, false, false]} names={new Map([[1, "Ami"]])} />);
    expect(document.querySelector(".n3-scene")).toBeNull();
    expect(branchee(1)).toBe(true);
  } finally {
    window.matchMedia = avant;
  }
});

it("le salon annonce une première fois: la scène se joue même pour un nom déjà vu ici", () => {
  window.localStorage.setItem("n3-bobine-vus:1", JSON.stringify(["Bo"]));
  const { rerender } = render(
    <Seats {...base} busy={[false, false, false, false]} names={new Map()} />,
  );
  rerender(
    <Seats
      {...base}
      busy={[false, true, false, false]}
      names={new Map([[2, "Bo"]])}
      premieres={new Map([[2, true]])}
    />,
  );
  expect(document.querySelector(".n3-scene")).not.toBeNull();
  expect(branchee(2)).toBe(false);
});

it("le salon annonce un retour: la fiche claque, même dans un navigateur neuf", () => {
  const { rerender } = render(
    <Seats {...base} busy={[false, false, false, false]} names={new Map()} />,
  );
  rerender(
    <Seats
      {...base}
      busy={[false, true, false, false]}
      names={new Map([[2, "Bo"]])}
      premieres={new Map([[2, false]])}
    />,
  );
  expect(document.querySelector(".n3-scene")).toBeNull();
  expect(document.querySelector("#port2 .n3-fiche-claque")).not.toBeNull();
});
