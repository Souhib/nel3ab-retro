import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EntreePlaces } from "../lib/places";
import { Places } from "./Places";

const entree = (e: Partial<EntreePlaces> = {}): EntreePlaces => ({
  places: 4,
  tenues: [false, true, true, false],
  noms: new Map([
    [2, "Bilel"],
    [3, "Moi"],
  ]),
  micros: [false, true, false, false],
  chef: 2,
  mienne: 3,
  ...e,
});

const port = (n: number) => document.querySelector<HTMLButtonElement>(`#port${n}`)!;

describe("les places START", () => {
  it("rend #port1 à #port4 avec leur état et leur pastille écrite", () => {
    render(<Places forme="rangee" entree={entree()} onPrendre={() => {}} onCarte={() => {}} />);
    expect([1, 2, 3, 4].map((n) => port(n).dataset.state)).toEqual([
      "free",
      "busy",
      "mine",
      "free",
    ]);
    for (const n of [1, 2, 3, 4]) expect(port(n).textContent).toContain(`${n}P`);
    expect(port(3).textContent).toContain("toi");
    expect(port(2).getAttribute("aria-label")).toBe(
      "Place 2 : Bilel, choisit le jeu : lui demander sa place",
    );
  });

  /* Le contrat d'Aïn (emplacements-salle.json, mascotte) : `arrivee`,
     `depart` et `fier` demandent `start-1` à `start-4`, le haut du rond
     START de chaque place ; une ancre absente replie la scène en version
     courte. Une seule ancre par place VISIBLE : en petit, quand
     `#placesToutes` remplace la rangée, aucune place cachée ne la porte.
     Posée sur le bouton entier, elle faisait atterrir Aïn au milieu de la
     place, sur son nom, et l'étiquette de « depart » couvrait « 2P libre »
     (intégration B1, 24 novembre 2026). */
  it("pose l'ancre d'Aïn start-N sur le rond START de chaque place, une seule fois", () => {
    render(<Places forme="rangee" entree={entree()} onPrendre={() => {}} onCarte={() => {}} />);
    for (const n of [1, 2, 3, 4]) {
      const ancres = document.querySelectorAll(`[data-ancre="start-${n}"]`);
      expect(ancres).toHaveLength(1);
      expect(ancres[0]).toBe(port(n).querySelector(".rt-bouton-start"));
    }
  });

  it("en petit, la rangée cachée ne porte aucune ancre ; visible, elle les porte", () => {
    const lignes = vi.spyOn(Element.prototype, "getClientRects");
    // La rangée cachée par la requête de conteneur : aucune boîte.
    lignes.mockImplementation(() => [] as unknown as DOMRectList);
    const { unmount } = render(
      <Places
        forme="petite"
        entree={entree()}
        onPrendre={() => {}}
        onCarte={() => {}}
        onToutes={() => {}}
      />,
    );
    expect(document.querySelectorAll("[data-ancre]")).toHaveLength(0);
    // Ni les lampes du bouton qui les montre toutes.
    expect(document.querySelector("#placesToutes [data-ancre]")).toBeNull();
    unmount();
    // Le jumeau : en petit, la rangée qui se voit garde ses quatre ancres.
    lignes.mockImplementation(() => [new DOMRect(0, 0, 200, 44)] as unknown as DOMRectList);
    render(
      <Places
        forme="petite"
        entree={entree()}
        onPrendre={() => {}}
        onCarte={() => {}}
        onToutes={() => {}}
      />,
    );
    for (const n of [1, 2, 3, 4])
      expect(document.querySelector(`[data-ancre="start-${n}"]`)).toBe(
        port(n).querySelector(".rt-bouton-start"),
      );
    lignes.mockRestore();
  });

  it("la rangée qui se cache après coup perd ses ancres, et les retrouve en revenant", () => {
    let boites: DOMRect[] = [new DOMRect(0, 0, 200, 44)];
    const lignes = vi
      .spyOn(Element.prototype, "getClientRects")
      .mockImplementation(() => boites as unknown as DOMRectList);
    // Un faux aussi strict que le vrai : il ne rappelle que pour les
    // éléments qu'on lui a fait observer. Le faux d'avant rappelait chaque
    // observateur créé, et `useRangeeVisible` pouvait oublier
    // `suivi.observe(el)` sans qu'aucun essai ne rougisse (relecture finale
    // du 25 novembre 2026).
    const suivis: { rappel: () => void; elements: Element[] }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        suivi: { rappel: () => void; elements: Element[] };
        constructor(rappel: () => void) {
          this.suivi = { rappel, elements: [] };
          suivis.push(this.suivi);
        }
        observe(el: Element) {
          this.suivi.elements.push(el);
        }
        disconnect() {
          this.suivi.elements = [];
        }
      },
    );
    /** La rangée change de taille : seuls ceux qui l'observent l'apprennent. */
    const changer = () => {
      const rangee = document.getElementById("ports");
      for (const { rappel, elements } of suivis) if (rangee && elements.includes(rangee)) rappel();
    };
    render(
      <Places
        forme="petite"
        entree={entree()}
        onPrendre={() => {}}
        onCarte={() => {}}
        onToutes={() => {}}
      />,
    );
    expect(document.querySelectorAll("[data-ancre]")).toHaveLength(4);
    // La rangée #ports est bien observée : sans cela, rien ne la suivrait.
    expect(
      suivis.some(({ elements }) => elements.includes(document.getElementById("ports")!)),
    ).toBe(true);
    boites = [];
    act(changer);
    expect(document.querySelectorAll("[data-ancre]")).toHaveLength(0);
    boites = [new DOMRect(0, 0, 200, 44)];
    act(changer);
    expect(document.querySelectorAll("[data-ancre]")).toHaveLength(4);
    vi.unstubAllGlobals();
    lignes.mockRestore();
  });

  /* Les mots de l'événement (`data-texte`) sont des murs pour Aïn : le
     numéro de la place, le nom de qui la tient ou « libre », « toi », et
     « 3P prêt ! ». La phrase du rôle n'est pas un mot d'événement. */
  it("marque data-texte les mots de chaque place, et eux seuls", () => {
    render(
      <Places
        forme="rangee"
        entree={entree()}
        vient={new Set([2])}
        onPrendre={() => {}}
        onCarte={() => {}}
      />,
    );
    // L'étiquette tapée se lit par son nom affiché (`rt-nom-plein`).
    const mots = (n: number) =>
      [...port(n).querySelectorAll("[data-texte]")].map(
        (e) => e.querySelector(".rt-nom-plein")?.textContent ?? e.textContent,
      );
    expect(mots(1)).toEqual(["1P", "libre"]);
    expect(mots(2)).toEqual(["2P", "Bilel", "2P prêt !"]);
    expect(mots(3)).toEqual(["3P", "Moi", "toi"]);
    // Le jumeau : ni la phrase du rôle, ni le bouton entier, ni son rond.
    expect(document.querySelector(".n3-places-role")?.hasAttribute("data-texte")).toBe(false);
    expect(port(2).hasAttribute("data-texte")).toBe(false);
    expect(port(2).querySelector(".rt-bouton-start")?.hasAttribute("data-texte")).toBe(false);
  });

  it("jumeau : une console à deux places n'a pas d'ancre start-3", () => {
    render(
      <Places
        forme="rangee"
        entree={entree({ places: 2, tenues: [false, true], mienne: null, chef: null })}
        onPrendre={() => {}}
        onCarte={() => {}}
      />,
    );
    expect(document.querySelector('[data-ancre="start-2"]')).toBe(
      port(2).querySelector(".rt-bouton-start"),
    );
    expect(document.querySelector('[data-ancre="start-3"]')).toBeNull();
  });

  it("pose la couronne DANS la place de qui choisit le jeu, et nulle part ailleurs", () => {
    render(<Places forme="rangee" entree={entree()} onPrendre={() => {}} onCarte={() => {}} />);
    expect(port(2).querySelector(".n3-couronne")).not.toBeNull();
    expect(document.querySelectorAll(".n3-couronne")).toHaveLength(1);
  });

  it("éteint une place libre et allume une place tenue à la couleur de son joueur", () => {
    render(<Places forme="rangee" entree={entree()} onPrendre={() => {}} onCarte={() => {}} />);
    const start = (n: number) => port(n).querySelector<HTMLElement>(".rt-bouton-start")!;
    expect(start(1).hasAttribute("data-libre")).toBe(true);
    expect(start(2).hasAttribute("data-libre")).toBe(false);
    expect(port(2).style.getPropertyValue("--rt-joueur")).toBe("var(--p2)");
    // Le jumeau : une place libre n'a pas de couleur de joueur.
    expect(port(1).style.getPropertyValue("--rt-joueur")).toBe("");
  });

  it("prend une place libre d'un toucher, et ouvre la carte d'une place tenue ou de la sienne", () => {
    const onPrendre = vi.fn();
    const onCarte = vi.fn();
    render(<Places forme="rangee" entree={entree()} onPrendre={onPrendre} onCarte={onCarte} />);
    fireEvent.click(port(1));
    fireEvent.click(port(2));
    fireEvent.click(port(3));
    expect(onPrendre.mock.calls).toEqual([[1]]);
    expect(onCarte.mock.calls).toEqual([[2], [3]]);
  });

  it("dit quelle carte est ouverte", () => {
    render(
      <Places forme="rangee" entree={entree()} carte={2} onPrendre={() => {}} onCarte={() => {}} />,
    );
    expect(port(2).getAttribute("aria-expanded")).toBe("true");
    expect(port(2).getAttribute("aria-controls")).toBe("cartePlace");
    expect(port(3).getAttribute("aria-expanded")).toBe("false");
    // Une place libre ne déplie rien : elle se prend.
    expect(port(1).hasAttribute("aria-expanded")).toBe(false);
  });

  it("garde le focus sur la même place quand l'occupation change deux fois", () => {
    const { rerender } = render(
      <Places forme="rangee" entree={entree()} onPrendre={() => {}} onCarte={() => {}} />,
    );
    port(2).focus();
    const avant = port(2);
    rerender(
      <Places
        forme="rangee"
        entree={entree({ tenues: [true, true, true, false] })}
        onPrendre={() => {}}
        onCarte={() => {}}
      />,
    );
    rerender(
      <Places
        forme="rangee"
        entree={entree({ tenues: [true, true, true, true] })}
        onPrendre={() => {}}
        onCarte={() => {}}
      />,
    );
    expect(document.activeElement).toBe(avant);
    expect(port(2)).toBe(avant);
  });

  it("fait sauter « 3P prêt ! » sur la place qui arrive, et sur elle seule", () => {
    render(
      <Places
        forme="rangee"
        entree={entree()}
        vient={new Set([2])}
        onPrendre={() => {}}
        onCarte={() => {}}
      />,
    );
    expect(port(2).hasAttribute("data-joue")).toBe(true);
    const pret = port(2).querySelector(".rt-pret");
    expect(pret?.textContent).toBe("2P prêt !");
    expect(pret?.getAttribute("aria-hidden")).toBe("true");
    // Le jumeau : aucune autre place ne joue.
    expect(document.querySelectorAll("[data-joue]")).toHaveLength(1);
    expect(document.querySelectorAll(".rt-pret")).toHaveLength(1);
  });

  it("en petit, un bouton montre les quatre places, dit chacune, et ouvre la salle", () => {
    const onToutes = vi.fn();
    render(
      <Places
        forme="petite"
        entree={entree()}
        vient={new Set([2])}
        onPrendre={() => {}}
        onCarte={() => {}}
        onToutes={onToutes}
      />,
    );
    const toutes = document.querySelector<HTMLButtonElement>("#placesToutes")!;
    expect(toutes.getAttribute("aria-label")).toBe(
      "Les places : 1P libre, 2P Bilel, 3P toi, 4P libre. Les voir dans la salle",
    );
    const lampes = [...toutes.querySelectorAll(".n3-places-lampe")];
    expect(lampes.map((l) => l.textContent)).toEqual(["1", "2", "3", "4"]);
    expect(lampes.map((l) => l.hasAttribute("data-libre"))).toEqual([true, false, false, true]);
    // L'arrivée se voit aussi sur lui, la rangée étant cachée.
    expect(toutes.hasAttribute("data-joue")).toBe(true);
    expect(toutes.querySelector(".rt-pret")?.textContent).toBe("2P prêt !");
    fireEvent.click(toutes);
    expect(onToutes).toHaveBeenCalledTimes(1);
    // Les places restent dans le document, pour la feuille et les pilotes.
    expect(port(2)).not.toBeNull();
  });

  it("n'a pas ce bouton hors du petit, ni sans geste pour ouvrir la salle", () => {
    const { unmount } = render(
      <Places
        forme="rangee"
        entree={entree()}
        onPrendre={() => {}}
        onCarte={() => {}}
        onToutes={() => {}}
      />,
    );
    expect(document.querySelector("#placesToutes")).toBeNull();
    unmount();
    render(<Places forme="petite" entree={entree()} onPrendre={() => {}} onCarte={() => {}} />);
    expect(document.querySelector("#placesToutes")).toBeNull();
    expect(port(1)).not.toBeNull();
  });

  it("garde allumée une place qui part le temps de s'éteindre", () => {
    const props = { forme: "rangee" as const, onPrendre: () => {}, onCarte: () => {} };
    const libre = entree({ tenues: [false, false, true, false] });
    const { rerender } = render(<Places {...props} entree={libre} part={new Set([2])} />);
    const start = () => port(2).querySelector<HTMLElement>(".rt-bouton-start")!;
    expect(port(2).hasAttribute("data-part")).toBe(true);
    expect(start().hasAttribute("data-libre")).toBe(false);
    expect(start().textContent).toBe("2P");
    rerender(<Places {...props} entree={libre} />);
    expect(start().hasAttribute("data-libre")).toBe(true);
    expect(start().textContent).toBe("2P");
  });

  it("dit le rôle sous la rangée", () => {
    const { rerender } = render(
      <Places forme="rangee" entree={entree()} onPrendre={() => {}} onCarte={() => {}} />,
    );
    expect(document.querySelector(".n3-places-role")?.textContent).toBe("Tu joues à la place 3.");
    rerender(
      <Places
        forme="deux-rangees"
        entree={entree({ mienne: null, tenues: [true, true, true, true] })}
        onPrendre={() => {}}
        onCarte={() => {}}
      />,
    );
    expect(document.querySelector(".n3-places-role")?.textContent).toBe(
      "Tu regardes : touche la place d'un joueur pour la lui demander.",
    );
    expect(document.querySelector(".n3-places")?.getAttribute("data-forme")).toBe("deux-rangees");
  });

  it("garde le même nom accessible et la même pastille sans l'effet « places »", () => {
    // L'effet est une classe sur <html> : le DOM ne change pas avec lui.
    document.documentElement.classList.add("fx-places");
    const { unmount } = render(
      <Places forme="rangee" entree={entree()} onPrendre={() => {}} onCarte={() => {}} />,
    );
    const avec = [1, 2, 3, 4].map((n) => [port(n).getAttribute("aria-label"), port(n).textContent]);
    unmount();
    document.documentElement.classList.remove("fx-places");
    render(<Places forme="rangee" entree={entree()} onPrendre={() => {}} onCarte={() => {}} />);
    const sans = [1, 2, 3, 4].map((n) => [port(n).getAttribute("aria-label"), port(n).textContent]);
    expect(sans).toEqual(avec);
  });
});
