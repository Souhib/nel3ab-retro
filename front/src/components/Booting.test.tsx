import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Arbitre } from "../lib/scenes-salle";
import { Booting } from "./Booting";
import { ContexteArbitre } from "./Cadre";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("laisse attendre en paix, puis ouvre une sortie quand l'attente devient longue", () => {
  render(<Booting game="Mario Kart" step="waiting" onGiveUp={vi.fn()} />);
  // Le jumeau négatif, et il compte autant que le reste: une dizaine de
  // secondes de noir est NORMALE, et proposer d'annuler tout de suite ferait
  // croire à une panne à chaque lancement.
  expect(screen.queryByRole("button", { name: "arrêter d'attendre" })).toBeNull();
  act(() => vi.advanceTimersByTime(20_000));
  expect(screen.getByRole("button", { name: "arrêter d'attendre" })).toBeVisible();
});

it("n'a plus de bouton de menu : « Menu du jeu » de la colonne l'ouvre à côté (C2)", () => {
  // Depuis le menu unique (24 novembre 2026), le menu ne se pose plus sur
  // l'écran de chargement : il s'ouvre dans la colonne, à côté.
  render(<Booting game="Mario Kart" step="asked" stalled onGiveUp={vi.fn()} />);
  act(() => vi.advanceTimersByTime(60_000));
  expect(document.getElementById("bootingMenu")).toBeNull();
  expect(screen.queryByRole("button", { name: /menu/ })).toBeNull();
});

it("l'écran qui a cessé d'attendre le dit, au lieu de s'effacer sur du noir", () => {
  const abandon = vi.fn();
  render(<Booting game="Mario Kart" step="asked" stalled onGiveUp={abandon} />);
  expect(screen.getByText(/n’a pas démarré/)).toBeVisible();
  expect(screen.getByRole("button", { name: "arrêter d'attendre" })).toBeVisible();
});

it("sans sortie fournie, l'écran reste ce qu'il était", () => {
  render(<Booting game="Mario Kart" step="painting" />);
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.queryByRole("button")).toBeNull();
});

describe("le chargement réécrit (C5, C11, C12, D05)", () => {
  const habitude = { mediane_s: 12, p90_s: 17.2, n: 6 };
  const avecArbitre = (ui: ReactNode) => {
    const demander = vi.fn<Arbitre["demander"]>(() => null);
    const a: Arbitre = { demander, couper: vi.fn(), enCours: () => null };
    const vue = render(<ContexteArbitre.Provider value={a}>{ui}</ContexteArbitre.Provider>);
    return { demander, ...vue };
  };
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      // jsdom a un stockage ; rien à vider sinon.
    }
  });

  it("le titre dit le fait en casse de phrase, sans sur-titre en capitales", () => {
    const { container } = render(<Booting game="Mario Kart" step="waiting" />);
    expect(screen.getByRole("heading").textContent).toBe("Mario Kart démarre.");
    expect(container.querySelector(".uppercase")).toBeNull();
    // La bobine de Bobine laisse la place au plateau d'Aïn.
    expect(container.querySelector('[data-hote="plateau"]')).not.toBeNull();
  });

  it("une habitude mesurée se dit, et la lenteur arrive à son 90e centile", () => {
    render(<Booting game="Mario Kart" step="waiting" habitude={habitude} />);
    expect(screen.getByText("D'habitude, il démarre en 12 s.")).toBeVisible();
    act(() => vi.advanceTimersByTime(17_000));
    expect(screen.queryByText(/plus longtemps/)).toBeNull();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("Le jeu met plus longtemps que d'habitude.")).toBeVisible();
  });

  it("sans habitude mesurée, rien ne dit « d'habitude »", () => {
    const { container } = render(
      <Booting game="Mario Kart" step="waiting" habitude={{ ...habitude, n: 4 }} />,
    );
    act(() => vi.advanceTimersByTime(20_000));
    expect(container.textContent).not.toMatch(/habitude/);
    expect(screen.getByText("Le jeu démarre encore, depuis 20 s.")).toBeVisible();
  });

  it("Aïn cherche une fois par jeu, en entier au premier chargement de la soirée, puis attend une fois", () => {
    const { demander, rerender } = avecArbitre(<Booting game="Mario Kart" step="asked" />);
    expect(demander).toHaveBeenCalledOnce();
    expect(demander.mock.calls[0]?.[0]).toMatchObject({
      scene: "chercher",
      par: "menus",
      hote: "plateau",
      version: "complete",
    });
    // Un rendu de plus du même chargement ne rejoue rien.
    rerender(
      <ContexteArbitre.Provider value={{ demander, couper: vi.fn(), enCours: () => null }}>
        <Booting game="Mario Kart" step="waiting" />
      </ContexteArbitre.Provider>,
    );
    act(() => vi.advanceTimersByTime(20_000));
    const scenes = () => demander.mock.calls.map((c) => c[0].scene);
    expect(scenes()).toEqual(["chercher", "attente-chargement"]);
    // Rester long ne rejoue rien.
    act(() => vi.advanceTimersByTime(10_000));
    expect(scenes()).toEqual(["chercher", "attente-chargement"]);
  });

  it("le chargement suivant de la soirée cherche en court ; un écran calé n'attend pas", () => {
    avecArbitre(<Booting game="Mario Kart" step="asked" />).unmount();
    const { demander } = avecArbitre(<Booting game="Zelda" step="asked" stalled />);
    expect(demander.mock.calls[0]?.[0]).toMatchObject({ scene: "chercher", version: "courte" });
    act(() => vi.advanceTimersByTime(30_000));
    expect(demander.mock.calls.map((c) => c[0].scene)).toEqual(["chercher"]);
  });
});
