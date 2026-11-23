import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Arbitre } from "../lib/scenes-salle";
import { ContexteArbitre } from "./Cadre";
import { EcranEteint, phraseDuRepos } from "./EcranEteint";

const arbitre = () => {
  const demander = vi.fn<Arbitre["demander"]>(() => null);
  const a: Arbitre = { demander, couper: vi.fn(), enCours: () => null };
  return { a, demander };
};

const monter = (a: Arbitre, phrase: string | null, onChoisir = () => {}) =>
  render(
    <ContexteArbitre.Provider value={a}>
      <EcranEteint phrase={phrase} onChoisir={onChoisir} />
    </ContexteArbitre.Provider>,
  );

describe("l'écran éteint", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("à qui choisit : « Choisir un jeu », seul bouton, avec le focus", () => {
    const choisir = vi.fn();
    monter(arbitre().a, null, choisir);
    expect(screen.getByText("Pas encore de jeu.")).toBeTruthy();
    const bouton = document.getElementById("choisirJeu");
    expect(document.activeElement).toBe(bouton);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(bouton!);
    expect(choisir).toHaveBeenCalledOnce();
  });

  it("aux autres : qui choisit, et aucun bouton", () => {
    monter(arbitre().a, "Bo choisit le jeu. Tu le verras démarrer ici.");
    expect(document.getElementById("choisirJeu")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Bo choisit le jeu. Tu le verras démarrer ici.")).toBeTruthy();
  });

  it("ne vole pas un focus déjà posé ailleurs", () => {
    const ailleurs = document.createElement("button");
    document.body.append(ailleurs);
    ailleurs.focus();
    monter(arbitre().a, null);
    expect(document.activeElement).toBe(ailleurs);
    ailleurs.remove();
  });

  it("joue « attente » sur le plateau à 2,5 s, 8,5 s et 14,5 s, par la salle", () => {
    const { a, demander } = arbitre();
    monter(a, null);
    act(() => vi.advanceTimersByTime(2499));
    expect(demander).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(demander).toHaveBeenLastCalledWith({ scene: "attente", par: "salle", hote: "plateau" });
    act(() => vi.advanceTimersByTime(60_000));
    expect(demander).toHaveBeenCalledTimes(3);
  });

  it("se tait après un geste", () => {
    const { a, demander } = arbitre();
    monter(a, null);
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.pointerDown(window);
    act(() => vi.advanceTimersByTime(60_000));
    expect(demander).toHaveBeenCalledTimes(1);
  });

  it("se tait démonté", () => {
    const { a, demander } = arbitre();
    const { unmount } = monter(a, null);
    unmount();
    act(() => vi.advanceTimersByTime(60_000));
    expect(demander).not.toHaveBeenCalled();
  });

  it("reprend le focus à la zone de jeu, qui n'envoie rien sans jeu", () => {
    const zone = document.createElement("div");
    zone.setAttribute("data-zone-jeu", "");
    zone.tabIndex = 0;
    document.body.append(zone);
    zone.focus();
    monter(arbitre().a, null);
    expect(document.activeElement?.id).toBe("choisirJeu");
    zone.remove();
  });

  it("porte l'hôte du plateau", () => {
    const { container } = monter(arbitre().a, null);
    expect(container.querySelector('[data-hote="plateau"]')).not.toBeNull();
  });
});

describe("la phrase du repos", () => {
  const role = { port: 2, mine: false, chef: "Bo", moi: false };
  it("qui choisit n'a pas de phrase", () => {
    expect(phraseDuRepos({ ...role, mine: true }, null)).toBeNull();
  });
  it("les autres lisent qui choisit, et qu'ils le verront ici", () => {
    expect(phraseDuRepos(role, "Bo choisit le jeu.")).toBe(
      "Bo choisit le jeu. Tu le verras démarrer ici.",
    );
    expect(phraseDuRepos({ ...role, port: null }, "Prends une place pour changer de jeu.")).toBe(
      "Bo choisit le jeu. Tu le verras démarrer ici.",
    );
  });
  it("qui décide sans pouvoir choisir lit la raison, sans promesse", () => {
    expect(phraseDuRepos({ ...role, mine: true }, "Bo ne joue plus.")).toBe("Bo ne joue plus.");
  });
  it("sans chef, la phrase ne nomme personne", () => {
    expect(phraseDuRepos({ ...role, chef: null }, "x")).toBe(
      "Quelqu'un choisit le jeu. Tu le verras démarrer ici.",
    );
  });
});
