/**
 * « Signaler un problème » : un seul garde pour tous les boutons, et des mots
 * qui disent quand le repère est parti et pourquoi le bouton attend.
 *
 * La relecture du 22 novembre 2026 : le bandeau d'une image figée et la colonne
 * portaient chacun leur garde. Un clic sur le bandeau laissait la colonne armée,
 * et le second repère recevait du salon « Demande trop rapprochée ». Le bandeau
 * démonté puis remonté (un passage par « en marche ») se réarmait aussi.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPLAIN_EVERY, DELAI_DEPASSE, GardeSignalement } from "../lib/garde-signalement";
import { SANS_REPONSE, SIGNALER } from "../lib/mots";
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
const tenu = (b: Element | null) => b?.getAttribute("aria-disabled") === "true";

describe("le garde partagé", () => {
  it("un clic sur le bandeau désarme aussi la colonne", async () => {
    deux(new GardeSignalement());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: SIGNALER.court })));
    expect(tenu(colonne())).toBe(true);
  });

  it("un bandeau démonté puis remonté reste désarmé jusqu'à vingt secondes", async () => {
    const garde = new GardeSignalement();
    const { onComplain, rendu } = deux(garde);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: SIGNALER.court })));
    rendu.rerender(<Signaler id="complain" garde={garde} onComplain={onComplain} />);
    rendu.rerender(
      <>
        <Signaler id="complain" garde={garde} onComplain={onComplain} />
        <Signaler id="signalerEtat" variante="bandeau" garde={garde} onComplain={onComplain} />
      </>,
    );
    expect(tenu(surImage())).toBe(true);
    act(() => vi.advanceTimersByTime(COMPLAIN_EVERY + 10));
    expect(tenu(surImage())).toBe(false);
    expect(tenu(colonne())).toBe(false);
  });

  it("jumeau : deux gardes distincts ne se désarment pas l'un l'autre", async () => {
    deux(new GardeSignalement(), new GardeSignalement());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: SIGNALER.court })));
    expect(tenu(surImage())).toBe(true);
    expect(tenu(colonne())).toBe(false);
  });

  it("jumeau : un repère refusé ne désarme rien et ne dit pas « C'est noté »", async () => {
    const garde = new GardeSignalement();
    render(
      <Signaler
        id="complain"
        garde={garde}
        onComplain={vi.fn().mockRejectedValue(new Error("Demande trop rapprochée."))}
      />,
    );
    await act(async () => fireEvent.click(colonne()));
    expect(tenu(colonne())).toBe(false);
    expect(garde.tenu()).toBe(false);
    expect(screen.queryByText(/C'est noté/)).toBeNull();
  });
});

describe("les mots", () => {
  it("dit « Signaler un problème » en casse de phrase, sans capitales forcées", () => {
    render(<Signaler garde={new GardeSignalement()} onComplain={vi.fn()} />);
    expect(colonne()).toHaveTextContent(SIGNALER.pret);
    expect(colonne().className).not.toMatch(/uppercase/);
    expect(tenu(colonne())).toBe(false);
  });

  it("à l'accusé, dit l'heure de l'horloge, puis depuis quand et combien d'attente", async () => {
    let t = 0;
    const garde = new GardeSignalement(() => t);
    const annoncer = vi.fn();
    render(
      <Signaler
        garde={garde}
        onComplain={vi.fn().mockResolvedValue(undefined)}
        annoncer={annoncer}
        horloge={() => new Date(2026, 10, 23, 21, 42, 7)}
      />,
    );
    await act(async () => fireEvent.click(colonne()));
    const note = SIGNALER.note("21 h 42");
    expect(screen.getByText(note)).toBeVisible();
    expect(annoncer).toHaveBeenCalledWith(note, "ordinaire");
    t = 12_000;
    act(() => vi.advanceTimersByTime(1000));
    expect(colonne()).toHaveTextContent(SIGNALER.tenu(12));
    expect(screen.getByText(SIGNALER.reste(8))).toBeVisible();
  });

  it("jumeau : un clic sur le bouton tenu n'envoie rien", async () => {
    const onComplain = vi.fn().mockResolvedValue(undefined);
    render(<Signaler garde={new GardeSignalement()} onComplain={onComplain} />);
    await act(async () => fireEvent.click(colonne()));
    await act(async () => fireEvent.click(colonne()));
    expect(onComplain).toHaveBeenCalledTimes(1);
    expect(tenu(colonne())).toBe(true);
  });

  it("jumeau : à vingt secondes, le bouton redit « Signaler un problème »", async () => {
    render(
      <Signaler garde={new GardeSignalement()} onComplain={vi.fn().mockResolvedValue(undefined)} />,
    );
    await act(async () => fireEvent.click(colonne()));
    act(() => vi.advanceTimersByTime(COMPLAIN_EVERY + 10));
    expect(colonne()).toHaveTextContent(SIGNALER.pret);
    expect(screen.queryByText(/C'est noté/)).toBeNull();
  });
});

describe("les échecs", () => {
  it("sans accusé dans le délai : le site ne répond pas, et « Réessayer »", async () => {
    const onComplain = vi.fn().mockRejectedValue(new Error(DELAI_DEPASSE));
    const annoncer = vi.fn();
    render(<Signaler garde={new GardeSignalement()} onComplain={onComplain} annoncer={annoncer} />);
    await act(async () => fireEvent.click(colonne()));
    expect(screen.getByText(SIGNALER.sansReponse)).toBeVisible();
    expect(annoncer).toHaveBeenCalledWith(SIGNALER.sansReponse, "urgente");
    // La ligne parlée suffit : pas de seconde région.
    expect(document.querySelector("[role=alert]")).toBeNull();
    onComplain.mockResolvedValue(undefined);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: SIGNALER.reessayer })),
    );
    expect(onComplain).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(SIGNALER.sansReponse)).toBeNull();
  });

  it("socket fermée : la même phrase", async () => {
    render(
      <Signaler
        garde={new GardeSignalement()}
        onComplain={vi.fn().mockRejectedValue(new Error(SANS_REPONSE))}
      />,
    );
    await act(async () => fireEvent.click(colonne()));
    expect(screen.getByRole("alert")).toHaveTextContent(SIGNALER.sansReponse);
  });

  it("jumeau : un refus du salon se dit avec ses mots, sans supposer que le site ne répond pas", async () => {
    render(
      <Signaler
        garde={new GardeSignalement()}
        onComplain={vi.fn().mockRejectedValue(new Error("Demande trop rapprochée."))}
      />,
    );
    await act(async () => fireEvent.click(colonne()));
    expect(screen.getByText("Demande trop rapprochée.")).toBeVisible();
    expect(screen.queryByText(SIGNALER.sansReponse)).toBeNull();
    expect(screen.queryByRole("button", { name: SIGNALER.reessayer })).toBeNull();
  });
});
