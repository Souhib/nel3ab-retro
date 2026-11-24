import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Reprise } from "../lib/places";
import type { MenuAction } from "../media/menupad";
import { CartePlace } from "./CartePlace";

const notice = (n: Partial<Reprise> = {}): Reprise => ({
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

  /* « Donner ma place » : le salon renvoie à qui demande `remaining` 0 sans
     raison (`Recovery.remaining` rend 0 une fois acceptée). La carte n'avait
     qu'une lecture d'un reste à 0, le silence, et affirmait « Bilel n'a pas
     répondu » après un oui (relecture du 24 novembre 2026). */
  it("une place donnée se dit donnée, jamais un silence, et se prend tout de suite", () => {
    const onAction = vi.fn();
    const { rerender } = render(
      <CartePlace {...rien} sujet={null} notice={notice()} onAction={onAction} />,
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    rerender(
      <CartePlace
        {...rien}
        sujet={null}
        notice={notice({ remaining: 0, accepted: true })}
        onAction={onAction}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe("Bilel te laisse sa place 2.");
    expect(document.body.textContent).not.toContain("n'a pas répondu");
    const prendre = document.querySelector<HTMLButtonElement>("#confirmRecovery")!;
    expect(prendre.hasAttribute("aria-disabled")).toBe(false);
    fireEvent.click(prendre);
    expect(onAction).toHaveBeenCalledWith({ action: "finish", id: "r1" });
  });

  it("jumeau : un salon d'avant le champ « accepted » laisse une phrase neutre, pas un silence", () => {
    render(<CartePlace {...rien} sujet={null} notice={notice({ remaining: 0 })} />);
    expect(screen.getByRole("heading").textContent).toBe("Tu peux prendre la place 2.");
    expect(document.body.textContent).not.toContain("n'a pas répondu");
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

  /* Le salon envoie la même raison à qui demande ET à qui tient la place
     (`recovery.py`, `notify`). Montée pour qui tient la place, la carte
     prenait le focus à la zone de jeu et lui proposait « Prendre la place 3 »
     d'une place libre : un joueur au clavier qui gardait sa place perdait
     ses touches (relecture du 24 novembre 2026). */
  it.each([
    ["un refus", "Ami garde sa place 1."],
    ["une annulation", "Demande annulée."],
    ["une expiration", "La demande a expiré ou la place a changé. Réessaie."],
    ["une reprise faite", "Bo reprend la place 1."],
  ])("pour qui tient la place, %s n'ouvre aucune carte et ne prend pas le focus", (_, reason) => {
    const jeu = document.createElement("div");
    jeu.tabIndex = 0;
    document.body.append(jeu);
    jeu.focus();
    render(
      <CartePlace
        {...rien}
        sujet={null}
        notice={notice({ port: 1, from: "Bo", to: "Ami", asking: false, remaining: 0, reason })}
        libre={3}
      />,
    );
    expect(document.querySelector("#cartePlace")).toBeNull();
    expect(screen.queryByText("Prendre la place 3")).toBeNull();
    expect(document.activeElement).toBe(jeu);
    jeu.remove();
  });

  it("jumeau : pour qui demande, la même raison ouvre la carte et propose la place libre", () => {
    render(
      <CartePlace
        {...rien}
        sujet={null}
        notice={notice({ asking: true, remaining: 0, reason: "Bilel garde sa place 2." })}
        libre={3}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe("Bilel garde sa place 2.");
    expect(screen.getByText("Prendre la place 3")).toBeTruthy();
  });

  it("une erreur seule se montre sans prendre le focus : la ligne parlée la dit", () => {
    const jeu = document.createElement("div");
    jeu.tabIndex = 0;
    document.body.append(jeu);
    jeu.focus();
    render(
      <CartePlace
        {...rien}
        sujet={null}
        notice={null}
        erreur="Cette demande ne t'est plus adressée."
      />,
    );
    expect(document.querySelector("#cartePlace")?.textContent).toContain(
      "Cette demande ne t'est plus adressée.",
    );
    expect(document.activeElement).toBe(jeu);
    jeu.remove();
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

/* Le focus autour de la carte (plan personnes, places-demande 1) : « Fermer »
   et Échap rendent le focus à la place qui l'a ouverte ; « Prendre » le pose
   sur la place prise ; Échap ailleurs garde son sens, le menu du jeu, que la
   salle ouvre depuis `window`. */
describe("la carte d'une place au clavier", () => {
  /** La salle en petit : deux places, une zone de jeu, la carte. Le parent
   * ferme la carte comme App.tsx (`setCarte(null)`). */
  function Salle({
    depart,
    notice: n = null,
    onFermer,
    onAction = rien.onAction,
  }: {
    depart: Parameters<typeof CartePlace>[0]["sujet"];
    notice?: Reprise | null;
    onFermer: () => void;
    onAction?: (a: Record<string, unknown>) => void;
  }) {
    const [sujet, setSujet] = useState(depart);
    return (
      <>
        <button type="button" id="zoneJeu">
          jeu
        </button>
        <button type="button" id="port2">
          2P
        </button>
        <button type="button" id="port3">
          3P
        </button>
        <CartePlace
          {...rien}
          sujet={sujet}
          notice={n}
          onAction={onAction}
          onPrendre={() => setSujet(null)}
          onFermer={() => {
            onFermer();
            setSujet(null);
          }}
        />
      </>
    );
  }
  const menu = vi.fn();
  beforeEach(() => {
    menu.mockReset();
    window.addEventListener("keydown", menu);
  });
  afterEach(() => window.removeEventListener("keydown", menu));
  const focus = () => document.activeElement?.id;

  it("Échap dans la carte la ferme et rend le focus à sa place, sans ouvrir le menu du jeu", () => {
    const onFermer = vi.fn();
    render(
      <Salle depart={{ type: "autre", port: 2, nom: "Bilel", delai: 20 }} onFermer={onFermer} />,
    );
    expect(focus()).toBe("cartePlaceTitre");
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(onFermer).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#cartePlace")).toBeNull();
    expect(focus()).toBe("port2");
    expect(menu).not.toHaveBeenCalled();
  });

  it("Échap sur la place qui l'a ouverte ferme aussi la carte", () => {
    const onFermer = vi.fn();
    render(
      <Salle depart={{ type: "autre", port: 2, nom: "Bilel", delai: 20 }} onFermer={onFermer} />,
    );
    act(() => (document.querySelector("#port2") as HTMLElement).focus());
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(onFermer).toHaveBeenCalledTimes(1);
    expect(focus()).toBe("port2");
  });

  it("Échap depuis la zone de jeu laisse la carte ouverte et ouvre le menu du jeu", () => {
    const onFermer = vi.fn();
    render(
      <Salle depart={{ type: "autre", port: 2, nom: "Bilel", delai: 20 }} onFermer={onFermer} />,
    );
    act(() => (document.querySelector("#zoneJeu") as HTMLElement).focus());
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(onFermer).not.toHaveBeenCalled();
    expect(document.querySelector("#cartePlace")).not.toBeNull();
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it("Échap sur une autre place n'est pas Échap sur la sienne", () => {
    const onFermer = vi.fn();
    render(
      <Salle depart={{ type: "autre", port: 2, nom: "Bilel", delai: 20 }} onFermer={onFermer} />,
    );
    act(() => (document.querySelector("#port3") as HTMLElement).focus());
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(onFermer).not.toHaveBeenCalled();
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it("« Fermer » rend le focus à la place", () => {
    const onFermer = vi.fn();
    render(
      <Salle depart={{ type: "mienne", port: 2, comment: "au clavier" }} onFermer={onFermer} />,
    );
    fireEvent.click(screen.getByText("Fermer"));
    expect(onFermer).toHaveBeenCalledTimes(1);
    expect(focus()).toBe("port2");
  });

  it("« Prendre » pose le focus sur la place prise", () => {
    render(<Salle depart={{ type: "sans-nom", port: 3 }} onFermer={() => {}} />);
    fireEvent.click(document.querySelector("#reprendrePlace") as Element);
    expect(document.querySelector("#cartePlace")).toBeNull();
    expect(focus()).toBe("port3");
  });

  it("pendant une demande en attente, Échap n'annule rien et ne ferme rien", () => {
    const onFermer = vi.fn();
    const onAction = vi.fn();
    render(<Salle depart={null} notice={notice()} onFermer={onFermer} onAction={onAction} />);
    expect(focus()).toBe("cartePlaceTitre");
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(onFermer).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
    expect(document.querySelector("#cartePlace")).not.toBeNull();
  });
});
