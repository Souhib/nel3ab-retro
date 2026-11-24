/** Le panneau « Touches et manettes », Dolphin et Pro, sur son vrai balisage. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContexteArbitre } from "../../components/Cadre";
import type { Arbitre } from "../../lib/scenes-salle";
import type { EvenementReglage, InputState } from "../../media/input";
import { InputStream } from "../../media/input";
import { standardProfile } from "../../media/pad";
import { SwitchInput } from "../../media/switch";
import type { Onglet } from "../entree";
import type { EntreeDolphin, TrameDolphin } from "./Dolphin";
import { montrerLaTete, Reglage } from "./Reglage";
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
    keyProfileNamed: vi.fn(() => null),
    rendreKeys: vi.fn(),
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

describe("l'état de la salle dans le panneau", () => {
  const pleins = (container: HTMLElement) =>
    [...container.querySelectorAll(".rt-bouton-plein")].map((b) => b.textContent);

  it("une salle figée a sa bande, et son action est le seul bouton plein", () => {
    const relancer = vi.fn();
    const { input } = doublure();
    const { container } = render(
      <Reglage
        onglet="manette"
        onOnglet={rien}
        onFermer={rien}
        autres={false}
        vit={false}
        bande={{
          phrase: "L'image ne bouge plus.",
          action: { nom: "Relancer l'image", faire: relancer },
        }}
        trame={{
          genre: "dolphin",
          console: "gc",
          tenue: 0,
          state: etat(XBOX),
          input,
          refresh: rien,
        }}
      />,
    );
    const bande = container.querySelector("[data-bande]")!;
    expect(bande.textContent).toContain("L'image ne bouge plus.");
    expect(pleins(container)).toEqual(["Relancer l'image"]);
    fireEvent.click(screen.getByRole("button", { name: "Relancer l'image" }));
    expect(relancer).toHaveBeenCalledTimes(1);
  });

  it("une salle qui vit n'a pas de bande, et « Régler pas à pas » reste plein", () => {
    const { container } = monterDolphin({ state: etat(XBOX) });
    expect(container.querySelector("[data-bande]")).toBeNull();
    expect(pleins(container)).toEqual(["Régler pas à pas"]);
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

// La relecture du 24 novembre 2026 : « Régler pas à pas » et « Commencer »
// disparaissent à leur propre clic, et le focus tombait sur le document. Ni
// l'Échap du panneau ni un lecteur d'écran ne le retrouvaient : l'invite ne se
// fermait pas, et un pas à pas arrêté laissait le panneau ouvert à Échap.
describe("le focus du pas à pas", () => {
  const dans = () => document.activeElement?.closest("[data-reglage]") ?? null;
  const bouton = (nom: string) => screen.getByRole("button", { name: nom });
  const LECON = { control: "A" as const, step: 1, total: 16, waiting: false };

  it("suit chaque geste, et Échap remonte d'un cran à la fois jusqu'à fermer", async () => {
    const { input, onFermer, poser } = monterDolphin({ state: etat(XBOX) });
    bouton("Régler pas à pas").focus();
    fireEvent.click(bouton("Régler pas à pas"));
    await act(image);
    expect(document.activeElement).toBe(bouton("Commencer"));
    // Échap annule l'invite seule, et rend le focus à « Régler pas à pas ».
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await act(image);
    expect(screen.queryByRole("button", { name: "Commencer" })).toBeNull();
    expect(onFermer).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(bouton("Régler pas à pas"));
    fireEvent.click(bouton("Régler pas à pas"));
    await act(image);
    fireEvent.click(bouton("Commencer"));
    expect(input.beginLesson).toHaveBeenCalledTimes(1);
    poser(etat({ ...XBOX, lesson: LECON }));
    await act(image);
    expect(document.activeElement?.closest("[data-pas-a-pas]")).not.toBeNull();
    // Échap arrête le pas à pas ; la salle relit l'instantané sans leçon.
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(input.cancelCapture).toHaveBeenCalledTimes(1);
    poser(etat(XBOX));
    await act(image);
    expect(document.activeElement).toBe(bouton("Régler pas à pas"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onFermer).toHaveBeenCalledTimes(1);
  });

  it("à la fin, va à la première commande passée", async () => {
    const { poser } = monterDolphin({ state: etat({ ...XBOX, lesson: LECON }) });
    bouton("Passer cette commande").focus();
    poser(etat({ ...XBOX, lessonResult: { retenues: 15, passees: ["B"], garde: "avant" } }));
    await act(image);
    expect(document.activeElement).toBe(bouton("Régler B dans la liste"));
  });

  it("à la fin sans commande passée, va à « Régler pas à pas »", async () => {
    const { poser } = monterDolphin({ state: etat({ ...XBOX, lesson: LECON }) });
    bouton("Passer cette commande").focus();
    poser(etat({ ...XBOX, lessonResult: { retenues: 16, passees: [], garde: "avant" } }));
    await act(image);
    expect(dans()).not.toBeNull();
    expect(document.activeElement).toBe(bouton("Régler pas à pas"));
  });

  it("un débranchement mène à « Reprendre »", async () => {
    const { poser } = monterDolphin({ state: etat({ ...XBOX, lesson: LECON }) });
    bouton("Passer cette commande").focus();
    poser(etat({ ...XBOX, suspendu: { etape: 4, total: 16, id: XBOX.padId } }));
    await act(image);
    expect(document.activeElement).toBe(bouton("Reprendre à l'étape 4"));
  });

  it("ne reprend jamais un focus posé hors du panneau", async () => {
    const { poser } = monterDolphin({ state: etat({ ...XBOX, lesson: LECON }) });
    const dehors = document.createElement("button");
    document.body.append(dehors);
    dehors.focus();
    poser(etat({ ...XBOX, lessonResult: { retenues: 16, passees: [], garde: "avant" } }));
    await act(image);
    expect(document.activeElement).toBe(dehors);
    // Ni une étape qui commence.
    poser(etat({ ...XBOX, lesson: LECON }));
    await act(image);
    expect(document.activeElement).toBe(dehors);
    dehors.remove();
  });

  it("vaut aussi pour la trame Pro", async () => {
    const source = new SwitchInput();
    const pad = {
      id: "Xbox Wireless Controller",
      index: 0,
      connected: true,
      mapping: "standard",
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false, touched: false })),
    } as unknown as Gamepad;
    source.poll(new Set(), [pad]);
    const onFermer = vi.fn();
    const trame: TramePro = {
      genre: "pro",
      console: "Switch",
      xbox: false,
      manette: "manette Pro",
      source,
      input: { switchActive: () => true, surReglage: () => rien },
      place: 1,
    };
    render(
      <Reglage
        onglet="manette"
        onOnglet={rien}
        onFermer={onFermer}
        autres={false}
        vit
        trame={trame}
      />,
    );
    bouton("Régler pas à pas").focus();
    fireEvent.click(bouton("Régler pas à pas"));
    await act(image);
    expect(document.activeElement).toBe(bouton("Commencer"));
    fireEvent.click(bouton("Commencer"));
    await act(image);
    expect(source.lecon).not.toBeNull();
    expect(document.activeElement?.closest("[data-pas-a-pas]")).not.toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await act(image);
    expect(source.lecon).toBeNull();
    expect(document.activeElement).toBe(bouton("Régler pas à pas"));
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

  it("pose l'icône de manette en pixels devant le nom, cachée au lecteur d'écran", () => {
    monterDolphin({ state: etat(XBOX) });
    const icone = document.querySelector("[data-appareil] strong .rt-icone-pixel");
    expect(icone).not.toBeNull();
    expect(icone?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("n'a pas d'icône de manette quand aucune manette n'est vue", () => {
    monterDolphin();
    expect(document.querySelector("[data-appareil] .rt-icone-pixel")).toBeNull();
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
      input: { switchActive: () => true, surReglage: () => rien },
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
    // Sans manette vue, la droite est une silhouette ; la gauche reste entière.
    const dessins = container.querySelectorAll(".n3-dessins [data-padmap]");
    expect(dessins[1]).toHaveAttribute("data-absente", "oui");
    expect(dessins[0]).not.toHaveAttribute("data-absente");
    expect(screen.getAllByText("Pas transmis au jeu : le bouton Guide.").length).toBeGreaterThan(0);
  });

  it("pose aussi l'icône de manette en pixels devant le nom d'une manette Pro", () => {
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
      place: 1,
    };
    render(
      <Reglage onglet="manette" onOnglet={rien} onFermer={rien} autres={false} vit trame={trame} />,
    );
    expect(document.querySelector("[data-appareil] strong .rt-icone-pixel")).not.toBeNull();
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
      input: { switchActive: () => true, surReglage: () => rien },
      place: null,
    };
    render(
      <Reglage onglet="profils" onOnglet={rien} onFermer={rien} autres={false} vit trame={trame} />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Course" } });
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(Object.keys(source.named)).toEqual([]);
    // « Annuler » rend le profil tel qu'il était, une seule fois.
    expect(screen.getByText("Le profil « Course » est supprimé.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(Object.keys(source.named)).toEqual(["Course"]);
    expect(screen.queryByRole("button", { name: "Annuler" })).toBeNull();
  });

  it("ne propose pas d'annuler tant que rien n'est supprimé", () => {
    const source = new SwitchInput();
    source.save("Course");
    render(
      <Reglage
        onglet="profils"
        onOnglet={rien}
        onFermer={rien}
        autres={false}
        vit
        trame={{
          genre: "pro",
          console: "Switch",
          xbox: false,
          manette: "manette Pro",
          source,
          input: { switchActive: () => true, surReglage: () => rien },
          place: null,
        }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Annuler" })).toBeNull();
  });
});

describe("les profils du clavier", () => {
  it("rend un profil supprimé sur « Annuler », en service s'il l'était", () => {
    const vrai = new InputStream(() => "", rien);
    vrai.newKeys("Course");
    const { input } = doublure();
    input.forgetKeys.mockImplementation((nom: string) => vrai.forgetKeys(nom));
    const rendreKeys = vi.fn((nom: string, profil, actif: boolean) =>
      vrai.rendreKeys(nom, profil, actif),
    );
    const trame: TrameDolphin = {
      genre: "dolphin",
      console: "gc",
      tenue: 0,
      state: vrai.state(),
      input: { ...input, keyProfileNamed: (nom) => vrai.keyProfileNamed(nom), rendreKeys },
      refresh: rien,
    };
    render(
      <Reglage onglet="profils" onOnglet={rien} onFermer={rien} autres={false} vit trame={trame} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(vrai.state().keyProfiles).not.toContain("Course");
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(rendreKeys).toHaveBeenCalledTimes(1);
    expect(vrai.state().keyProfiles).toContain("Course");
    expect(vrai.state().keyProfile).toBe("Course");
  });
});

describe("la manette qui arrive", () => {
  it("dit la première manette vue par la page, sans jouer de scène (K09)", () => {
    const { emettre, demander, container } = monterDolphin();
    expect(container.querySelector("[data-arrivee]")).toBeNull();
    act(() => emettre({ type: "premiere-manette", id: "Xbox Wireless Controller" }));
    expect(container.querySelector("[data-arrivee]")?.textContent).toBe(
      "Manette Xbox branchée : elle apparaît à droite.",
    );
    expect(container.querySelector("[data-arrivee]")).toHaveAttribute("role", "status");
    expect(demander).not.toHaveBeenCalled();
  });

  it("montre une silhouette tramée à droite tant qu'aucune manette n'est vue", () => {
    const sans = monterDolphin().container;
    const droite = () => sans.querySelectorAll(".n3-dessins [data-padmap]")[1];
    expect(droite()).toHaveAttribute("data-absente", "oui");
    // Le dessin du jeu n'est jamais absent : c'est ce que le jeu reçoit.
    expect(sans.querySelector(".n3-dessins [data-padmap]")).not.toHaveAttribute("data-absente");
    const avec = monterDolphin({
      state: etat({
        ...XBOX,
        using: 0,
        pads: [{ index: 0, id: XBOX.padId, buttons: 17, axes: 4 }],
      }),
    }).container;
    expect(avec.querySelectorAll(".n3-dessins [data-padmap]")[1]).not.toHaveAttribute(
      "data-absente",
    );
  });
});

describe("la commande tenue", () => {
  it("marque sa ligne quand la boucle de peinture l'allume, et seulement elle", async () => {
    // La vraie boucle de peinture du dessin lit cette manette : B (b1) tenu.
    const manette = {
      id: XBOX.padId,
      index: 0,
      mapping: "standard",
      connected: true,
      timestamp: 1,
      buttons: Array.from({ length: 17 }, (_, at) => ({
        pressed: at === 1,
        touched: at === 1,
        value: at === 1 ? 1 : 0,
      })),
      axes: [0, 0, 0, 0],
    } as unknown as Gamepad;
    const avant = navigator.getGamepads;
    navigator.getGamepads = () => [manette];
    try {
      const { container } = monterDolphin({
        state: etat({ ...XBOX, port: 2, using: 0, profile: standardProfile(XBOX.padId) }),
      });
      expect(container.querySelector("#reglage")).toHaveAttribute("data-place", "2");
      await act(() => image());
      await act(() => new Promise((fin) => setTimeout(fin, 0)));
      const tenues = [...container.querySelectorAll<HTMLElement>("tr[data-tenu]")];
      expect(tenues.map((tr) => tr.dataset["cle"])).toEqual(["B"]);
    } finally {
      navigator.getGamepads = avant;
    }
  });
});

describe("les marques dans le panneau", () => {
  it("la boucle pose le cadre sur la commande attendue, sans passer par React", () => {
    const { container, emettre } = monterDolphin({ state: etat(XBOX) });
    const a = container.querySelector('[data-part="A"]');
    expect(a).not.toHaveAttribute("data-marque");
    emettre({ type: "etape", control: "A", etape: 1, total: 16 });
    expect(a).toHaveAttribute("data-marque", "cadre");
  });
});

describe("une copie qui attend le service", () => {
  const monterEnvoi = (attend: { valeur: boolean }) => {
    const reessayer = vi.fn(async () => {
      attend.valeur = false;
    });
    const { input } = doublure();
    render(
      <Reglage
        onglet="profils"
        onOnglet={rien}
        onFermer={rien}
        autres={false}
        vit
        trame={{
          genre: "dolphin",
          console: "gc",
          tenue: 0,
          state: etat(),
          input,
          refresh: rien,
          envoi: { enAttente: () => attend.valeur, reessayer },
        }}
      />,
    );
    return reessayer;
  };

  it("dit « gardé ici » et renvoie sur « Réessayer maintenant »", async () => {
    const reessayer = monterEnvoi({ valeur: true });
    expect(screen.getByText("Gardé ici, envoi au prochain passage.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Réessayer maintenant" }));
    });
    expect(reessayer).toHaveBeenCalledTimes(1);
    // L'envoi accepté, la mention s'en va.
    expect(screen.queryByText("Gardé ici, envoi au prochain passage.")).toBeNull();
  });

  it("ne dit rien quand rien n'attend", () => {
    monterEnvoi({ valeur: false });
    expect(screen.queryByText(/Gardé ici/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Réessayer maintenant" })).toBeNull();
  });
});

describe("les nombres de ta manette, trame Pro", () => {
  it("passent par le banc, jamais par un bloc JSON", () => {
    const source = new SwitchInput();
    const manette = {
      id: "Xbox Wireless Controller (STANDARD GAMEPAD)",
      index: 0,
      mapping: "standard",
      connected: true,
      timestamp: 1,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      axes: [0, 0, 0, 0],
    } as unknown as Gamepad;
    source.poll(new Set(), [manette]);
    expect(source.raw).not.toBeNull();
    const { container } = render(
      <Reglage
        onglet="manette"
        onOnglet={rien}
        onFermer={rien}
        autres={false}
        vit
        trame={{
          genre: "pro",
          console: "Switch",
          xbox: false,
          manette: "manette Pro",
          source,
          input: { switchActive: () => true, surReglage: () => rien },
          place: 1,
        }}
      />,
    );
    const nombres = container.querySelector(".n3-nombres")!;
    expect(nombres.querySelector("[data-bench]")).not.toBeNull();
    expect(nombres.querySelector("pre")).toBeNull();
    expect(nombres.textContent).not.toContain("{");
  });
});

describe("montrerLaTete", () => {
  /** Une colonne qui défile, un bloc qui ne défile pas, et le panneau
   * dedans ; `haut` place la tête du panneau, la colonne commence à 100. */
  function colonne(haut: number) {
    const col = document.createElement("div");
    col.style.overflowY = "auto";
    const bloc = document.createElement("div");
    const panneau = document.createElement("section");
    bloc.append(panneau);
    col.append(bloc);
    document.body.append(col);
    col.scrollTop = 200;
    const boite = (top: number) => ({ top }) as DOMRect;
    col.getBoundingClientRect = () => boite(100);
    // Le bloc ne défile pas : son haut ne compte pas.
    bloc.getBoundingClientRect = () => boite(-500);
    panneau.getBoundingClientRect = () => boite(haut);
    return { col, panneau };
  }

  it("ramène en haut de la colonne une tête cachée au-dessus", () => {
    const { col, panneau } = colonne(60);
    montrerLaTete(panneau);
    expect(col.scrollTop).toBe(160);
    col.remove();
  });

  it("ne bouge pas une tête déjà visible", () => {
    const { col, panneau } = colonne(130);
    montrerLaTete(panneau);
    expect(col.scrollTop).toBe(200);
    col.remove();
  });
});
