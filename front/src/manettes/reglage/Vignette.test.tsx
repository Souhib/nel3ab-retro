/** Changement 12 : pendant un « Changer », la ligne montre la pièce attendue
 * quand le dessin est sorti de l'écran, et seulement alors. jsdom n'a pas
 * d'`IntersectionObserver` : un double rend ce que le navigateur verrait
 * (`reglage.mjs`, étape changer-visible, le prouve dans Chrome). */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputStream, type InputState } from "../../media/input";
import { SwitchInput } from "../../media/switch";
import type { EntreeDolphin, TrameDolphin } from "./Dolphin";
import type { TramePro } from "./Pro";
import { Reglage } from "./Reglage";

const rien = () => {};

/** Le double : chaque observateur garde ses cibles ; `voir(ratio)` leur rend
 * la part visible, comme le navigateur au défilement. */
class Observateur {
  static tous: Observateur[] = [];
  cibles: Element[] = [];
  coupe = false;
  rappel: (vues: Partial<IntersectionObserverEntry>[]) => void;
  constructor(rappel: (vues: Partial<IntersectionObserverEntry>[]) => void) {
    this.rappel = rappel;
    Observateur.tous.push(this);
  }
  observe(cible: Element) {
    this.cibles.push(cible);
  }
  disconnect() {
    this.coupe = true;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}
const voir = (ratio: number) =>
  act(() => {
    for (const un of Observateur.tous.filter((o) => !o.coupe))
      un.rappel(
        un.cibles.map((target) => ({
          target,
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
        })),
      );
  });

beforeEach(() => {
  Observateur.tous = [];
  vi.stubGlobal("IntersectionObserver", Observateur);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const entree = (): EntreeDolphin => ({
  beginCapture: vi.fn(),
  cancelCapture: vi.fn(),
  beginLesson: vi.fn(),
  skipLessonStep: vi.fn(),
  reprendreLecon: vi.fn(() => true),
  oublierSuspension: vi.fn(),
  useP: vi.fn(),
  resetPad: vi.fn(),
  resetKeys: vi.fn(),
  pickKeys: vi.fn(),
  newKeys: vi.fn(),
  forgetKeys: vi.fn(),
  keyProfileNamed: vi.fn(() => null),
  rendreKeys: vi.fn(),
  surReglage: () => rien,
});

const etat = (patch: Partial<InputState>): InputState => ({
  ...new InputStream(() => "", rien).state(),
  padId: "Xbox Wireless Controller",
  padLayout: "standard",
  ...patch,
});

function monterDolphin(state: InputState) {
  const trame: TrameDolphin = {
    genre: "dolphin",
    console: "gc",
    tenue: 0,
    state,
    input: entree(),
    refresh: rien,
  };
  const vue = render(
    <Reglage onglet="manette" onOnglet={rien} onFermer={rien} autres={false} vit trame={trame} />,
  );
  return {
    ...vue,
    changer: (patch: Partial<InputState>) =>
      vue.rerender(
        <Reglage
          onglet="manette"
          onOnglet={rien}
          onFermer={rien}
          autres={false}
          vit
          trame={{ ...trame, state: { ...state, ...patch } }}
        />,
      ),
  };
}

const ligne = (cle: string) => document.querySelector(`tr[data-cle="${cle}"]`)!;

describe("la vignette d'un changement Dolphin", () => {
  it("se pose dans la ligne quand la pièce attendue n'est pas entière à l'écran", () => {
    monterDolphin(etat({ capturing: { control: "B", source: "pad" }, port: 2 }));
    // L'observateur suit la pièce B du dessin du jeu, pas celle d'un autre.
    const suivie = Observateur.tous[0]?.cibles[0];
    expect(suivie?.getAttribute("data-part")).toBe("B");
    expect(suivie?.closest(".n3-dessins")).not.toBeNull();
    voir(0.3);
    const vignette = ligne("B").querySelector("svg.n3-vignette");
    expect(vignette).not.toBeNull();
    expect(vignette).toHaveAttribute("aria-hidden", "true");
    expect(vignette).toHaveAttribute("data-place", "2");
    // Recadrée autour de B, encadrée de ses coins.
    const [x, y, l, h] = vignette!.getAttribute("viewBox")!.split(" ").map(Number);
    const b = vignette!.querySelector('[data-part="B"]')!;
    expect(b).toHaveAttribute("data-attendue", "oui");
    expect(l).toBe(h);
    expect(l).toBeLessThan(30);
    expect(x! + l! / 2).toBeGreaterThan(0);
    expect(y! + h! / 2).toBeGreaterThan(0);
    // Une seule vignette : les autres lignes n'en portent pas.
    expect(document.querySelectorAll(".n3-vignette")).toHaveLength(1);
  });

  it("n'est pas montée quand le dessin se voit en entier, ni sans changement", () => {
    const { changer } = monterDolphin(etat({ capturing: { control: "B", source: "pad" } }));
    voir(1);
    expect(document.querySelector(".n3-vignette")).toBeNull();
    // Le dessin sort de la vue : la vignette vient ; il revient : elle part.
    voir(0);
    expect(ligne("B").querySelector(".n3-vignette")).not.toBeNull();
    voir(1);
    expect(document.querySelector(".n3-vignette")).toBeNull();
    // Le changement fini, l'observateur est coupé et rien ne reste.
    voir(0);
    changer({ capturing: null });
    expect(Observateur.tous.every((un) => un.coupe)).toBe(true);
    expect(document.querySelector(".n3-vignette")).toBeNull();
  });

  it("ne vaut pas pour la pièce suivante : un nouveau changement repart du dessin", () => {
    const { changer } = monterDolphin(etat({ capturing: { control: "B", source: "pad" } }));
    voir(0);
    expect(ligne("B").querySelector(".n3-vignette")).not.toBeNull();
    changer({ capturing: { control: "X", source: "pad" } });
    // Le constat de B ne monte rien sous X avant que X soit vu.
    expect(document.querySelector(".n3-vignette")).toBeNull();
    expect(Observateur.tous.at(-1)?.cibles[0]?.getAttribute("data-part")).toBe("X");
  });

  it("ne vient pas sans IntersectionObserver : le dessin reste le repère", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("IntersectionObserver", undefined);
    monterDolphin(etat({ capturing: { control: "B", source: "pad" } }));
    expect(document.querySelector(".n3-vignette")).toBeNull();
  });

  it("ne suit rien pendant un changement au clavier, que la table du clavier dit", () => {
    monterDolphin(etat({ capturing: { control: "B", source: "key" } }));
    expect(Observateur.tous).toHaveLength(0);
  });
});

describe("la trame Pro pendant un changement", () => {
  const monterPro = () => {
    const source = new SwitchInput();
    const pad = {
      id: "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)",
      index: 0,
      connected: true,
      mapping: "standard",
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      timestamp: 1,
    } as unknown as Gamepad;
    source.poll(new Set(), [pad]);
    const trame: TramePro = {
      genre: "pro",
      console: "Xbox 360",
      xbox: true,
      manette: "manette Xbox 360",
      source,
      input: { switchActive: () => true, surReglage: () => rien },
      place: 3,
    };
    const vue = render(
      <Reglage onglet="manette" onOnglet={rien} onFermer={rien} autres={false} vit trame={trame} />,
    );
    return { ...vue, source };
  };

  it("encadre le stick sur le dessin quand on change l'un de ses sens", () => {
    const { container } = monterPro();
    act(() => {
      (document.getElementById("pad-lx+") as HTMLButtonElement).click();
    });
    const jeu = container.querySelector(".n3-dessins [data-padmap]")!;
    expect(jeu.querySelector('[data-part="LS"]')).toHaveAttribute("data-attendue", "oui");
    // Le jumeau : le stick droit n'est pas encadré.
    expect(jeu.querySelector('[data-part="RS"]')).not.toHaveAttribute("data-attendue");
  });

  it("pose la vignette du stick dans la ligne quand le dessin est hors de vue", () => {
    monterPro();
    act(() => {
      (document.getElementById("pad-ly-") as HTMLButtonElement).click();
    });
    voir(0);
    const vignette = ligne("ly-").querySelector("svg.n3-vignette");
    expect(vignette).toHaveAttribute("data-padmap", "xbox360");
    expect(vignette).toHaveAttribute("data-place", "3");
    expect(vignette?.querySelector('[data-part="LS"]')).toHaveAttribute("data-attendue", "oui");
    voir(1);
    expect(document.querySelector(".n3-vignette")).toBeNull();
  });
});
