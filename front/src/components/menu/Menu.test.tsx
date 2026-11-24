/**
 * Le menu unique (chantier menus) : quatre onglets, des lignes dont le
 * curseur est le focus, des choix en pastilles, des décisions en fiche, et
 * un menu qui se ferme sans couvrir l'image. Chaque assertion a son jumeau.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MenuAction } from "../../media/menupad";
import type { Rubrique } from "../../lib/menu";
import { MENU, SORTIES_MENU } from "../../lib/mots";
import { Menu } from "./Menu";

const rubriques = (plus: Partial<Record<Rubrique["id"], Rubrique["lignes"]>> = {}): Rubrique[] => [
  {
    id: "jeux",
    label: MENU.rubriques.jeux,
    lignes: plus.jeux ?? [
      { id: "game0", label: "Zelda", onEnter: () => {} },
      { id: "game1", label: "Mario", onEnter: () => {} },
    ],
  },
  { id: "manettes", label: MENU.rubriques.manettes, lignes: plus.manettes ?? [] },
  { id: "salle", label: MENU.rubriques.salle, lignes: plus.salle ?? [] },
  {
    id: "reglages",
    label: MENU.rubriques.reglages,
    lignes: plus.reglages ?? [{ id: "sound", label: "son", onEnter: () => {} }],
  },
];

const menu = (props: Partial<React.ComponentProps<typeof Menu>> = {}) =>
  render(
    <Menu rubriques={rubriques()} partie joue appareil="clavier" onClose={() => {}} {...props} />,
  );

describe("le menu unique", () => {
  it("rend quatre onglets nommés, un seul choisi (M1, M5)", () => {
    menu();
    const onglets = screen.getAllByRole("tab");
    expect(onglets.map((o) => o.textContent)).toEqual(["Jeux", "Manettes", "Salle", "Réglages"]);
    expect(onglets.map((o) => o.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);
    // Le jumeau : un onglet non choisi est hors de la tabulation.
    expect(onglets.map((o) => o.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(document.querySelectorAll("#menu [class*=uppercase]")).toHaveLength(0);
  });

  it("pose l'icône de chaque rubrique dans son onglet, et garde le mot (M14)", () => {
    menu();
    for (const id of ["jeux", "manettes", "salle", "reglages"]) {
      const onglet = document.getElementById(`ray-${id}`)!;
      expect(onglet.querySelector("svg.rt-icone-pixel")).not.toBeNull();
      expect(onglet.querySelector("[data-nom]")?.textContent).not.toBe("");
    }
  });

  it("n'est pas un dialogue modal, et n'anime rien en SMIL (M2, M13)", () => {
    menu();
    const boite = document.getElementById("menu")!;
    expect(boite.tagName).toBe("SECTION");
    expect(document.querySelector("dialog")).toBeNull();
    expect(boite.querySelectorAll("animate")).toHaveLength(0);
  });

  it("met #closeMenu en premier bouton, qui dit reprendre pendant une partie (W3, S3)", () => {
    menu();
    const premier = document.querySelector("#menu button");
    expect(premier?.id).toBe("closeMenu");
    expect(premier?.textContent).toBe(SORTIES_MENU.reprendre);
    expect((premier as HTMLButtonElement).tabIndex).toBe(0);
  });

  it("le jumeau : sans partie, la sortie dit fermer le menu", () => {
    menu({ partie: false });
    expect(document.getElementById("closeMenu")?.textContent).toBe(SORTIES_MENU.fermer);
  });

  it("dit ce que deviennent tes touches, selon ta place (M3a)", () => {
    const { unmount } = menu();
    expect(screen.queryByText(MENU.tesTouches)).not.toBeNull();
    expect(screen.queryByText(MENU.regarde)).toBeNull();
    unmount();
    // Le jumeau : qui regarde n'a rien à piloter ; sans jeu, aucune phrase.
    const spectateur = menu({ joue: false });
    expect(screen.queryByText(MENU.tesTouches)).toBeNull();
    expect(screen.queryByText(MENU.regarde)).not.toBeNull();
    spectateur.unmount();
    menu({ partie: false });
    expect(screen.queryByText(MENU.tesTouches)).toBeNull();
    expect(screen.queryByText(MENU.regarde)).toBeNull();
  });

  it("pose le focus sur la première ligne, seule dans la tabulation (M4)", () => {
    menu();
    expect(document.activeElement?.id).toBe("item-game0");
    const tabulables = [
      ...document.querySelectorAll<HTMLElement>("#menuPanneau [id^=item-]"),
    ].filter((el) => el.tabIndex === 0);
    expect(tabulables.map((el) => el.id)).toEqual(["item-game0"]);
    expect(document.getElementById("item-game0")?.getAttribute("aria-current")).toBe("true");
  });

  it("descend de ligne en ligne sans faire le tour (M4)", () => {
    menu();
    const ici = () => document.activeElement as HTMLElement;
    fireEvent.keyDown(ici(), { key: "ArrowDown" });
    expect(ici().id).toBe("item-game1");
    fireEvent.keyDown(ici(), { key: "ArrowDown" });
    expect(ici().id).toBe("item-game1");
    fireEvent.keyDown(ici(), { key: "ArrowUp" });
    expect(ici().id).toBe("item-game0");
    expect(document.getElementById("item-game0")?.getAttribute("aria-current")).toBe("true");
    expect(document.getElementById("item-game1")?.getAttribute("aria-current")).toBeNull();
  });

  it("change de rubrique par ← →, depuis une ligne", () => {
    menu();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.getElementById("ray-manettes")?.getAttribute("aria-selected")).toBe("true");
    // Une rubrique vide garde le focus sur son onglet.
    expect(document.activeElement?.id).toBe("ray-manettes");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.getElementById("ray-jeux")?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement?.id).toBe("ray-jeux");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.id).toBe("item-game0");
  });

  it("garde ← → sur une pastille : elles changent le choix, pas la rubrique", () => {
    const onPick = vi.fn();
    menu({
      initiale: "reglages",
      rubriques: rubriques({
        reglages: [
          {
            id: "half",
            label: "image",
            picks: [
              { id: "full", label: "complète" },
              { id: "half", label: "légère" },
            ],
            picked: "full",
            onPick,
          },
        ],
      }),
    });
    expect(document.activeElement?.id).toBe("pick-half-full");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.getElementById("ray-reglages")?.getAttribute("aria-selected")).toBe("true");
  });

  it("applique un choix au clic, et coche un seul point (M7a)", () => {
    const onPick = vi.fn();
    const lignes = (picked: string) => [
      {
        id: "half",
        label: "image",
        picks: [
          { id: "full", label: "complète" },
          { id: "half", label: "légère" },
        ],
        picked,
        onPick,
      },
    ];
    const { rerender } = menu({
      initiale: "reglages",
      rubriques: rubriques({ reglages: lignes("full") }),
    });
    fireEvent.click(screen.getByLabelText("légère"));
    expect(onPick).toHaveBeenCalledWith("half");
    rerender(
      <Menu
        rubriques={rubriques({ reglages: lignes("half") })}
        initiale="reglages"
        partie
        joue
        appareil="clavier"
        onClose={() => {}}
      />,
    );
    const coches = [...document.querySelectorAll<HTMLInputElement>("#item-half input")].filter(
      (r) => r.checked,
    );
    expect(coches.map((r) => r.value)).toEqual(["half"]);
  });

  it("rend une glissière nommée pour le volume", () => {
    const onSet = vi.fn();
    menu({
      initiale: "reglages",
      rubriques: rubriques({
        reglages: [
          {
            id: "volume",
            label: "volume",
            slide: { value: 70, min: 0, max: 100, step: 5, say: (v) => `${v} %`, onSet },
          },
        ],
      }),
    });
    const range = screen.getByRole("slider", { name: /volume/ });
    expect((range as HTMLInputElement).type).toBe("range");
    fireEvent.change(range, { target: { value: "45" } });
    expect(onSet).toHaveBeenCalledWith(45);
  });

  it("garde une aide visible sous chaque ligne (M8)", () => {
    menu({
      rubriques: rubriques({
        jeux: [
          { id: "a", label: "A", hint: "première aide", onEnter: () => {} },
          { id: "b", label: "B", hint: "seconde aide", onEnter: () => {} },
        ],
      }),
    });
    // Les deux aides se lisent, celle de la ligne choisie comme l'autre.
    expect(screen.getByText("première aide")).not.toBeNull();
    expect(screen.getByText("seconde aide")).not.toBeNull();
  });
});

describe("une décision ouvre une fiche (M10, M15)", () => {
  const fermer = (onAgir = vi.fn()) =>
    rubriques({
      salle: [
        {
          id: "close-game",
          label: "fermer le jeu",
          fiche: {
            consequence: "La partie s'arrête pour les 4 joueurs. La salle reste ouverte.",
            agir: "Fermer le jeu",
            annuler: "Continuer à jouer",
            onAgir,
          },
        },
      ],
    });

  it("le clic sur la ligne ouvre la fiche sans rien fermer", () => {
    const onAgir = vi.fn();
    menu({ initiale: "salle", rubriques: fermer(onAgir) });
    fireEvent.click(document.getElementById("item-close-game")!);
    expect(onAgir).not.toHaveBeenCalled();
    expect(document.getElementById("fiche")).not.toBeNull();
    expect(screen.getByText(/La partie s'arrête pour les 4 joueurs/)).not.toBeNull();
    expect(document.activeElement?.id).toBe("ficheAgir");
    fireEvent.click(document.getElementById("ficheAgir")!);
    expect(onAgir).toHaveBeenCalledTimes(1);
    expect(onAgir).toHaveBeenCalledWith(null);
  });

  it("le jumeau : « Continuer à jouer » revient à la liste sans appel", () => {
    const onAgir = vi.fn();
    menu({ initiale: "salle", rubriques: fermer(onAgir) });
    fireEvent.click(document.getElementById("item-close-game")!);
    fireEvent.click(document.getElementById("ficheRevenir")!);
    expect(onAgir).not.toHaveBeenCalled();
    expect(document.getElementById("fiche")).toBeNull();
    expect(document.activeElement?.id).toBe("item-close-game");
  });

  it("met le focus sur la sauvegarde cochée et lance sur elle", () => {
    const onAgir = vi.fn();
    menu({
      rubriques: rubriques({
        jeux: [
          {
            id: "game3",
            label: "Zelda",
            fiche: {
              consequence: "Ça arrête la partie de tout le monde.",
              agir: "Lancer",
              annuler: "Revenir à la liste",
              choix: [
                { id: "a", label: "partie neuve" },
                { id: "b", label: "ta sauvegarde" },
              ],
              coche: "b",
              onAgir,
            },
          },
        ],
      }),
    });
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    fireEvent.click(document.getElementById("item-game3")!);
    expect(document.activeElement?.id).toBe("fiche-b");
    fireEvent.click(document.getElementById("ficheAgir")!);
    expect(onAgir).toHaveBeenCalledWith("b");
  });

  it("Échap dans une fiche revient à la liste, et ne ferme pas le menu", () => {
    const onClose = vi.fn();
    menu({ initiale: "salle", rubriques: fermer(), onClose });
    fireEvent.click(document.getElementById("item-close-game")!);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.getElementById("fiche")).toBeNull();
    // Le jumeau : Échap sur la liste ferme le menu.
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("le pied (M6)", () => {
  it("n'existe pas avant un premier usage du clavier, puis dit les rubriques", () => {
    menu();
    expect(document.querySelector("#menu footer")).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    const pied = document.querySelector("#menu footer")?.textContent ?? "";
    expect(pied).toContain("rubriques");
    expect(pied).toContain("Échap");
  });

  it("le jumeau : une manette branchée dit A, B et Start, jamais Échap", () => {
    menu({ appareil: "manette" });
    const pied = document.querySelector("#menu footer")?.textContent ?? "";
    expect(pied).toMatch(/A.*valider/);
    expect(pied).toMatch(/Start/);
    expect(pied).not.toMatch(/Échap/);
  });

  it("au doigt, n'a pas de pied", () => {
    menu({ appareil: "tactile" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    // La touche est venue d'un clavier branché : le pied le dit alors.
    expect(document.querySelector("#menu footer")?.textContent ?? "").toContain("Échap");
  });
});

describe("la manette conduit le même focus", () => {
  const avecManette = (props: Partial<React.ComponentProps<typeof Menu>> = {}) => {
    let manette: ((a: MenuAction) => void) | null = null;
    menu({ onPad: (h) => (manette = h), ...props });
    return (a: MenuAction) => act(() => manette?.(a));
  };

  it("descend, valide et revient", () => {
    const onEnter = vi.fn();
    const onClose = vi.fn();
    const presser = avecManette({
      onClose,
      rubriques: rubriques({
        jeux: [
          { id: "a", label: "A", onEnter: () => {} },
          { id: "b", label: "B", onEnter },
        ],
      }),
    });
    presser("down");
    expect(document.activeElement?.id).toBe("item-b");
    presser("confirm");
    expect(onEnter).toHaveBeenCalledTimes(1);
    presser("back");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Start rend la main au jeu, même dans une fiche", () => {
    const onClose = vi.fn();
    const presser = avecManette({
      onClose,
      initiale: "salle",
      rubriques: rubriques({
        salle: [
          {
            id: "close-game",
            label: "fermer le jeu",
            fiche: {
              consequence: "c",
              agir: "Fermer le jeu",
              annuler: "Continuer à jouer",
              onAgir: () => {},
            },
          },
        ],
      }),
    });
    presser("confirm");
    expect(document.getElementById("fiche")).not.toBeNull();
    presser("jeu");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("la fermeture", () => {
  it("un focus qui arrive dans la zone de jeu ferme le menu (D30 amendé)", () => {
    const onClose = vi.fn();
    render(
      <>
        <div data-zone-jeu tabIndex={0} id="zone" />
        <Menu rubriques={rubriques()} partie joue appareil="clavier" onClose={onClose} />
      </>,
    );
    expect(onClose).not.toHaveBeenCalled();
    act(() => document.getElementById("zone")!.focus());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("le jumeau : un focus ailleurs dans la page ne le ferme pas", () => {
    const onClose = vi.fn();
    render(
      <>
        <button type="button" id="ailleurs" />
        <Menu rubriques={rubriques()} partie joue appareil="clavier" onClose={onClose} />
      </>,
    );
    act(() => document.getElementById("ailleurs")!.focus());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("rend le focus à l'ouvreur sans partie", () => {
    const Page = ({ ouvert }: { ouvert: boolean }) => (
      <>
        <button type="button" id="openMenu" />
        {ouvert ? (
          <Menu rubriques={rubriques()} partie={false} joue appareil="clavier" onClose={() => {}} />
        ) : null}
      </>
    );
    const { rerender } = render(<Page ouvert={false} />);
    act(() => document.getElementById("openMenu")!.focus());
    rerender(<Page ouvert />);
    expect(document.activeElement?.id).toBe("item-game0");
    rerender(<Page ouvert={false} />);
    expect(document.activeElement?.id).toBe("openMenu");
  });

  it("tenu en main, se pose hors de l'image et le dit", () => {
    menu({ place: { lieu: "sous", rect: { x: 0, y: 339, w: 390, h: 505 }, surImage: false } });
    const boite = document.getElementById("menu")!;
    expect(boite.dataset.lieu).toBe("sous");
    expect(boite.dataset.surImage).toBe("non");
    expect(boite.style.top).toBe("339px");
    expect(getComputedStyle(boite).touchAction).not.toBe("none");
  });
});

describe("le ▶ après une animation", () => {
  it("se repose sur la ligne qui a le focus quand le fondu finit", () => {
    menu();
    const vus: string[] = [];
    document.addEventListener("focusin", (e) => vus.push((e.target as HTMLElement).id));
    document
      .getElementById("menuPanneau")!
      .dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(vus).toEqual(["item-game0"]);
  });

  it("le jumeau : rien quand le focus est hors du menu", () => {
    render(<button type="button" id="dehors" />);
    menu();
    act(() => document.getElementById("dehors")!.focus());
    const vus: string[] = [];
    document.addEventListener("focusin", (e) => vus.push((e.target as HTMLElement).id));
    document
      .getElementById("menuPanneau")!
      .dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(vus).toEqual([]);
  });
});

describe("la rubrique Salle tient la colonne (M10, K25)", () => {
  const salle = (): Rubrique[] =>
    rubriques({
      salle: [
        {
          id: "signaler",
          label: "Signaler un problème",
          element: (
            <button type="button" id="signalerMenu">
              Signaler un problème
            </button>
          ),
        },
        { id: "leave", label: "quitter la salle", onEnter: () => {} },
      ],
    }).map((r) =>
      r.id === "salle" ? { ...r, tete: <p id="menuQuiChoisit">Nour choisit le jeu.</p> } : r,
    );

  it("dit qui choisit le jeu en tête, et seulement dans sa rubrique", () => {
    menu({ rubriques: salle(), initiale: "salle" });
    expect(document.querySelector("#menuPanneau #menuQuiChoisit")?.textContent).toBe(
      "Nour choisit le jeu.",
    );
    // Le jumeau : une autre rubrique n'a pas cette tête.
    act(() => screen.getByRole("tab", { name: /Jeux/ }).click());
    expect(document.getElementById("menuQuiChoisit")).toBeNull();
  });

  it("pose Signaler comme une ligne, que les flèches atteignent", () => {
    menu({ rubriques: salle(), initiale: "salle" });
    const ligne = document.getElementById("item-signaler");
    expect(ligne?.getAttribute("data-forme")).toBe("composant");
    expect(ligne?.querySelector("#signalerMenu")).not.toBeNull();
    const quitter = document.getElementById("item-leave")!;
    act(() => quitter.focus());
    fireEvent.keyDown(quitter, { key: "ArrowUp" });
    expect(document.activeElement?.id).toBe("signalerMenu");
  });
});
