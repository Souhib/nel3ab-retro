import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BRANCHEE } from "../lib/mots";
import { ControllerStatus, ManetteDansLaBande } from "./ControllerStatus";

const connected = { padId: "Wireless Controller", padLayout: "standard" as const, profile: null };
const unplugged = { padId: null, padLayout: null, profile: null };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("dit le branchement cinq secondes, malgré les relevés répétés, sans rien peindre", () => {
  const { rerender } = render(<ControllerStatus state={connected} />);
  const ligne = screen.getByRole("status");
  expect(ligne).toHaveTextContent("connectée");
  // Rien de visible : plus d'avis qui couvre les touches (audit N1).
  expect(ligne).toHaveClass("sr-only");
  expect(ligne.querySelector("button")).toBeNull();
  for (let tick = 0; tick < 9; tick++) {
    act(() => vi.advanceTimersByTime(500));
    rerender(<ControllerStatus state={{ ...connected }} />);
  }
  expect(ligne).toHaveTextContent("connectée");
  act(() => vi.advanceTimersByTime(500));
  // La région reste montée, vide : seul son texte change.
  expect(screen.getByRole("status")).toBe(ligne);
  expect(ligne).toHaveTextContent("");
  rerender(<ControllerStatus state={{ ...connected }} />);
  expect(ligne).toHaveTextContent("");
});

it("dit le débranchement puis le retour, chacun une fois", () => {
  const { rerender } = render(<ControllerStatus state={connected} />);
  act(() => vi.advanceTimersByTime(4000));
  rerender(<ControllerStatus state={unplugged} />);
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole("status")).toHaveTextContent("déconnectée");
  act(() => vi.advanceTimersByTime(4000));
  expect(screen.getByRole("status")).toHaveTextContent("");
  rerender(<ControllerStatus state={connected} />);
  expect(screen.getByRole("status")).toHaveTextContent("reconnectée");
  act(() => vi.advanceTimersByTime(5000));
  // Les relevés suivants de la même manette n'annoncent rien de plus.
  rerender(<ControllerStatus state={{ ...connected }} />);
  rerender(<ControllerStatus state={{ ...connected }} />);
  expect(screen.getByRole("status")).toHaveTextContent("");
});

const bande = {
  nom: "manette Xbox",
  place: 1,
  aConfigurer: false,
  tactile: false,
  conseil: true,
  onVerifier: vi.fn(),
  onTactile: vi.fn(),
};

it("dit dans la bande quelle manette joue et où, avec ses deux gestes", () => {
  const onVerifier = vi.fn();
  const onTactile = vi.fn();
  render(<ManetteDansLaBande {...bande} onVerifier={onVerifier} onTactile={onTactile} />);
  expect(screen.getByText(BRANCHEE.joue("manette Xbox", 1))).toBeInTheDocument();
  expect(screen.getByText("Ta manette Xbox joue à la place 1.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: BRANCHEE.verifier }));
  expect(onVerifier).toHaveBeenCalledTimes(1);
  const tactile = screen.getByRole("button", { name: BRANCHEE.tactile });
  expect(tactile).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(tactile);
  expect(onTactile).toHaveBeenCalledTimes(1);
  expect(screen.getByText(BRANCHEE.tourne)).toBeInTheDocument();
  expect(screen.queryByText("à configurer")).toBeNull();
});

it("ne conseille pas de tourner en travers, et dit une manette à configurer", () => {
  render(<ManetteDansLaBande {...bande} conseil={false} tactile aConfigurer />);
  expect(screen.queryByText(BRANCHEE.tourne)).toBeNull();
  expect(screen.getByRole("button", { name: BRANCHEE.tactile })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByText("à configurer")).toBeInTheDocument();
});
