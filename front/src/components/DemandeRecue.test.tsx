import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuAction } from "../media/menupad";
import { DON_ANNULABLE_MS, useDonDiffere } from "../lib/usePlaces";
import { DemandeRecue, type DemandeEnCours } from "./DemandeRecue";

const demande = (d: Partial<DemandeEnCours> = {}): DemandeEnCours => ({
  from: "Lina",
  port: 2,
  lasts: 20,
  chemin: "reprise",
  ...d,
});
const rien = { onGarder: () => {}, onDonner: () => {}, onAnnulerDon: () => {} };

describe("la demande reçue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("dit qui demande quelle place, et la règle de la reprise", () => {
    render(<DemandeRecue {...rien} demande={demande()} />);
    expect(screen.getByRole("heading").textContent).toBe("Lina demande ta place 2");
    expect(document.querySelector("#demandeRecue")?.textContent).toContain(
      "Sans réponse dans 20 s, Lina pourra la prendre.",
    );
  });

  it("dit la règle de l'ancienne demande : le silence garde la place", () => {
    render(<DemandeRecue {...rien} demande={demande({ chemin: "ancienne", lasts: 10 })} />);
    expect(document.querySelector("#demandeRecue")?.textContent).toContain(
      "Sans réponse dans 10 s, tu la gardes.",
    );
    expect(document.querySelector("#keepSeat")).not.toBeNull();
    expect(document.querySelector("#giveSeat")).not.toBeNull();
  });

  it("« Garder ma place » est le premier bouton et le seul plein", () => {
    render(<DemandeRecue {...rien} demande={demande()} />);
    const boutons = [...document.querySelectorAll("#demandeRecue button")];
    expect(boutons[0]?.id).toBe("keepRecovery");
    expect(boutons.filter((b) => b.classList.contains("rt-bouton-plein"))).toEqual([boutons[0]]);
  });

  it("ne prend pas le focus et ne parle pas en région vivante", () => {
    const jeu = document.createElement("div");
    jeu.tabIndex = 0;
    document.body.append(jeu);
    jeu.focus();
    render(<DemandeRecue {...rien} demande={demande()} />);
    expect(document.activeElement).toBe(jeu);
    expect(document.querySelector("[role=alert], [role=status], [aria-live]")).toBeNull();
    jeu.remove();
  });

  it("la phrase ne contient aucun nombre qui avance", () => {
    render(<DemandeRecue {...rien} demande={demande()} />);
    const avant = document.querySelector("#demandeRecue p")?.textContent;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(document.querySelector("#demandeRecue p")?.textContent).toBe(avant);
  });

  it("la manette garde la place, et ne peut jamais la donner", () => {
    const onGarder = vi.fn();
    const onDonner = vi.fn();
    let manette: ((a: MenuAction) => void) | null = null;
    render(
      <DemandeRecue
        {...rien}
        demande={demande()}
        onGarder={onGarder}
        onDonner={onDonner}
        pad={(h) => {
          manette = h;
        }}
      />,
    );
    for (const action of ["confirm", "back", "up", "down", "left", "right"] as MenuAction[]) {
      act(() => manette?.(action));
    }
    expect(onGarder).toHaveBeenCalledTimes(1);
    expect(onDonner).not.toHaveBeenCalled();
  });

  it("l'ancienne demande expire seule à son terme", () => {
    const onExpire = vi.fn();
    render(
      <DemandeRecue
        {...rien}
        demande={demande({ chemin: "ancienne", lasts: 10 })}
        onExpire={onExpire}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(onExpire).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("pendant le don, dit à qui va la place et propose d'annuler", () => {
    const onAnnulerDon = vi.fn();
    render(<DemandeRecue {...rien} demande={demande()} donne onAnnulerDon={onAnnulerDon} />);
    expect(screen.getByRole("heading").textContent).toBe("Tu donnes ta place 2 à Lina");
    fireEvent.click(screen.getByText("Annuler"));
    expect(onAnnulerDon).toHaveBeenCalled();
  });

  it("dit la fin une fois, et propose de redemander une place", () => {
    const onRedemander = vi.fn();
    render(
      <DemandeRecue
        {...rien}
        demande={null}
        fin={{ nom: "Lina", port: 2 }}
        onRedemander={onRedemander}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe("Lina a pris ta place 2.");
    fireEvent.click(screen.getByText("Redemander une place"));
    expect(onRedemander).toHaveBeenCalled();
  });
});

describe("le don différé de 4 s", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("n'envoie rien avant 4 s, puis envoie oui", () => {
    const envoyer = vi.fn();
    const { result } = renderHook(() => useDonDiffere(envoyer));
    act(() => result.current.donner());
    expect(result.current.donne).toBe(true);
    act(() => {
      vi.advanceTimersByTime(DON_ANNULABLE_MS - 100);
    });
    expect(envoyer).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(envoyer.mock.calls).toEqual([[true]]);
    expect(result.current.donne).toBe(false);
  });

  it("« Annuler » à 2 s : aucune réponse envoyée, la demande revient", () => {
    const envoyer = vi.fn();
    const { result } = renderHook(() => useDonDiffere(envoyer));
    act(() => result.current.donner());
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => result.current.annuler());
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(envoyer).not.toHaveBeenCalled();
    expect(result.current.donne).toBe(false);
  });

  it("« Garder » part tout de suite et annule un don en attente", () => {
    const envoyer = vi.fn();
    const { result } = renderHook(() => useDonDiffere(envoyer));
    act(() => result.current.donner());
    act(() => result.current.garder());
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(envoyer.mock.calls).toEqual([[false]]);
  });
});
