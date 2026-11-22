/**
 * Un seul garde pour les deux boutons « Signaler ».
 *
 * La relecture du 22 novembre 2026: le bandeau d'une image figée et la colonne
 * portaient chacun leur garde. Un clic sur le bandeau laissait la colonne armée,
 * et le second repère recevait du salon « Demande trop rapprochée ». Le bandeau
 * démonté puis remonté (un passage par « en marche ») se réarmait aussi.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPLAIN_EVERY, GardeSignalement } from "../lib/garde-signalement";
import { Signaler } from "./Signaler";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function deux(garde: GardeSignalement, gardeBandeau = garde, bandeau = true) {
  const onComplain = vi.fn().mockResolvedValue(undefined);
  const rendu = render(
    <>
      <Signaler id="complain" garde={garde} onComplain={onComplain} />
      {bandeau ? (
        <Signaler
          id="signalerEtat"
          variante="bandeau"
          garde={gardeBandeau}
          onComplain={onComplain}
        />
      ) : null}
    </>,
  );
  return { onComplain, rendu };
}
const colonne = () => document.querySelector("#complain") as HTMLButtonElement;
const surImage = () => document.querySelector("#signalerEtat") as HTMLButtonElement | null;

describe("le garde partagé", () => {
  it("un clic sur le bandeau désarme aussi la colonne", async () => {
    deux(new GardeSignalement());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Signaler" })));
    expect(colonne()).toBeDisabled();
  });

  it("un bandeau démonté puis remonté reste désarmé jusqu'à vingt secondes", async () => {
    const garde = new GardeSignalement();
    const { onComplain, rendu } = deux(garde);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Signaler" })));
    rendu.rerender(
      <>
        <Signaler id="complain" garde={garde} onComplain={onComplain} />
      </>,
    );
    rendu.rerender(
      <>
        <Signaler id="complain" garde={garde} onComplain={onComplain} />
        <Signaler id="signalerEtat" variante="bandeau" garde={garde} onComplain={onComplain} />
      </>,
    );
    expect(surImage()).toBeDisabled();
    act(() => vi.advanceTimersByTime(COMPLAIN_EVERY + 10));
    expect(surImage()).toBeEnabled();
    expect(colonne()).toBeEnabled();
  });

  it("jumeau: deux gardes distincts ne se désarment pas l'un l'autre", async () => {
    deux(new GardeSignalement(), new GardeSignalement());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Signaler" })));
    expect(surImage()).toBeDisabled();
    expect(colonne()).toBeEnabled();
  });

  it("jumeau: un repère refusé ne désarme rien", async () => {
    const garde = new GardeSignalement();
    render(
      <Signaler
        id="complain"
        garde={garde}
        onComplain={vi.fn().mockRejectedValue(new Error("Signalement non confirmé."))}
      />,
    );
    await act(async () => fireEvent.click(colonne()));
    expect(colonne()).toBeEnabled();
    expect(garde.tenu()).toBe(false);
  });
});
