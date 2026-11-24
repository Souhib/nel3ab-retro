/** Les marques du pas à pas, sur le vrai balisage des dessins et une
 * horloge simulée. */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PadMapView } from "../../components/PadMap";
import { GAMECUBE, SWITCH_PRO, XBOX } from "../../lib/padmap";
import { InputStream } from "../../media/input";
import { Annonces } from "../../media/lesson";
import { SwitchInput } from "../../media/switch";
import { MARQUES, pieceDe, poserMarques, type Moment } from "./marques";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function monter() {
  const { container } = render(
    <div>
      <PadMapView map={GAMECUBE} title="gauche" />
      <PadMapView map={XBOX} title="droite" />
    </div>,
  );
  const annonces = new Annonces<Moment>();
  const arreter = poserMarques(container, (ecoute) => annonces.ecouter(ecoute));
  const marque = (part: string) =>
    container.querySelector(`[data-part="${part}"]`)?.getAttribute("data-marque") ?? null;
  const marquees = () => container.querySelectorAll("[data-marque]").length;
  return { emettre: (m: Moment) => annonces.emettre(m), marque, marquees, arreter, container };
}

describe("la commande attendue", () => {
  it("se cadre aussitôt, insiste à 4 s, reçoit la flèche à 8 s, puis plus rien", () => {
    const { emettre, marque } = monter();
    emettre({ type: "etape", control: "A" });
    expect(marque("A")).toBe("cadre");
    vi.advanceTimersByTime(MARQUES.insiste - 1);
    expect(marque("A")).toBe("cadre");
    vi.advanceTimersByTime(1);
    expect(marque("A")).toBe("insiste");
    vi.advanceTimersByTime(MARQUES.fleche - MARQUES.insiste);
    expect(marque("A")).toBe("fleche");
    // Plus rien ne change : aucune minuterie n'attend, rien ne clignote.
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20_000);
    expect(marque("A")).toBe("fleche");
  });

  it("cède à l'étape suivante, qui pose sa marque sans attendre (D5)", () => {
    const { emettre, marque } = monter();
    emettre({ type: "etape", control: "A" });
    vi.advanceTimersByTime(MARQUES.insiste);
    emettre({ type: "etape", control: "B" });
    expect(marque("A")).toBeNull();
    expect(marque("B")).toBe("cadre");
    // Les minuteries de A sont coupées : sa flèche ne vient jamais.
    vi.advanceTimersByTime(MARQUES.fleche);
    expect(marque("A")).toBeNull();
  });

  it("nomme le stick par sa pièce, pour Dolphin comme pour la trame Pro", () => {
    expect(pieceDe("y")).toBe("x");
    expect(pieceDe("cy")).toBe("cx");
    expect(pieceDe("lx+")).toBe("LS");
    expect(pieceDe("ry+")).toBe("RS");
    expect(pieceDe("A")).toBe("A");
  });
});

