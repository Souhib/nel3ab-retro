/** Le panneau « Touches et manettes », Dolphin et Pro, sur son vrai balisage. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContexteArbitre } from "../../components/Cadre";
import type { Arbitre } from "../../lib/scenes-salle";
import type { EvenementReglage, InputState } from "../../media/input";
import { InputStream } from "../../media/input";
import { SwitchInput } from "../../media/switch";
import type { Onglet } from "../entree";
import type { EntreeDolphin, TrameDolphin } from "./Dolphin";
import { Reglage } from "./Reglage";
import type { TramePro } from "./Pro";

const rien = () => {};
const image = () => new Promise((fin) => requestAnimationFrame(fin));

afterEach(() => localStorage.clear());

/** Une boucle d'entrée doublée : chaque geste est un espion, et `surReglage`
 * garde ses abonnés pour qu'un essai émette la fin. */
function doublure() {
  const ecoutes = new Set<(e: EvenementReglage) => void>();
  const input = {
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
    surReglage: (ecoute: (e: EvenementReglage) => void) => {
      ecoutes.add(ecoute);
      return () => ecoutes.delete(ecoute);
    },
  } satisfies EntreeDolphin;
  const emettre = (e: EvenementReglage) => ecoutes.forEach((ecoute) => ecoute(e));
  return { input, emettre };
}

const etat = (patch: Partial<InputState> = {}): InputState => ({
  ...new InputStream(() => "", rien).state(),
  ...patch,
});
const XBOX = { padId: "Xbox Wireless Controller", padLayout: "standard" as const };

/** Le panneau tenu par un parent qui garde l'onglet et l'état, comme la salle. */
function monterDolphin({
  state = etat(),
  autres = false,
  vit = true,
  onglet = "manette" as Onglet,
  console = "gc",
  tenue = 0 as 0 | 1 | 2 | 3,
  actions,
}: {
  state?: InputState;
  autres?: boolean;
  vit?: boolean;
  onglet?: Onglet;
  console?: string;
  tenue?: 0 | 1 | 2 | 3;
  actions?: Record<string, string>;
} = {}) {
  const { input, emettre } = doublure();
  const onFermer = vi.fn();
  const demander = vi.fn(() => null);
  const arbitre: Arbitre = { demander, couper: rien, enCours: () => null };
  let poser: (s: InputState) => void = rien;
  function Parent() {
    const [ouvert, setOuvert] = useState(onglet);
    const [vu, setVu] = useState(state);
    poser = setVu;
    const trame: TrameDolphin = {
      genre: "dolphin",
      console,
      tenue,
      actions,
      state: vu,
      input,
      refresh: rien,
    };
    return (
      <ContexteArbitre.Provider value={arbitre}>
        <Reglage
          onglet={ouvert}
          onOnglet={setOuvert}
          onFermer={onFermer}
          autres={autres}
          vit={vit}
          trame={trame}
        />
      </ContexteArbitre.Provider>
    );
  }
  const vue = render(<Parent />);
  return {
    ...vue,
    input,
    emettre,
    onFermer,
    demander,
    poser: (s: InputState) => act(() => poser(s)),
  };
}

