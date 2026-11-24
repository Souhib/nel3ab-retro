import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modeleEtat, type Entree } from "../lib/etat-modele";
import { GardeSignalement } from "../lib/garde-signalement";
import { ATTRIBUT, jetons, lever, retirer, vues } from "../media/couverture";
import type { Liaison } from "../media/liaison";
import { EtatPastille, FicheEtat, PleinCadre, useCouverture, type Rappels } from "./EtatSalle";
import { LigneParlee } from "./LigneParlee";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  for (const jeton of jetons()) retirer(jeton);
});

const rappels = (): Rappels => ({
  onRelancer: vi.fn(),
  onReessayer: vi.fn(),
  onQuitter: vi.fn(),
  onSignaler: vi.fn().mockResolvedValue(undefined),
  garde: new GardeSignalement(),
  onReduire: vi.fn(),
  onGarder: vi.fn(),
  onRester: vi.fn(),
  onRevenir: vi.fn(),
  onGarderLegere: vi.fn(),
});

const modele = (liaison: Liaison, changes: Partial<Entree> = {}) =>
  modeleEtat({
    liaison,
    salle: 1,
    contexte: { jeu: "Kart", salon: true },
    fermeDans: 0,
    place: true,
    legerePassee: false,
    legere: false,
    neige: true,
    ...changes,
  });

/** La fiche, la pastille et le plein cadre d'un état, comme la page les pose. */
function montrer(liaison: Liaison, changes: Partial<Entree> = {}) {
  const gestes = rappels();
  const onPropositionVue = vi.fn();
  const onAller = vi.fn();
  const m = modele(liaison, changes);
  const rendu = render(
    <>
      <EtatPastille modele={m} onAller={onAller} />
      <FicheEtat modele={m} rappels={gestes} onPropositionVue={onPropositionVue} />
      <PleinCadre modele={m} rappels={gestes} />
    </>,
  );
  return { ...gestes, onPropositionVue, onAller, ...rendu };
}

const gel = (depuisMs: number, niveau: "pastille" | "bandeau"): Liaison => ({
  etat: "figee",
  depuisMs,
  son: true,
  manette: true,
  niveau,
  apresRelance: false,
});
const arrivee = (perdue: boolean): Liaison => ({
  etat: "arrivee",
  etape: "image",
  depuisMs: perdue ? 16_000 : 900,
  perdue,
  salleRepond: true,
  repondDepuisMs: perdue ? 15_000 : 300,
});

