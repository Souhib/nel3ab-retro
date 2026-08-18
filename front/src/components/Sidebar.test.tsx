/**
 * Les deux boutons de la colonne qui portent une décision.
 *
 * Le premier, « ça saccade », a menti pendant une journée: il se réarmait au
 * bout de trois secondes alors que le salon refuse un deuxième repère avant
 * vingt. Il répondait donc « noté, l'instant est marqué » sur un signalement
 * que personne n'écrivait. Trouvé à la main pendant l'audit du 18 août 2026,
 * parce qu'aucun test ne regardait ce composant.
 *
 * Le second propose le format réduit. Il n'a encore trompé personne, et c'est
 * l'intérêt d'écrire son test le même jour que lui.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

function show(overrides: Record<string, unknown> = {}) {
  const props = {
    mode: "normal" as const,
    onMode: vi.fn(),
    people: [],
    players: 4,
    busy: [false, false, false, false],
    names: new Map<number, string>(),
    mine: null,
    shot: null,
    volume: 0.7,
    onVolume: vi.fn(),
    onSound: vi.fn(),
    seated: false,
    onWatch: vi.fn(),
    onPlay: vi.fn(),
    onLeave: vi.fn(),
    onComplain: vi.fn(),
    suggestHalf: false,
    onTakeHalf: vi.fn(),
    onKeepFull: vi.fn(),
    ...overrides,
  };
  render(<Sidebar {...props} />);
  return props;
}

describe("le bouton « ça saccade »", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("pose un repère et le dit", () => {
    const { onComplain } = show();

    fireEvent.click(screen.getByText("ça saccade"));

    expect(onComplain).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/noté/)).toBeInTheDocument();
  });

  it("reste désarmé aussi longtemps que le salon refuse", () => {
    // Le défaut exact: à quatre secondes le bouton se réarmait, le clic
    // suivant répondait « noté » et le salon jetait le repère. Un contrôle qui
    // annonce ce qu'il n'a pas fait est pire qu'un contrôle absent.
    show();
    const button = screen.getByText("ça saccade");

    fireEvent.click(button);
    act(() => vi.advanceTimersByTime(5000));

    expect(screen.getByText("déjà signalé")).toBeDisabled();
  });

  it("se réarme quand le salon accepterait de nouveau", () => {
    // Le jumeau: un bouton désarmé pour toujours satisferait le test d'au-dessus
    // en rendant le signalement possible une seule fois par visite.
    show();

    fireEvent.click(screen.getByText("ça saccade"));
    act(() => vi.advanceTimersByTime(21_000));

    expect(screen.getByText("ça saccade")).not.toBeDisabled();
  });
});

describe("la proposition de format réduit", () => {
  it("ne se montre pas quand la liaison va bien", () => {
    show({ suggestHalf: false });

    expect(document.querySelector("#rough")).toBeNull();
  });

  it("propose de basculer, et bascule", () => {
    const { onTakeHalf } = show({ suggestHalf: true });

    fireEvent.click(screen.getByText("passer en réduit"));

    expect(onTakeHalf).toHaveBeenCalledTimes(1);
  });

  it("se refuse aussi facilement qu'elle s'accepte", () => {
    // Les deux boutons comptent autant. Quelqu'un peut préférer une image nette
    // avec quelques saccades à une image molle sans aucune, et c'est le refus
    // qui fait taire la proposition.
    const { onKeepFull, onTakeHalf } = show({ suggestHalf: true });

    fireEvent.click(screen.getByText("non merci"));

    expect(onKeepFull).toHaveBeenCalledTimes(1);
    expect(onTakeHalf).not.toHaveBeenCalled();
  });
});
