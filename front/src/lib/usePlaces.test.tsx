import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Occupation } from "./arrivees";
import type { Arbitre } from "./scenes-salle";
import { changement, PART_MS, usePlaces, VIENT_MS, type SuiviDesPlaces } from "./usePlaces";

const occ = (tenues: boolean[], noms: [number, string][] = []): Occupation => ({
  tenues,
  noms: new Map(noms),
});
const etat = (occupation: Occupation, mienne: number | null = null, regardent: string[] = []) => ({
  occupation,
  mienne,
  regardent,
});

describe("ce qu'un changement fait", () => {
  it("le premier état reçu ne fait rien, même une salle pleine", () => {
    const plein = etat(occ([true, true, true, true], [[1, "Ami"]]), null, ["Sami"]);
    expect(changement(null, plein, new Set())).toEqual({
      phrases: [],
      scene: null,
      vient: [],
      part: [],
    });
  });

  it("une première arrivée allume la place, joue l'arrivée et la dit", () => {
    const fait = changement(
      etat(occ([false, false, false, false])),
      etat(occ([false, false, true, false], [[3, "JO"]])),
      new Set(),
    );
    expect(fait).toEqual({
      phrases: ["JO prend la place 3."],
      scene: "arrivee",
      vient: [3],
      part: [],
    });
  });

  it("un retour allume la place sans scène", () => {
    const fait = changement(
      etat(occ([false, false, false, false])),
      etat(occ([false, false, true, false], [[3, "JO"]])),
      new Set(["JO"]),
    );
    expect(fait.scene).toBeNull();
    expect(fait.vient).toEqual([3]);
    expect(fait.phrases).toEqual(["JO revient à la place 3."]);
  });

  it("une place tenue sans nom s'allume sans scène et sans prénom inventé", () => {
    const fait = changement(etat(occ([false])), etat(occ([true])), new Set());
    expect(fait.scene).toBeNull();
    expect(fait.phrases).toEqual(["La place 1 est prise."]);
  });

  it("un départ seul éteint la place, joue le départ et le dit", () => {
    const fait = changement(
      etat(occ([false, false, false, true], [[4, "Inès"]])),
      etat(occ([false, false, false, false])),
      new Set(),
    );
    expect(fait).toEqual({
      phrases: ["Inès rend la place 4."],
      scene: "depart",
      vient: [],
      part: [4],
    });
  });

  it("une salle qui libère toutes ses places n'appelle pas la mascotte", () => {
    const fait = changement(
      etat(
        occ(
          [true, true, true, true],
          [
            [1, "A"],
            [2, "B"],
          ],
        ),
      ),
      etat(occ([false, false, false, false])),
      new Set(),
    );
    expect(fait.scene).toBeNull();
    expect(fait.part).toEqual([1, 2, 3, 4]);
  });

  it("dit en une phrase à qui on a pris sa place", () => {
    const fait = changement(
      etat(occ([false, true, false, false], [[2, "Moi"]]), 2),
      etat(occ([false, true, false, false], [[2, "Lina"]]), null),
      new Set(["Lina"]),
    );
    expect(fait.phrases).toEqual(["Ta place 2 est à Lina. Tu regardes."]);
    // La place change de main : elle se rallume, elle ne s'éteint pas.
    expect(fait.part).toEqual([]);
    expect(fait.vient).toEqual([2]);
  });

  it("un nouveau spectateur se dit et joue la scène du spectateur", () => {
    const fait = changement(
      etat(occ([true], [[1, "Bo"]]), null, []),
      etat(occ([true], [[1, "Bo"]]), null, ["Sami"]),
      new Set(),
    );
    expect(fait.phrases).toEqual(["Sami regarde la partie."]);
    // La table du socle associe l'événement « spectateur » à une scène.
    expect(fait.scene).not.toBeNull();
    // Le jumeau : qui rend sa place et regarde n'est pas un nouveau spectateur.
    const rend = changement(
      etat(occ([true], [[1, "Bo"]]), null, []),
      etat(occ([false]), null, ["Bo"]),
      new Set(),
    );
    expect(rend.phrases).toEqual(["Bo rend la place 1."]);
  });
});