describe("la tête du panneau", () => {
  it("n'a qu'un bouton pour sortir, « Fermer »", () => {
    monterDolphin();
    expect(screen.getAllByRole("button", { name: "Fermer" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Terminé|×/ })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("dit que les autres jouent seulement quand une autre place est tenue en partie", () => {
    const { container } = monterDolphin({ autres: true });
    expect(container.querySelector(".n3-reglage-tete p")?.textContent).toBe(
      "Pendant ce réglage, le jeu ne reçoit pas tes appuis. Les autres continuent de jouer.",
    );
    const seul = monterDolphin({ autres: false }).container;
    expect(seul.querySelector(".n3-reglage-tete p")?.textContent).not.toContain("Les autres");
  });
});

describe("les onglets", () => {
  it("passent d'un onglet à l'autre aux flèches, Début et Fin, et le focus suit", () => {
    monterDolphin();
    const manette = screen.getByRole("tab", { name: "Manette" });
    expect(manette).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(manette);
    fireEvent.keyDown(manette, { key: "ArrowRight" });
    const clavier = screen.getByRole("tab", { name: "Clavier" });
    expect(clavier).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(clavier);
    fireEvent.keyDown(clavier, { key: "End" });
    expect(screen.getByRole("tab", { name: "Profils" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Manette" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Profils" })).toHaveAttribute("aria-selected", "true");
  });

  it("ne bougent pas pendant un pas à pas", () => {
    monterDolphin({
      state: etat({ ...XBOX, lesson: { control: "A", step: 3, total: 16, waiting: false } }),
    });
    const manette = screen.getByRole("tab", { name: "Manette" });
    fireEvent.keyDown(manette, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("tab", { name: "Profils" }));
    expect(manette).toHaveAttribute("aria-selected", "true");
  });
});

describe("Échap", () => {
  it("annule d'abord le changement, rend le focus à « Changer », puis ferme", async () => {
    const { input, onFermer, poser } = monterDolphin({
      state: etat({ ...XBOX, capturing: { control: "A", source: "pad" } }),
    });
    const ligne = screen.getByText("Appuie sur un bouton de ta manette");
    fireEvent.keyDown(ligne, { key: "Escape" });
    expect(input.cancelCapture).toHaveBeenCalledTimes(1);
    expect(onFermer).not.toHaveBeenCalled();
    poser(etat(XBOX));
    await act(image);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Changer A" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onFermer).toHaveBeenCalledTimes(1);
  });
});

describe("le pas à pas", () => {
  it("remplace la liste par la consigne et une jauge de seize segments", () => {
    const { container } = monterDolphin({
      state: etat({ ...XBOX, lesson: { control: "B", step: 3, total: 16, waiting: false } }),
    });
    expect(container.querySelector(".n3-correspondances")).toBeNull();
    const jauge = screen.getByRole("progressbar");
    expect(jauge).toHaveAttribute("aria-valuenow", "2");
    expect(jauge.querySelectorAll("span")).toHaveLength(16);
    expect(jauge.querySelectorAll('[data-plein="oui"]')).toHaveLength(2);
    expect(screen.getByText("Appuie sur ce que tu veux pour B.")).toBeTruthy();
    // Le jumeau : sans leçon, la liste est là et la jauge non.
    const libre = monterDolphin({ state: etat(XBOX) }).container;
    expect(libre.querySelector(".n3-correspondances")).not.toBeNull();
    expect(libre.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("compte la fin et mène à la première commande passée", async () => {
    monterDolphin({
      state: etat({
        ...XBOX,
        lessonResult: { retenues: 13, passees: ["B", "Z", "START"], garde: "avant" },
      }),
    });
    expect(screen.getByText(/^13 commandes réglées\. Tu as passé B, Z et Start/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Régler B dans la liste" }));
    await act(image);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Changer B" }));
  });

  it("propose de reprendre à l'étape où la manette s'est débranchée, ou d'oublier", () => {
    const { input } = monterDolphin({
      state: etat({ ...XBOX, suspendu: { etape: 5, total: 16, id: XBOX.padId } }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Reprendre à l'étape 5" }));
    expect(input.reprendreLecon).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "D'accord" }));
    expect(input.oublierSuspension).toHaveBeenCalledTimes(1);
  });

  it("sans manette, dit pourquoi, et ne propose pas de régler", () => {
    monterDolphin();
    expect(screen.getByText(/ne voit aucune manette/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Régler pas à pas" })).toBeNull();
    monterDolphin({ state: etat(XBOX) });
    expect(screen.getByRole("button", { name: "Régler pas à pas" })).toBeTruthy();
  });
});

describe("la scène de fin", () => {
  const fin = (retenues: number): EvenementReglage => ({
    type: "fin",
    resultat: { retenues, passees: [], garde: "avant" },
  });

  it("joue « fier » une fois quand le pas à pas retient quelque chose et que la salle vit", () => {
    const { emettre, demander } = monterDolphin({ state: etat(XBOX) });
    act(() => emettre(fin(13)));
    expect(demander).toHaveBeenCalledTimes(1);
    expect(demander).toHaveBeenCalledWith({ scene: "fier", par: "manettes", hote: "coin" });
  });

  it("ne joue rien quand tout a été passé, ni quand la salle ne vit pas", () => {
    const passe = monterDolphin({ state: etat(XBOX) });
    act(() => passe.emettre(fin(0)));
    expect(passe.demander).not.toHaveBeenCalled();
    const repos = monterDolphin({ state: etat(XBOX), vit: false });
    act(() => repos.emettre(fin(13)));
    expect(repos.demander).not.toHaveBeenCalled();
  });
});

describe("la lecture d'un jeu Wii", () => {
  it("dit qu'un autre appareil n'est qu'un aperçu, et cache les actions du jeu", () => {
    monterDolphin({ state: etat(XBOX), console: "wii", tenue: 1, actions: { A: "sauter" } });
    expect(screen.getByText("sauter")).toBeTruthy();
    expect(screen.queryByText(/Aperçu seulement/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /guitare/i }));
    expect(screen.getByText(/Aperçu seulement/)).toBeTruthy();
    expect(screen.queryByText("sauter")).toBeNull();
  });
});

describe("la trame Pro", () => {
  const monterPro = (console: "Switch" | "Xbox 360", onglet: Onglet = "manette") => {
    const source = new SwitchInput();
    const trame: TramePro = {
      genre: "pro",
      console,
      xbox: console === "Xbox 360",
      manette: console === "Xbox 360" ? "manette Xbox 360" : "manette Pro",
      source,
      input: { switchActive: () => true },
      place: 2,
    };
    const vue = render(
      <Reglage onglet={onglet} onOnglet={rien} onFermer={rien} autres={false} vit trame={trame} />,
    );
    return { ...vue, source };
  };

  it("nomme la Xbox 360 sans jamais dire Switch, et ne prend pas le mot « Reprendre »", () => {
    const { container } = monterPro("Xbox 360");
    expect(container.querySelector(".n3-reglage-tete p")?.textContent).toBe(
      "Pendant ce réglage, la Xbox 360 ne reçoit pas tes appuis.",
    );
    expect(container.textContent).not.toContain("Switch");
    expect(screen.queryByRole("button", { name: "Reprendre" })).toBeNull();
    expect(screen.getAllByText("Pas transmis au jeu : le bouton Guide.").length).toBeGreaterThan(0);
  });

  it("a les mêmes onglets que Dolphin, et vingt-quatre lignes sans point médian", () => {
    const { container } = monterPro("Switch");
    expect(screen.getAllByRole("tab").map((tab) => tab.id)).toEqual([
      "onglet-manette",
      "onglet-clavier",
      "onglet-profils",
    ]);
    const lignes = container.querySelectorAll(".n3-correspondances tbody tr");
    expect(lignes).toHaveLength(24);
    expect([...lignes].some((ligne) => ligne.textContent?.includes("·"))).toBe(false);
    expect(screen.getByText("Pas transmis au jeu : Home, Capture, gyroscope.")).toBeTruthy();
  });

  it("supprime un profil Pro nommé", () => {
    const source = new SwitchInput();
    source.save("Course");
    const trame: TramePro = {
      genre: "pro",
      console: "Switch",
      xbox: false,
      manette: "manette Pro",
      source,
      input: { switchActive: () => true },
      place: null,
    };
    render(
      <Reglage onglet="profils" onOnglet={rien} onFermer={rien} autres={false} vit trame={trame} />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Course" } });
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(Object.keys(source.named)).toEqual([]);
  });
});
