import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ligne } from "../lib/aide-clavier";
import type { Arbitre } from "../lib/scenes-salle";
import type { Activite } from "../lib/verification";
import { ContexteArbitre } from "./Cadre";
import { RELEVE_MS, VueTouches, type Releve } from "./VueTouches";

/** Une trame qui ne suit que ses boutons A et B : la ligne du stick n'a pas
 * de case. La vue ne sait pas d'où vient l'activité, elle la lit. */
const boutons = (presses: string[]): Activite => ({
  suivies: new Set(["A", "B"]),
  actives: new Set(presses),
});
const RIEN_SUIVI: Activite = { suivies: new Set(), actives: new Set() };

const LIGNES: Ligne[] = [
  { touches: "Flèches", fait: "stick", commandes: ["x", "y"] },
  { touches: "X", fait: "A", commandes: ["A"] },
  { touches: "C", fait: "B", commandes: ["B"] },
];

function monter(
  lire: () => Releve,
  { clavier = true, lignes = LIGNES }: { clavier?: boolean; lignes?: Ligne[] } = {},
) {
  const demander = vi.fn(() => null);
  const arbitre: Arbitre = { demander, couper: () => {}, enCours: () => null };
  const rendu = render(
    <ContexteArbitre.Provider value={arbitre}>
      <div data-zone-jeu="" tabIndex={0} id="zone" />
      <button type="button" id="ailleurs">
        ailleurs
      </button>
      <VueTouches
        titre="Tes touches au clavier"
        lignes={lignes}
        clavier={clavier}
        lire={lire}
        onRevenir={() => {}}
        onChanger={() => {}}
      />
    </ContexteArbitre.Provider>,
  );
  const ligne = (fait: string) =>
    [...rendu.container.querySelectorAll<HTMLElement>("[data-ligne-touche]")].find((li) =>
      li.textContent?.includes(fait),
    )!;
  return { ...rendu, demander, ligne };
}

describe("la vue des touches", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("une ligne par commande, et une case seulement quand la commande est suivie", () => {
    const { container, ligne } = monter(() => ({
      activite: boutons([]),
      sinceHeardMs: 100,
    }));
    expect(container.querySelector("#vueTouches")).not.toBeNull();
    expect(container.querySelectorAll("[data-ligne-touche]")).toHaveLength(3);
    expect(ligne("A").hasAttribute("data-suivie")).toBe(true);
    expect(ligne("stick").hasAttribute("data-suivie")).toBe(false);
  });

  it("A part au jeu avec le focus dans la zone : la ligne s'allume, puis reste cochée", () => {
    let presses: string[] = [];
    const { ligne } = monter(() => ({ activite: boutons(presses), sinceHeardMs: 100 }));
    act(() => document.getElementById("zone")!.focus());
    presses = ["A"];
    act(() => void vi.advanceTimersByTime(RELEVE_MS));
    expect(ligne("A").hasAttribute("data-allumee")).toBe(true);
    expect(ligne("B").hasAttribute("data-allumee")).toBe(false);
    presses = [];
    act(() => void vi.advanceTimersByTime(RELEVE_MS));
    expect(ligne("A").hasAttribute("data-allumee")).toBe(false);
    expect(ligne("A").hasAttribute("data-vue")).toBe(true);
    expect(ligne("A").textContent).toContain("envoyée");
  });

  it("hors de la zone de jeu, la même trame n'allume rien au clavier", () => {
    // Personne n'a le focus au montage : le document joue (`clavierAuJeu`).
    let presses: string[] = [];
    const { ligne } = monter(() => ({ activite: boutons(presses), sinceHeardMs: 100 }));
    act(() => document.getElementById("ailleurs")!.focus());
    presses = ["A"];
    act(() => void vi.advanceTimersByTime(RELEVE_MS * 2));
    expect(ligne("A").hasAttribute("data-allumee")).toBe(false);
    expect(ligne("A").hasAttribute("data-vue")).toBe(false);
  });

  it("un écho muet depuis 5 s n'allume rien", () => {
    const { ligne } = monter(() => ({ activite: boutons(["A"]), sinceHeardMs: 5000 }));
    act(() => document.getElementById("zone")!.focus());
    act(() => void vi.advanceTimersByTime(RELEVE_MS * 2));
    expect(ligne("A").hasAttribute("data-vue")).toBe(false);
  });

  it("joue fier une fois quand chaque ligne a été vue", () => {
    const deux = LIGNES.slice(1);
    let presses: string[] = ["A"];
    const { demander } = monter(() => ({ activite: boutons(presses), sinceHeardMs: 100 }), {
      lignes: deux,
    });
    act(() => document.getElementById("zone")!.focus());
    act(() => void vi.advanceTimersByTime(RELEVE_MS));
    expect(demander).not.toHaveBeenCalled();
    presses = ["B"];
    act(() => void vi.advanceTimersByTime(RELEVE_MS * 4));
    expect(demander).toHaveBeenCalledTimes(1);
    expect(demander).toHaveBeenCalledWith({ scene: "fier", par: "salle", hote: "coin" });
  });

  it("ne joue jamais fier quand une ligne n'a pas de case", () => {
    const { demander } = monter(() => ({
      activite: boutons(["A", "B"]),
      sinceHeardMs: 100,
    }));
    act(() => document.getElementById("zone")!.focus());
    act(() => void vi.advanceTimersByTime(RELEVE_MS * 4));
    expect(demander).not.toHaveBeenCalled();
  });

  it("une trame qui ne suit rien ne montre aucune case", () => {
    const { container } = monter(() => ({ activite: RIEN_SUIVI, sinceHeardMs: 100 }));
    expect(container.querySelectorAll("[data-suivie]")).toHaveLength(0);
  });

  it("Revenir et Changer les touches appellent leur geste", () => {
    const revenir = vi.fn();
    const changer = vi.fn();
    const { container } = render(
      <VueTouches
        titre="Ta manette Xbox"
        lignes={LIGNES}
        clavier={false}
        lire={() => ({ activite: RIEN_SUIVI, sinceHeardMs: null })}
        onRevenir={revenir}
        onChanger={changer}
      />,
    );
    fireEvent.click(container.querySelector("#revenirTouches")!);
    fireEvent.click(container.querySelector("#changerTouches")!);
    expect(revenir).toHaveBeenCalledTimes(1);
    expect(changer).toHaveBeenCalledTimes(1);
    // La vue de la manette ne dit pas de cliquer sur l'image.
    expect(container.textContent).not.toContain("Clique sur l'image");
  });
});
