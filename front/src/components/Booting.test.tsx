import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Arbitre } from "../lib/scenes-salle";
import { Booting } from "./Booting";
import { ContexteArbitre } from "./Cadre";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Le bouton Signaler de la page, remplacé dans ces essais. */
const signaler = <button type="button">Signaler</button>;
const boutons = () => screen.queryAllByRole("button").map((b) => b.textContent);

describe("les gestes du chargement, par rôle (C7a)", () => {
  it("laisse attendre en paix, puis offre ses gestes quand l'attente devient longue", () => {
    render(
      <Booting game="Mario Kart" step="waiting" choisit onArreter={vi.fn()} signaler={signaler} />,
    );
    // Le jumeau négatif, et il compte autant que le reste : une dizaine de
    // secondes de noir est NORMALE, et proposer d'arrêter tout de suite ferait
    // croire à une panne à chaque lancement.
    act(() => vi.advanceTimersByTime(10_000));
    expect(boutons()).toEqual([]);
    act(() => vi.advanceTimersByTime(11_000));
    expect(boutons()).toEqual(["Arrêter le lancement", "Signaler"]);
  });

  it("à qui ne choisit pas le jeu, seulement Signaler", () => {
    render(<Booting game="Mario Kart" step="waiting" onArreter={vi.fn()} signaler={signaler} />);
    act(() => vi.advanceTimersByTime(21_000));
    expect(boutons()).toEqual(["Signaler"]);
  });

  it("« Arrêter le lancement » appelle sa sortie", () => {
    const arreter = vi.fn();
    render(<Booting game="Mario Kart" step="waiting" choisit onArreter={arreter} />);
    act(() => vi.advanceTimersByTime(21_000));
    act(() => screen.getByRole("button", { name: "Arrêter le lancement" }).click());
    expect(arreter).toHaveBeenCalledOnce();
  });

  it("sans image, qui choisit en choisit un autre ; les autres lisent qui peut relancer", () => {
    const autre = vi.fn();
    const { unmount } = render(
      <Booting
        game="Mario Kart"
        step="asked"
        stalled
        choisit
        onAutre={autre}
        signaler={signaler}
      />,
    );
    expect(boutons()).toEqual(["Choisir un autre jeu", "Signaler"]);
    act(() => screen.getByRole("button", { name: "Choisir un autre jeu" }).click());
    expect(autre).toHaveBeenCalledOnce();
    expect(screen.queryByText(/peut le relancer/)).toBeNull();
    unmount();
    render(
      <Booting game="Mario Kart" step="asked" stalled quiChoisit="Sami" signaler={signaler} />,
    );
    expect(boutons()).toEqual(["Signaler"]);
    expect(screen.getByText("Sami peut le relancer ou choisir un autre jeu.")).toBeVisible();
  });

  it("n'a plus de bouton de menu : « Menu du jeu » de la colonne l'ouvre à côté (C2)", () => {
    render(<Booting game="Mario Kart" step="asked" stalled choisit onAutre={vi.fn()} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(document.getElementById("bootingMenu")).toBeNull();
    expect(screen.queryByRole("button", { name: /menu/ })).toBeNull();
  });
});

describe("les étapes en cases (C4)", () => {
  const etats = (c: HTMLElement) =>
    [...c.querySelectorAll("#booting li")].map((li) => li.getAttribute("data-case"));

  it("trois cases qui suivent l'étape, puis le point d'interrogation et la croix", () => {
    const { container, rerender } = render(<Booting game="Mario Kart" step="waiting" />);
    expect(etats(container)).toEqual(["faite", "en-cours", "a-venir"]);
    // Le compteur de la case en cours est écrit par l'afficheur du socle.
    act(() => vi.advanceTimersByTime(12_000));
    expect(container.querySelector(".n3-charge-compteur")?.textContent).toContain("12 s");
    act(() => vi.advanceTimersByTime(9_000));
    expect(etats(container)).toEqual(["faite", "inconnue", "a-venir"]);
    rerender(<Booting game="Mario Kart" step="waiting" stalled />);
    expect(etats(container)).toEqual(["faite", "inconnue", "echec"]);
    expect(screen.getByText("Aucune image en 21 s.")).toBeVisible();
  });

  it("la mire du démarrage a sept barres, cachées aux lecteurs d'écran", () => {
    const { container } = render(<Booting game="Mario Kart" step="waiting" />);
    const mire = container.querySelector("#booting .rt-mire-charge");
    expect(mire?.children).toHaveLength(7);
    expect(mire?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("qui a lancé, sur quoi (C6)", () => {
  it("à qui a lancé, « Sur ta sauvegarde. », sans étiquette", () => {
    const { container } = render(
      <Booting
        game="Mario Kart"
        step="asked"
        sauvegarde={{ qui: "moi", texte: "Sur ta sauvegarde." }}
      />,
    );
    expect(screen.getByText("Sur ta sauvegarde.")).toBeVisible();
    expect(container.querySelector("#booting .n3-etiquette")).toBeNull();
  });

  it("aux autres, l'étiquette de qui a lancé, à la couleur de sa place", () => {
    const { container } = render(
      <Booting
        game="Mario Kart"
        step="asked"
        sauvegarde={{ qui: "autre", nom: "Bo", place: 3, texte: "l'a lancé sur sa sauvegarde." }}
      />,
    );
    const etiquette = container.querySelector("#booting .n3-etiquette");
    expect(etiquette?.getAttribute("data-place")).toBe("3");
    expect(container.querySelector(".n3-charge-sauvegarde")?.textContent).toMatch(
      /Bo.*l'a lancé sur sa sauvegarde\./,
    );
  });
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
