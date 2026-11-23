import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecoveryNotice } from "../lib/room";
import type { MenuAction } from "../media/menupad";
import { CartePlace } from "./CartePlace";

const notice = (n: Partial<RecoveryNotice> = {}): RecoveryNotice => ({
  id: "r1",
  port: 2,
  from: "Moi",
  to: "Bilel",
  asking: true,
  remaining: 20,
  reason: null,
  ...n,
});

const rien = {
  onDemander: () => {},
  onPrendre: () => {},
  onAction: () => {},
  onFermer: () => {},
};

describe("la carte d'une place", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("dit à qui est la place et ce que fait le silence, selon la vraie règle du salon", () => {
    const onDemander = vi.fn();
    render(
      <CartePlace
        {...rien}
        sujet={{ type: "autre", port: 2, nom: "Bilel", delai: 20 }}
        notice={null}
        onDemander={onDemander}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe("La place 2 est à Bilel");
    expect(document.querySelector("#cartePlace")?.textContent).toContain(
      "Bilel a 20 s pour répondre. Sans réponse, tu pourras prendre la place 2.",
    );
    fireEvent.click(screen.getByText("Lui demander sa place"));
    expect(onDemander).toHaveBeenCalledWith(2);
  });

  it("prend le focus sur son titre en s'ouvrant", () => {
    render(<CartePlace {...rien} sujet={{ type: "sans-nom", port: 3 }} notice={null} />);
    expect(document.activeElement?.id).toBe("cartePlaceTitre");
    // Le jumeau : une carte qui ne doit pas prendre le focus le laisse.
    document.body.focus();
  });

  it("ne prend pas le focus quand on le lui interdit", () => {
    const ailleurs = document.createElement("button");
    document.body.append(ailleurs);
    ailleurs.focus();
    render(
      <CartePlace {...rien} focus={false} sujet={{ type: "sans-nom", port: 3 }} notice={null} />,
    );
    expect(document.activeElement).toBe(ailleurs);
    ailleurs.remove();
  });

  it("une place sans nom n'envoie aucune demande : elle se reprend", () => {
    const onDemander = vi.fn();
    const onPrendre = vi.fn();
    render(
      <CartePlace
        {...rien}
        sujet={{ type: "sans-nom", port: 3 }}
        notice={null}
        onDemander={onDemander}
        onPrendre={onPrendre}
      />,
    );
    fireEvent.click(screen.getByText("Reprendre la place 3"));
    expect(onPrendre).toHaveBeenCalledWith(3);
    expect(onDemander).not.toHaveBeenCalled();
  });

  it("pendant l'attente, « Prendre la place 2 » attend le délai, et le silence seul ne prend rien", () => {
    const onAction = vi.fn();
    render(<CartePlace {...rien} sujet={null} notice={notice()} onAction={onAction} />);
    expect(screen.getByRole("heading").textContent).toBe("Ta demande est chez Bilel");
    const prendre = document.querySelector<HTMLButtonElement>("#confirmRecovery")!;
    expect(prendre.textContent).toBe("Prendre la place 2");
    expect(prendre.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(prendre);
    expect(onAction).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByRole("heading").textContent).toBe("Bilel n'a pas répondu");
    // Le délai passé ne prend rien de lui-même.
    expect(onAction).not.toHaveBeenCalled();
    expect(prendre.hasAttribute("aria-disabled")).toBe(false);
    fireEvent.click(prendre);
    expect(onAction).toHaveBeenCalledWith({ action: "finish", id: "r1" });
  });

  it("annule la demande", () => {
    const onAction = vi.fn();
    render(<CartePlace {...rien} sujet={null} notice={notice()} onAction={onAction} />);
    fireEvent.click(screen.getByText("Annuler la demande"));
    expect(onAction).toHaveBeenCalledWith({ action: "cancel", id: "r1" });
  });

  it("la manette ne confirme qu'après le délai", () => {
    const onAction = vi.fn();
    let manette: ((a: MenuAction) => void) | null = null;
    render(
      <CartePlace
        {...rien}
        sujet={null}
        notice={notice({ remaining: 2 })}
        onAction={onAction}
        pad={(h) => {
          manette = h;
        }}
      />,
    );
    act(() => manette?.("confirm"));
    expect(onAction).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => manette?.("confirm"));
    expect(onAction).toHaveBeenCalledWith({ action: "finish", id: "r1" });
  });

  it("dit le refus du salon tel quel, et propose la place libre", () => {
    const onPrendre = vi.fn();
    render(
      <CartePlace
        {...rien}
        sujet={null}
        notice={notice({ reason: "Bilel garde sa place 2.", asking: true })}
        libre={3}
        onPrendre={onPrendre}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe("Bilel garde sa place 2.");
    fireEvent.click(screen.getByText("Prendre la place 3"));
    expect(onPrendre).toHaveBeenCalledWith(3);
    // Le jumeau : rien à confirmer après un refus.
    expect(document.querySelector("#confirmRecovery")).toBeNull();
  });

  it("la carte de sa place propose de la rendre, sans lien qui quitte la salle", () => {
    const onRendre = vi.fn();
    render(
      <CartePlace
        {...rien}
        sujet={{ type: "mienne", port: 2, comment: "au clavier" }}
        notice={null}
        onRendre={onRendre}
      />,
    );
    expect(document.querySelector("#cartePlace")?.textContent).toContain(
      "Tu joues au clavier. Ton nom se change entre deux parties, depuis l'avant-salle.",
    );
    fireEvent.click(screen.getByText("Rendre ma place"));
    expect(onRendre).toHaveBeenCalled();
    expect(document.querySelector("#cartePlace a[href]")).toBeNull();
  });

  it("la carte d'une autre place ne propose jamais « Rendre ma place »", () => {
    render(
      <CartePlace
        {...rien}
        sujet={{ type: "autre", port: 1, nom: "Bo", delai: 20 }}
        notice={null}
        onRendre={() => {}}
      />,
    );
    expect(screen.queryByText("Rendre ma place")).toBeNull();
  });

  it("ne parle pas en région vivante : aucune alerte ni statut", () => {
    render(<CartePlace {...rien} sujet={null} notice={notice()} erreur="Pas de réponse." />);
    expect(document.querySelector("[role=alert], [role=status], [aria-live]")).toBeNull();
  });

  it("n'existe pas sans sujet, sans demande et sans erreur", () => {
    render(<CartePlace {...rien} sujet={null} notice={null} />);
    expect(document.querySelector("#cartePlace")).toBeNull();
  });
});