describe("la pièce appuyée", () => {
  it("prend ses coins 650 ms, s'efface, puis ne garde rien", () => {
    const { emettre, marque, marquees } = monter();
    emettre({ type: "etape", control: "A" });
    emettre({ type: "recu", control: "A", indice: "b0" });
    expect(marque("b0")).toBe("coins");
    vi.advanceTimersByTime(MARQUES.coins);
    expect(marque("b0")).toBe("efface");
    vi.advanceTimersByTime(MARQUES.efface);
    expect(marque("b0")).toBeNull();
    // La commande attendue n'insiste plus après la réponse.
    vi.advanceTimersByTime(MARQUES.fleche);
    expect(marque("A")).toBe("cadre");
    expect(marquees()).toBe(1);
  });

  it("la fin retire l'étape et laisse la dernière réponse finir", () => {
    const { emettre, marque, marquees } = monter();
    emettre({ type: "etape", control: "A" });
    emettre({ type: "recu", control: "A", indice: "b0" });
    emettre({ type: "fin" });
    expect(marque("A")).toBeNull();
    expect(marque("b0")).toBe("coins");
    vi.advanceTimersByTime(MARQUES.coins + MARQUES.efface);
    expect(marquees()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("un débranchement retire tout aussitôt, et l'arrêt désabonne", () => {
    const { emettre, marquees, arreter } = monter();
    emettre({ type: "etape", control: "A" });
    emettre({ type: "recu", control: "A", indice: "b0" });
    emettre({ type: "etape", control: "B" });
    emettre({ type: "suspendu" });
    expect(marquees()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    emettre({ type: "etape", control: "B" });
    emettre({ type: "recu", control: "B", indice: "b1" });
    arreter();
    expect(marquees()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    emettre({ type: "etape", control: "A" });
    expect(marquees()).toBe(0);
  });

  it("une nouvelle réponse coupe la précédente, qui ne garde pas ses coins", () => {
    const { emettre, marque } = monter();
    emettre({ type: "etape", control: "A" });
    emettre({ type: "recu", control: "A", indice: "b0" });
    emettre({ type: "etape", control: "B" });
    vi.advanceTimersByTime(MARQUES.coins / 2);
    emettre({ type: "recu", control: "B", indice: "b1" });
    expect(marque("b0")).toBeNull();
    expect(marque("b1")).toBe("coins");
    // Les minuteries de b0 sont coupées : il ne revient pas en « efface ».
    vi.advanceTimersByTime(MARQUES.coins / 2);
    expect(marque("b0")).toBeNull();
    expect(marque("b1")).toBe("coins");
  });
});

/** Une manette standard doublée, que la vraie boucle lit. */
function manette(id: string): Gamepad {
  return {
    id,
    index: 0,
    mapping: "standard",
    connected: true,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    axes: [0, 0, 0, 0],
    timestamp: 0,
  } as unknown as Gamepad;
}

const appuyer = (pad: Gamepad, index: number, value = 1) =>
  Object.assign(pad.buttons[index]!, { value, pressed: value > 0.5 });

/** Les deux dessins d'un réglage, la gauche pour ce que le jeu reçoit, la
 * droite pour ta manette (une Xbox standard). */
function dessins(gauche: typeof GAMECUBE) {
  const { container } = render(
    <div>
      <PadMapView map={gauche} title="gauche" />
      <PadMapView map={XBOX} title="droite" />
    </div>,
  );
  const droite = container.querySelectorAll("svg[data-padmap]")[1]!;
  return {
    container,
    marque: (part: string) =>
      container.querySelector(`[data-part="${part}"]`)?.getAttribute("data-marque") ?? null,
    stickDroit: (axe: string) =>
      droite.querySelector(`[data-stick="${axe}"]`)?.getAttribute("data-marque") ?? null,
    liaison: () => container.querySelector(".n3-liaison"),
  };
}

// La relecture du 24 novembre 2026 : la boucle émet « recu » puis, dans le
// MÊME appel, l'« etape » suivante (`input.ts`, `switch.ts`). L'étape coupait
// tout, et les coins de la pièce appuyée tombaient avant toute peinture : ni
// coins ni ligne, nulle part. Les essais d'avant émettaient « recu » seul.
describe("à travers la vraie boucle Dolphin", () => {
  let stream: InputStream;
  let pad: Gamepad;
  const tick = () => vi.advanceTimersByTime(4);

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    pad = manette("manette du banc");
    vi.stubGlobal("navigator", { getGamepads: () => [pad] });
    stream = new InputStream(
      (path) => path,
      () => {},
      () => {},
      true,
    );
    stream.start();
    tick();
  });

  afterEach(() => {
    stream.stop();
    vi.unstubAllGlobals();
  });

  it("une réponse garde ses coins et sa ligne pendant que l'étape suivante se cadre", () => {
    const d = dessins(GAMECUBE);
    poserMarques(d.container, (ecoute) => stream.surReglage(ecoute));
    stream.beginLesson("gc", 0);
    expect(d.marque("A")).toBe("cadre");
    appuyer(pad, 0);
    tick();
    expect(stream.state().lesson?.step).toBe(2);
    expect(d.marque("b0")).toBe("coins");
    expect(d.liaison()).not.toBeNull();
    // L'étape suivante se pose sans attendre la réponse (D5).
    expect(d.marque("A")).toBeNull();
    expect(d.marque("B")).toBe("cadre");
    vi.advanceTimersByTime(MARQUES.coins);
    expect(d.marque("b0")).toBe("efface");
    expect(d.liaison()).toHaveAttribute("data-marque", "efface");
    vi.advanceTimersByTime(MARQUES.efface);
    expect(d.marque("b0")).toBeNull();
    expect(d.liaison()).toBeNull();
    expect(d.marque("B")).toBe("cadre");
  });

  it("une réponse de stick encadre le stick de ta manette", () => {
    const d = dessins(GAMECUBE);
    poserMarques(d.container, (ecoute) => stream.surReglage(ecoute));
    stream.beginLesson("gc", 0);
    while (stream.state().lesson?.control !== "x") stream.skipLessonStep();
    // Une étape passée attend une manette au repos avant d'écouter.
    tick();
    expect(stream.state().lesson?.waiting).toBe(false);
    expect(d.marque("x")).toBe("cadre");
    (pad.axes as number[])[0] = 0.95;
    tick();
    expect(d.stickDroit("a0")).toBe("coins");
    expect(d.liaison()).not.toBeNull();
    // Le jumeau : l'autre stick n'a rien reçu.
    expect(d.stickDroit("a2")).toBeNull();
  });

  it("« Changer » relie aussi la pièce appuyée à la commande changée", () => {
    const d = dessins(GAMECUBE);
    poserMarques(d.container, (ecoute) => stream.surReglage(ecoute));
    stream.beginCapture("B", "pad");
    appuyer(pad, 5);
    tick();
    expect(d.marque("b5")).toBe("coins");
    expect(d.liaison()).not.toBeNull();
  });
});

describe("à travers la vraie trame Pro", () => {
  it("une réponse garde ses coins et sa ligne pendant que l'étape suivante se cadre", () => {
    localStorage.clear();
    const source = new SwitchInput();
    const pad = manette("pad 0");
    const tour = () => source.poll(new Set(), [pad]);
    tour();
    const d = dessins(SWITCH_PRO);
    poserMarques(d.container, (ecoute) => source.surLecon(ecoute));
    source.commencerLecon();
    expect(d.marque("A")).toBe("cadre");
    appuyer(pad, 3);
    tour();
    expect(source.lecon?.demandee).toBe("B");
    expect(d.marque("b3")).toBe("coins");
    expect(d.liaison()).not.toBeNull();
    expect(d.marque("B")).toBe("cadre");
    vi.advanceTimersByTime(MARQUES.coins + MARQUES.efface);
    expect(d.marque("b3")).toBeNull();
    expect(d.liaison()).toBeNull();
  });
});

describe("la ligne de liaison", () => {
  /** Une boîte fixe par pièce : jsdom ne mesure rien. */
  const boites = (container: Element, places: Record<string, [number, number]>) => {
    container.getBoundingClientRect = () => new DOMRect(100, 50, 400, 200);
    for (const [part, [x, y]] of Object.entries(places)) {
      const piece = container.querySelector(`[data-part="${part}"]`)!;
      piece.getBoundingClientRect = () => new DOMRect(x - 5, y - 5, 10, 10);
    }
  };
  const ligne = (container: Element) => container.querySelector(".n3-liaison line");

  it("relie la pièce appuyée à la commande qui reçoit la réponse, puis s'efface avec les coins", () => {
    const m = monter();
    const { container } = m;
    boites(container, { A: [150, 100], b0: [400, 120] });
    m.emettre({ type: "etape", control: "A" });
    expect(ligne(container)).toBeNull();
    m.emettre({ type: "recu", control: "A", indice: "b0" });
    const trait = ligne(container)!;
    // Du centre de la pièce appuyée au centre de la commande, dans la racine.
    expect([...["x1", "y1", "x2", "y2"].map((a) => trait.getAttribute(a))]).toEqual([
      "300",
      "70",
      "50",
      "50",
    ]);
    vi.advanceTimersByTime(MARQUES.coins);
    expect(container.querySelector(".n3-liaison")).toHaveAttribute("data-marque", "efface");
    vi.advanceTimersByTime(MARQUES.efface);
    expect(container.querySelector(".n3-liaison")).toBeNull();
  });

  it("se tire sans étape (« Changer »), survit à l'étape suivante et cède à la réponse suivante", () => {
    const m = monter();
    const { container } = m;
    boites(container, { A: [150, 100], B: [160, 90], b0: [400, 120], b1: [420, 110] });
    // « Changer » : aucune étape, la réponse nomme sa commande.
    m.emettre({ type: "recu", control: "B", indice: "b0" });
    expect(ligne(container)?.getAttribute("x2")).toBe("60");
    expect(m.marque("b0")).toBe("coins");
    vi.advanceTimersByTime(MARQUES.coins + MARQUES.efface);
    expect(ligne(container)).toBeNull();
    // Le pas à pas : la réponse et l'étape suivante arrivent ensemble.
    m.emettre({ type: "etape", control: "A" });
    m.emettre({ type: "recu", control: "A", indice: "b0" });
    m.emettre({ type: "etape", control: "B" });
    expect(container.querySelectorAll(".n3-liaison")).toHaveLength(1);
    expect(ligne(container)?.getAttribute("x2")).toBe("50");
    // La réponse suivante remplace la ligne : une seule à la fois.
    m.emettre({ type: "recu", control: "B", indice: "b1" });
    expect(container.querySelectorAll(".n3-liaison")).toHaveLength(1);
    expect(ligne(container)?.getAttribute("x2")).toBe("60");
    // Un débranchement l'efface aussitôt.
    m.emettre({ type: "suspendu" });
    expect(container.querySelector(".n3-liaison")).toBeNull();
  });
});