describe("usePlaces", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const arbitre = () => {
    const demander = vi.fn<Arbitre["demander"]>(() => null);
    return {
      demander,
      arbitre: { demander, couper: () => {}, enCours: () => null } satisfies Arbitre,
    };
  };

  const suivi = (o: Partial<SuiviDesPlaces>): SuiviDesPlaces => ({
    occupation: occ([false, false, false, false]),
    mienne: null,
    regardent: [],
    salle: "1",
    stable: true,
    arbitre: null,
    hote: () => "coin",
    annoncer: () => {},
    ...o,
  });

  it("une première arrivée : la scène une fois, l'annonce une fois, la place allumée 2,2 s", () => {
    const { demander, arbitre: a } = arbitre();
    const annoncer = vi.fn();
    const { result, rerender } = renderHook((p: SuiviDesPlaces) => usePlaces(p), {
      initialProps: suivi({ arbitre: a, annoncer }),
    });
    rerender(
      suivi({ arbitre: a, annoncer, occupation: occ([false, false, true, false], [[3, "JO"]]) }),
    );
    expect(demander).toHaveBeenCalledTimes(1);
    expect(demander).toHaveBeenCalledWith({ scene: "arrivee", par: "personnes", hote: "coin" });
    expect(annoncer.mock.calls).toEqual([["JO prend la place 3.", "ordinaire"]]);
    expect([...result.current.vient]).toEqual([3]);
    // Le même état, reçu de nouveau dans des objets neufs : rien de plus.
    rerender(
      suivi({ arbitre: a, annoncer, occupation: occ([false, false, true, false], [[3, "JO"]]) }),
    );
    expect(demander).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(VIENT_MS - 1);
    });
    expect(result.current.vient.has(3)).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.vient.size).toBe(0);
  });

  it("la page ouverte sur une salle pleine ne joue rien et ne dit rien", () => {
    const { demander, arbitre: a } = arbitre();
    const annoncer = vi.fn();
    const { result } = renderHook(() =>
      usePlaces(
        suivi({
          arbitre: a,
          annoncer,
          occupation: occ([true, true, true, true], [[1, "A"]]),
        }),
      ),
    );
    expect(demander).not.toHaveBeenCalled();
    expect(annoncer).not.toHaveBeenCalled();
    expect(result.current.vient.size).toBe(0);
  });

  it("un démarrage de jeu ne joue ni départ ni arrivée, et la référence repart de zéro", () => {
    const { demander, arbitre: a } = arbitre();
    const annoncer = vi.fn();
    const plein = occ(
      [true, true, false, false],
      [
        [1, "A"],
        [2, "B"],
      ],
    );
    const { result, rerender } = renderHook((p: SuiviDesPlaces) => usePlaces(p), {
      initialProps: suivi({ arbitre: a, annoncer, occupation: plein }),
    });
    // Le démarrage libère les places, puis elles reviennent.
    rerender(
      suivi({ arbitre: a, annoncer, stable: false, occupation: occ([false, false, false, false]) }),
    );
    rerender(suivi({ arbitre: a, annoncer, stable: true, occupation: plein }));
    expect(demander).not.toHaveBeenCalled();
    expect(annoncer).not.toHaveBeenCalled();
    expect(result.current.vient.size + result.current.part.size).toBe(0);
  });

  it("un départ éteint la place 420 ms et joue le départ", () => {
    const { demander, arbitre: a } = arbitre();
    const { result, rerender } = renderHook((p: SuiviDesPlaces) => usePlaces(p), {
      initialProps: suivi({ arbitre: a, occupation: occ([false, true], [[2, "Bo"]]) }),
    });
    rerender(suivi({ arbitre: a, occupation: occ([false, false]) }));
    expect(demander).toHaveBeenCalledWith({ scene: "depart", par: "personnes", hote: "coin" });
    expect([...result.current.part]).toEqual([2]);
    act(() => {
      vi.advanceTimersByTime(PART_MS);
    });
    expect(result.current.part.size).toBe(0);
  });

  it("ne joue pas quand la mascotte n'a pas d'endroit où jouer", () => {
    const { demander, arbitre: a } = arbitre();
    const { rerender } = renderHook((p: SuiviDesPlaces) => usePlaces(p), {
      initialProps: suivi({ arbitre: a, hote: () => null }),
    });
    rerender(suivi({ arbitre: a, hote: () => null, occupation: occ([true], [[1, "Neuf"]]) }));
    expect(demander).not.toHaveBeenCalled();
  });

  it("retient qui s'est assis : une seconde arrivée est un retour", () => {
    const { demander, arbitre: a } = arbitre();
    const { rerender } = renderHook((p: SuiviDesPlaces) => usePlaces(p), {
      initialProps: suivi({ arbitre: a }),
    });
    rerender(suivi({ arbitre: a, occupation: occ([true], [[1, "Bo"]]) }));
    rerender(suivi({ arbitre: a, occupation: occ([false]) }));
    rerender(suivi({ arbitre: a, occupation: occ([true], [[1, "Bo"]]) }));
    const scenes = demander.mock.calls.map(([d]) => d.scene);
    expect(scenes).toEqual(["arrivee", "depart"]);
  });
});