describe("l'image figée, dite hors de l'image", () => {
  it("une fiche avec la phrase, le fait, le geste et Signaler à côté", () => {
    const { onRelancer } = montrer(gel(14_000, "bandeau"));
    const fiche = document.querySelector("#liaison");
    expect(fiche?.getAttribute("data-etat")).toBe("figee");
    expect(screen.getByText("L'image ne bouge plus depuis 14 s.")).toBeVisible();
    expect(screen.getByText("Le son arrive encore.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Relancer l'image" }));
    expect(onRelancer).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#liaison #signalerEtat")).not.toBeNull();
    // Le titre et le fait sont les mots de l'événement : Aïn ne les couvre pas.
    expect(document.querySelectorAll("#liaison [data-texte]")).toHaveLength(2);
  });

  it("la pastille mène au geste quand la fiche existe", () => {
    const { onAller } = montrer(gel(14_000, "bandeau"));
    const pastille = document.querySelector<HTMLElement>("#pastilleEtat");
    expect(pastille?.tagName).toBe("BUTTON");
    expect(pastille?.getAttribute("data-etat")).toBe("figee");
    // Le point porte l'ancre où Aïn se rebranche.
    expect(pastille?.querySelector('[data-ancre="prise"]')).not.toBeNull();
    fireEvent.click(pastille as HTMLElement);
    expect(onAller).toHaveBeenCalledTimes(1);
  });

  it("jumeau : une pastille seule, sans bouton qui gênerait la partie", () => {
    montrer(gel(3000, "pastille"));
    expect(screen.getByText("Image figée")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector("#liaison")).toBeNull();
  });

  it("jumeau : une salle qui va bien n'affiche rien", () => {
    const { container } = montrer({ etat: "ok" });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("le plein cadre", () => {
  it("l'arrivée : le titre, les étapes, le fait, et la scène sur son plateau", () => {
    montrer(arrivee(false));
    const plein = document.querySelector("#arrivee");
    expect(plein?.getAttribute("data-etat")).toBe("arrivee");
    expect(screen.getByText("Connexion à la salle 1.")).toBeInTheDocument();
    expect(
      screen.getByText("Une partie de Kart est en cours: tu arrives au milieu."),
    ).toBeInTheDocument();
    expect(plein?.querySelectorAll("li")).toHaveLength(2);
    expect(plein?.querySelector('[data-hote="plateau"]')).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    // Le plein cadre n'a pas de pastille à côté de lui.
    expect(document.querySelector("#pastilleEtat")).toBeNull();
  });

  it("à quinze secondes, réessayer ou les autres salles, et les deux marchent", () => {
    const { onReessayer } = montrer(arrivee(true));
    expect(
      screen.getByText("La salle répond depuis 15 s, sans envoyer d'image."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(onReessayer).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#arrivee #lesSalles")?.getAttribute("href")).toBe("/");
  });

  it("jumeau : servie seule, la sortie quitte la salle", () => {
    const { onQuitter } = montrer(arrivee(true), { contexte: { jeu: null, salon: false } });
    fireEvent.click(screen.getByRole("button", { name: "Quitter la salle" }));
    expect(onQuitter).toHaveBeenCalledTimes(1);
  });

  it("la salle fermée : l'extinction, la phrase et la liste des salles", () => {
    montrer({ etat: "fermee" });
    expect(document.querySelector("#arrivee")?.getAttribute("data-etat")).toBe("fermee");
    expect(document.querySelector("#arrivee .n3-extinction")).not.toBeNull();
    expect(document.querySelector("#arrivee #lesSalles")).not.toBeNull();
  });

  it("jumeau : une image figée n'a pas de plein cadre", () => {
    montrer(gel(14_000, "bandeau"));
    expect(document.querySelector("#arrivee")).toBeNull();
  });
});

describe("les pannes, chacune avec son geste", () => {
  it("la salle injoignable propose de réessayer, Signaler à côté", () => {
    const { onReessayer } = montrer({
      etat: "injoignable",
      site: "repond",
      arrivee: false,
      depuisMs: 3000,
    });
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(onReessayer).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#signalerEtat")).not.toBeNull();
  });
  it("la salle qui redémarre n'a ni geste ni sortie dans sa fiche", () => {
    montrer({ etat: "redemarre", arrivee: false });
    expect(document.querySelector("#liaison button, #liaison a")).toBeNull();
  });
});

describe("la fermeture proche", () => {
  it("« Je reste » part de la fiche, pour qui tient une place", () => {
    const { onRester } = montrer({ etat: "ok" }, { fermeDans: 4 });
    expect(document.querySelector("#pastilleEtat")?.textContent).toContain("Ferme dans 4 min");
    fireEvent.click(screen.getByRole("button", { name: "Je reste" }));
    expect(onRester).toHaveBeenCalledTimes(1);
  });
  it("jumeau : un spectateur a la pastille, sans fiche ni bouton", () => {
    montrer({ etat: "ok" }, { fermeDans: 4, place: false });
    expect(document.querySelector("#pastilleEtat")?.tagName).toBe("DIV");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("l'image légère", () => {
  it("passée d'elle-même, elle se dit et se laisse défaire", () => {
    const { onRevenir, onGarderLegere } = montrer({ etat: "ok" }, { legerePassee: true });
    fireEvent.click(screen.getByRole("button", { name: "Revenir en image complète" }));
    expect(onRevenir).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Garder" }));
    expect(onGarderLegere).toHaveBeenCalledTimes(1);
  });
});

describe("la proposition de l'image légère (E3)", () => {
  it("se note « proposée » au montage de sa fiche, une seule fois", () => {
    const gestes = rappels();
    const onPropositionVue = vi.fn();
    const arbre = (depuis: number) => (
      <FicheEtat
        key="fiche"
        modele={{ ...modele({ etat: "irreguliere" }), titre: `saute ${depuis}` }}
        rappels={gestes}
        onPropositionVue={onPropositionVue}
      />
    );
    const { rerender } = render(arbre(1));
    expect(document.querySelector("#rough")?.getAttribute("data-etat")).toBe("irreguliere");
    expect(onPropositionVue).toHaveBeenCalledTimes(1);
    // Un nouveau relevé rend la même fiche : pas un nouveau montage.
    rerender(arbre(2));
    expect(onPropositionVue).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Passer en image légère" }));
    expect(gestes.onReduire).toHaveBeenCalledTimes(1);
  });
  it("jumeau : une proposition cachée par un gel n'est pas notée", () => {
    const { onPropositionVue } = montrer(gel(14_000, "bandeau"));
    expect(onPropositionVue).not.toHaveBeenCalled();
  });
});

/** Un composant qui arme la couverture comme la page le fait. */
function Couvre({ jeton, vu }: { jeton: "plein" | "passee" | null; vu: number }) {
  useCouverture(jeton, vu);
  return null;
}

describe("la couverture suit l'état, une fois par entrée", () => {
  const attribut = () => document.documentElement.getAttribute(ATTRIBUT);
  it("s'arme à l'entrée et se retire quand l'état part sans image", () => {
    const { rerender } = render(<Couvre jeton="plein" vu={vues()} />);
    expect(attribut()).toBe("plein");
    rerender(<Couvre jeton={null} vu={vues()} />);
    expect(attribut()).toBeNull();
  });
  it("une image peinte la lève, et le relevé suivant ne la repose pas", () => {
    const { rerender } = render(<Couvre jeton="passee" vu={vues()} />);
    lever();
    expect(attribut()).toBeNull();
    rerender(<Couvre jeton="passee" vu={vues()} />);
    expect(attribut()).toBeNull();
  });
  it("jumeau : refusée quand l'image a bougé depuis la décision", () => {
    const decide = vues();
    lever();
    render(<Couvre jeton="plein" vu={decide} />);
    expect(attribut()).toBeNull();
  });
});

describe("la ligne parlée", () => {
  it("existe dès le départ, vide, polie et atomique", () => {
    render(
      <LigneParlee liaison={{ etat: "ok" }} salle={1} demande={null} delai={10} peintes={1} />,
    );
    const ligne = screen.getByRole("status");
    expect(ligne).toHaveAttribute("aria-atomic", "true");
    expect(ligne).toHaveTextContent("");
  });

  it("dit le changement d'état, et ne se réécrit pas quand seule la durée avance", () => {
    const { rerender } = render(
      <LigneParlee liaison={{ etat: "ok" }} salle={1} demande={null} delai={10} peintes={1} />,
    );
    rerender(
      <LigneParlee
        liaison={gel(3000, "pastille")}
        salle={1}
        demande={null}
        delai={10}
        peintes={1}
      />,
    );
    const ligne = screen.getByRole("status");
    expect(ligne).toHaveTextContent("L'image ne bouge plus. Le son arrive encore.");
    const noeud = ligne.firstChild;
    rerender(
      <LigneParlee
        liaison={gel(4500, "pastille")}
        salle={1}
        demande={null}
        delai={10}
        peintes={1}
      />,
    );
    expect(ligne.firstChild).toBe(noeud);
    expect(ligne).toHaveTextContent("L'image ne bouge plus. Le son arrive encore.");
    // La fiche paraît : son geste se dit une fois.
    rerender(
      <LigneParlee
        liaison={gel(5000, "bandeau")}
        salle={1}
        demande={null}
        delai={10}
        peintes={1}
      />,
    );
    expect(ligne).toHaveTextContent("Tu peux relancer l'image.");
    rerender(
      <LigneParlee liaison={{ etat: "ok" }} salle={1} demande={null} delai={10} peintes={1} />,
    );
    expect(ligne).toHaveTextContent("L'image est revenue.");
  });

  it("dit une seule fois qu'un démarrage traîne, puis qu'il est perdu (A11Y-07)", () => {
    const ligne = (liaison: Liaison) => (
      <LigneParlee liaison={liaison} salle={1} demande={null} delai={10} peintes={1} />
    );
    const { rerender } = render(ligne({ etat: "demarrage", depuisMs: 1000 }));
    expect(screen.getByRole("status")).toHaveTextContent("Le jeu démarre.");
    rerender(ligne({ etat: "demarrage", depuisMs: 21_000, attente: "long" }));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Le jeu démarre encore, depuis 20 s.");
    const noeud = status.firstChild;
    rerender(ligne({ etat: "demarrage", depuisMs: 30_000, attente: "long" }));
    expect(status.firstChild).toBe(noeud);
    rerender(ligne({ etat: "demarrage", depuisMs: 61_000, attente: "echec" }));
    expect(status).toHaveTextContent("Aucune image du jeu.");
  });

  it("annonce une demande de manette une fois, sans décompte", () => {
    const { rerender } = render(
      <LigneParlee liaison={{ etat: "ok" }} salle={1} demande={null} delai={10} peintes={1} />,
    );
    rerender(
      <LigneParlee
        liaison={{ etat: "ok" }}
        salle={1}
        demande={{ from: "Lina", port: 2 }}
        delai={10}
        peintes={1}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Lina demande ta place 2. Tu as 10 secondes pour répondre. Sans réponse, tu la gardes.",
    );
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole("status").textContent).not.toMatch(/\b7\b/);
  });
});

describe("la ligne parlée de la fermeture", () => {
  it("dit le compte à l'entrée, puis la dernière minute, jamais chaque minute", () => {
    const ligne = (fermeDans: number) => (
      <LigneParlee
        liaison={{ etat: "ok" }}
        salle={1}
        demande={null}
        delai={10}
        peintes={1}
        fermeDans={fermeDans}
      />
    );
    const { rerender } = render(ligne(0));
    const status = screen.getByRole("status");
    rerender(ligne(5));
    expect(status).toHaveTextContent(
      "La salle ferme dans 5 minutes. Une touche du jeu suffit pour rester.",
    );
    const noeud = status.firstChild;
    rerender(ligne(4));
    expect(status.firstChild).toBe(noeud);
    rerender(ligne(1));
    expect(status).toHaveTextContent("La salle ferme dans une minute.");
    rerender(ligne(0));
    expect(status).toHaveTextContent("La salle reste ouverte.");
  });
});
