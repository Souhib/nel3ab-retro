import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PartieVue } from "../client";
import * as chiffres from "../retro/chiffres";
import { horloge, instantDeLancement, TempsDeJeu, useLancement } from "./TempsDeJeu";

describe("le temps de jeu", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("écrit 00:12:34 sur l'afficheur caché, et « 12 min de jeu » en clair", () => {
    let t = 1000 + 754;
    const { container } = render(<TempsDeJeu depuisS={1000} maintenant={() => t} />);
    const valeur = container.querySelector(".rt-afficheur-valeur")!;
    expect(valeur.textContent).toBe("00:12:34");
    expect(valeur.closest("[aria-hidden='true']")).not.toBeNull();
    expect(container.querySelector(".sr-only")!.textContent).toBe("12 min de jeu");
    t += 1;
    act(() => void vi.advanceTimersByTime(1000));
    expect(valeur.textContent).toBe("00:12:35");
  });

  // La salle se redessine deux fois par seconde. Une horloge par défaut
  // neuve à chaque rendu reposait l'afficheur et relançait la minuterie à
  // chaque fois : elle ne battait jamais (relecture du 23 novembre 2026).
  it("garde son afficheur et sa minuterie quand la salle se redessine", () => {
    const pose = vi.spyOn(chiffres, "poserAfficheur");
    const { rerender, container } = render(<TempsDeJeu depuisS={1000} />);
    const valeur = container.querySelector(".rt-afficheur-valeur");
    rerender(<TempsDeJeu depuisS={1000} />);
    rerender(<TempsDeJeu depuisS={1000} />);
    expect(pose).toHaveBeenCalledTimes(1);
    // Le même afficheur : un afficheur reposé perd le roulement du compteur.
    expect(container.querySelector(".rt-afficheur-valeur")).toBe(valeur);
    pose.mockRestore();
  });

  it("sans instant de lancement, ne rend rien", () => {
    const { container } = render(<TempsDeJeu depuisS={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("compte les heures, et jamais un temps négatif", () => {
    expect(horloge(3 * 3600 + 5)).toBe("03:00:05");
    expect(horloge(-4)).toBe("00:00:00");
  });
});

describe("l'instant de lancement, tiré de l'âge que le salon publie", () => {
  it("change l'âge en instant à la réception", () => {
    expect(instantDeLancement(null, 754, 10_000)).toBe(9246);
  });

  it("garde l'instant d'avant quand l'envoi suivant ne s'en écarte que d'une seconde", () => {
    // L'âge tronqué : 754,9 s publié 754, puis 755 une demi-seconde après.
    expect(instantDeLancement(9246, 755, 10_000.5)).toBe(9246);
    expect(instantDeLancement(9246, 754, 10_001.4)).toBe(9246);
  });

  // Le jumeau : un nouveau jeu redémarre le worker, son âge repart de zéro.
  it("prend le nouvel instant quand le jeu a changé", () => {
    expect(instantDeLancement(9246, 3, 10_100)).toBe(10_097);
  });

  it("rien sans âge, ni pour un âge impossible", () => {
    expect(instantDeLancement(9246, null, 10_000)).toBeNull();
    expect(instantDeLancement(null, undefined, 10_000)).toBeNull();
    expect(instantDeLancement(null, -1, 10_000)).toBeNull();
    expect(instantDeLancement(null, Number.NaN, 10_000)).toBeNull();
  });
});

describe("useLancement", () => {
  function Sonde({
    partie,
    enPartie,
    t,
  }: {
    partie: PartieVue | null;
    enPartie: boolean;
    t: { now: number };
  }) {
    const maintenant = useRef(() => t.now).current;
    const instant = useLancement(partie, enPartie, maintenant);
    return <output>{instant === null ? "rien" : String(instant)}</output>;
  }
  const lu = (container: HTMLElement) => container.querySelector("output")!.textContent;

  it("un instant par message du salon, pas par rendu", () => {
    const t = { now: 10_000 };
    const partie = { lance: true, image: true, depuis_s: 754 };
    const { container, rerender } = render(<Sonde partie={partie} enPartie t={t} />);
    expect(lu(container)).toBe("9246");
    // Le même message, la salle se redessine dix secondes plus tard.
    t.now = 10_010;
    rerender(<Sonde partie={partie} enPartie t={t} />);
    expect(lu(container)).toBe("9246");
    // Un nouveau message d'une autre partie : un nouvel instant.
    rerender(<Sonde partie={{ lance: true, image: true, depuis_s: 4 }} enPartie t={t} />);
    expect(lu(container)).toBe("10006");
  });

  it("rien tant que le worker sert son menu, ni hors d'une partie vue, ni sans jalon", () => {
    const t = { now: 10_000 };
    const menu = render(
      <Sonde partie={{ lance: false, image: false, depuis_s: 754 }} enPartie t={t} />,
    );
    expect(lu(menu.container)).toBe("rien");
    const horsPartie = render(
      <Sonde partie={{ lance: true, image: true, depuis_s: 754 }} enPartie={false} t={t} />,
    );
    expect(lu(horsPartie.container)).toBe("rien");
    const sansJalon = render(<Sonde partie={null} enPartie t={t} />);
    expect(lu(sansJalon.container)).toBe("rien");
    const ancien = render(<Sonde partie={{}} enPartie t={t} />);
    expect(lu(ancien.container)).toBe("rien");
  });
});
