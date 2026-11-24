import { act, render, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { GardeSignalement } from "../lib/garde-signalement";
import {
  rappelsDeLEtat,
  useAllerAuGeste,
  useAvantLaFermeture,
  type MoyensDeLaSalle,
} from "./useEtatDeLaSalle";

function moyens() {
  const session = {
    relancerImage: vi.fn(),
    input: { reste: vi.fn(() => true) },
    video: { setHalf: vi.fn() },
  };
  const m = {
    session,
    quitter: vi.fn(),
    signaler: vi.fn(async () => {}),
    garde: new GardeSignalement(),
    reduire: vi.fn(),
    cale: { settled: vi.fn() },
    qualite: vi.fn(),
    sansProposition: vi.fn(),
    legere: vi.fn(),
    avisLegere: vi.fn(),
    refuserLegere: vi.fn(),
  } satisfies MoyensDeLaSalle;
  return m;
}

describe("ce que font les gestes des états", () => {
  it("« Je reste » envoie son octet par la session, et rien d'autre", () => {
    const m = moyens();
    rappelsDeLEtat(m).onRester();
    expect(m.session.input.reste).toHaveBeenCalledTimes(1);
    expect(m.session.relancerImage).not.toHaveBeenCalled();
  });

  it("jumeau : sans session, « Je reste » ne casse rien", () => {
    const m = { ...moyens(), session: null };
    expect(() => rappelsDeLEtat(m).onRester()).not.toThrow();
  });

  it("« Relancer l'image » et « Réessayer » relancent l'image", () => {
    const m = moyens();
    const r = rappelsDeLEtat(m);
    r.onRelancer();
    r.onReessayer();
    expect(m.session.relancerImage).toHaveBeenCalledTimes(2);
  });

  it("« Non merci » calme la liaison, retire la proposition et dit le refus au salon", () => {
    const m = moyens();
    rappelsDeLEtat(m).onGarder();
    expect(m.cale.settled).toHaveBeenCalledTimes(1);
    expect(m.sansProposition).toHaveBeenCalledTimes(1);
    expect(m.qualite).toHaveBeenCalledWith("refusé");
  });

  it("« Revenir en image complète » refuse l'image légère, l'éteint et retire son avis", () => {
    const m = moyens();
    rappelsDeLEtat(m).onRevenir();
    expect(m.refuserLegere).toHaveBeenCalledTimes(1);
    expect(m.session.video.setHalf).toHaveBeenCalledWith(false);
    expect(m.legere).toHaveBeenCalledWith(false);
    expect(m.avisLegere).toHaveBeenCalledWith(false);
  });

  it("jumeau : « Garder » retire l'avis sans éteindre l'image légère", () => {
    const m = moyens();
    rappelsDeLEtat(m).onGarderLegere();
    expect(m.avisLegere).toHaveBeenCalledWith(false);
    expect(m.legere).not.toHaveBeenCalled();
    expect(m.session.video.setHalf).not.toHaveBeenCalled();
  });

  it("quitter, signaler et réduire sont ceux de la salle", () => {
    const m = moyens();
    const r = rappelsDeLEtat(m);
    expect([r.onQuitter, r.onSignaler, r.onReduire, r.garde]).toEqual([
      m.quitter,
      m.signaler,
      m.reduire,
      m.garde,
    ]);
  });
});

describe("ce qu'une salle montrait avant de fermer", () => {
  it("garde la dernière valeur d'une salle ouverte, pas celles qui suivent la fermeture", () => {
    const { result, rerender } = renderHook(
      ({ fermee, valeur }) => useAvantLaFermeture(fermee, valeur),
      { initialProps: { fermee: false, valeur: "Lina" } },
    );
    expect(result.current).toBe("Lina");
    rerender({ fermee: false, valeur: "Lina et Bo" });
    expect(result.current).toBe("Lina et Bo");
    rerender({ fermee: true, valeur: "Max" });
    expect(result.current).toBe("Lina et Bo");
    rerender({ fermee: true, valeur: "Max et Zoé" });
    expect(result.current).toBe("Lina et Bo");
  });

  it("jumeau : rouverte, elle suit de nouveau ce qu'elle publie", () => {
    const { result, rerender } = renderHook(
      ({ fermee, valeur }) => useAvantLaFermeture(fermee, valeur),
      { initialProps: { fermee: true, valeur: "Max" } },
    );
    rerender({ fermee: false, valeur: "Zoé" });
    expect(result.current).toBe("Zoé");
  });
});

/** Une salle minimale : la pastille, une feuille qui porte la fiche, et un
 * bouton pour la fermer. */
function Salle({ lieu, menu = false }: { lieu: "colonne" | "feuille"; menu?: boolean }) {
  const [ouverte, ouvrir] = useState(false);
  const aller = useAllerAuGeste({
    lieu,
    feuilleOuverte: ouverte,
    menu,
    ouvrirFeuille: () => ouvrir(true),
  });
  return (
    <>
      <button type="button" id="pastilleEtat" onClick={aller}>
        Image figée
      </button>
      {lieu === "colonne" || ouverte ? (
        <section id="liaison">
          <button type="button" className="n3-geste" id="relancerImage">
            Relancer l&apos;image
          </button>
        </section>
      ) : null}
      <button type="button" id="fermer" onClick={() => ouvrir(false)}>
        fermer
      </button>
    </>
  );
}

const image = () => new Promise<void>((fin) => requestAnimationFrame(() => fin()));

describe("la pastille mène au geste de sa fiche", () => {
  it("dans la feuille : l'ouvre, met le focus sur le geste, et le rend à la pastille en se fermant", async () => {
    render(<Salle lieu="feuille" />);
    await act(async () => {
      document.querySelector<HTMLElement>("#pastilleEtat")!.click();
      await image();
    });
    expect(document.activeElement?.id).toBe("relancerImage");
    // La feuille se ferme avec le geste : le focus retombe sur le document.
    await act(async () => {
      document.querySelector<HTMLElement>("#fermer")!.click();
      (document.activeElement as HTMLElement | null)?.blur();
    });
    expect(document.activeElement?.id).toBe("pastilleEtat");
  });

  it("jumeau : un menu qui s'ouvre à la place garde le focus pour lui", async () => {
    const { rerender } = render(<Salle lieu="feuille" />);
    await act(async () => {
      document.querySelector<HTMLElement>("#pastilleEtat")!.click();
      await image();
    });
    (document.activeElement as HTMLElement | null)?.blur();
    rerender(<Salle lieu="feuille" menu />);
    await act(async () => {
      document.querySelector<HTMLElement>("#fermer")!.click();
    });
    expect(document.activeElement?.id).not.toBe("pastilleEtat");
  });

  it("jumeau : dans la colonne, le focus va au geste sans ouvrir de feuille", async () => {
    const ouvrir = vi.fn();
    function Colonne() {
      const aller = useAllerAuGeste({
        lieu: "colonne",
        feuilleOuverte: false,
        menu: false,
        ouvrirFeuille: ouvrir,
      });
      return (
        <>
          <button type="button" id="pastilleEtat" onClick={aller}>
            Image figée
          </button>
          <section id="liaison">
            <button type="button" className="n3-geste" id="relancerImage">
              Relancer l&apos;image
            </button>
          </section>
        </>
      );
    }
    render(<Colonne />);
    await act(async () => {
      document.querySelector<HTMLElement>("#pastilleEtat")!.click();
      await image();
    });
    expect(ouvrir).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("relancerImage");
  });
});
