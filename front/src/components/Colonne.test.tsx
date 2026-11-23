import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { rangsDeLaColonne, type Rang } from "../lib/colonne";
import { Coin } from "./Coin";
import { BlocRole, Colonne, IlsRegardent } from "./Colonne";
import { PanneauCommande } from "./PanneauCommande";

const contenus: Partial<Record<Rang, React.ReactNode>> = {
  signaler: <button type="button">Signaler</button>,
  son: <button type="button">Son</button>,
  menu: <button type="button">Menu du jeu</button>,
  touches: <button type="button">Tes touches</button>,
  manette: <button type="button">Ta manette</button>,
  garder: <button type="button">Garder</button>,
  agrandir: <button type="button">Agrandir</button>,
  autres: <button type="button">Autres</button>,
};

const colonne = (rangs: readonly Rang[], mesures: React.ReactNode = null) =>
  render(
    <Colonne
      nomSalle="Salle 1"
      jeu="Zelda"
      onQuitter={() => {}}
      largeur={304}
      role={<BlocRole nom="Lina" place={1} libre={2} />}
      rangs={rangs}
      contenus={contenus}
      vue={mesures}
      coin={<Coin mesures={false} onMesures={() => {}} />}
    />,
  );

const ordre = (conteneur: HTMLElement) =>
  [...conteneur.querySelectorAll("[data-rang]")].map((el) => el.getAttribute("data-rang"));

describe("la colonne", () => {
  it("rend les rangs dans l'ordre de rangsDeLaColonne", () => {
    const rangs = rangsDeLaColonne({
      etat: "vit",
      role: "joueur",
      appareil: "clavier",
      fiche: false,
    });
    const { container } = colonne(rangs);
    expect(ordre(container)).toEqual([
      "signaler",
      "son",
      "menu",
      "touches",
      "garder",
      "agrandir",
      "autres",
    ]);
  });

  it("ne rend pas un rang absent de la liste, même avec son contenu", () => {
    const rangs = rangsDeLaColonne({
      etat: "vit",
      role: "regarde",
      appareil: "clavier",
      fiche: false,
    });
    const { container } = colonne(rangs);
    expect(ordre(container)).not.toContain("menu");
    expect(ordre(container)).not.toContain("touches");
    expect(screen.queryByText("Menu du jeu")).toBeNull();
  });

  it("Quitter est dans l'en-tête, à côté du nom de la salle", () => {
    colonne(["autres"]);
    const quitter = document.getElementById("leaveRoom");
    expect(quitter?.closest("header")?.textContent).toContain("Salle 1");
  });

  it("les mesures prennent la place des rangs, et les rangs reviennent sans elles", () => {
    const { container, rerender } = colonne(["son", "autres"], <div id="stats">mesures</div>);
    expect(container.querySelector("#stats")).not.toBeNull();
    expect(ordre(container)).toEqual([]);
    rerender(
      <Colonne
        nomSalle="Salle 1"
        jeu={null}
        onQuitter={() => {}}
        largeur={304}
        role={<BlocRole nom="Lina" place={1} libre={2} />}
        rangs={["son", "autres"]}
        contenus={contenus}
        vue={null}
        coin={<Coin mesures={false} onMesures={() => {}} />}
      />,
    );
    expect(container.querySelector("#stats")).toBeNull();
    expect(ordre(container)).toEqual(["son", "autres"]);
  });

  it("ses titres de section ne sont plus en capitales espacées", () => {
    const { container } = render(<IlsRegardent people={[]} />);
    const titre = container.querySelector("h2");
    expect(titre?.className).toContain("n3-colonne-titre");
    expect(titre?.className).not.toContain("n3-etiquette");
    expect(titre?.textContent).toBe("Ils regardent · 0");
  });

  it("aucune flèche en caractère dans ses textes visibles", () => {
    const { container } = colonne(
      rangsDeLaColonne({ etat: "vit", role: "joueur", appareil: "clavier", fiche: false }),
    );
    expect(container.textContent).not.toMatch(/[→↓]/);
  });
});

describe("le bloc de rôle", () => {
  it("dit la place tenue, sans bouton pour en prendre une", () => {
    render(<BlocRole nom="Lina" place={2} libre={1} onPrendre={() => {}} />);
    expect(document.getElementById("seat")?.textContent).toBe("Lina · place 2");
    expect(document.getElementById("takePad")).toBeNull();
  });

  it("offre une place à qui regarde, et le dit", () => {
    const prendre = vi.fn();
    render(<BlocRole nom="Lina" place={null} libre={4} onPrendre={prendre} />);
    expect(document.getElementById("seat")?.textContent).toBe("Lina · tu regardes");
    fireEvent.click(screen.getByRole("button", { name: "Prendre la place 4" }));
    expect(prendre).toHaveBeenCalledOnce();
  });

  it("rien à prendre dans une salle fermée", () => {
    render(<BlocRole nom="Lina" place={null} libre={1} />);
    expect(document.getElementById("takePad")).toBeNull();
  });

  it("rien à prendre dans une salle pleine", () => {
    render(<BlocRole nom="Lina" place={null} libre={null} onPrendre={() => {}} />);
    expect(document.getElementById("takePad")).toBeNull();
  });
});

describe("le coin", () => {
  it("sa ligne ouvre et referme les mesures", () => {
    const ouvrir = vi.fn();
    const { rerender } = render(<Coin mesures={false} onMesures={ouvrir} />);
    const ligne = document.getElementById("mesures");
    expect(ligne?.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(ligne!);
    expect(ouvrir).toHaveBeenCalledOnce();
    rerender(<Coin mesures onMesures={ouvrir} />);
    expect(document.getElementById("mesures")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("porte l'hôte de la mascotte sous la ligne, pas dedans", () => {
    const { container } = render(<Coin mesures={false} onMesures={() => {}} />);
    const hote = container.querySelector('[data-hote="coin"]');
    expect(hote).not.toBeNull();
    expect(document.getElementById("mesures")?.contains(hote)).toBe(false);
  });
});

describe("le panneau de commande", () => {
  it("sous l'image, il porte sa hauteur et l'hôte du bord", () => {
    const { container } = render(
      <PanneauCommande forme="sous" hauteur={72}>
        <p>places</p>
      </PanneauCommande>,
    );
    const panneau = container.querySelector("#panneau") as HTMLElement;
    expect(panneau.dataset.forme).toBe("sous");
    expect(panneau.style.getPropertyValue("--panneau-h")).toBe("72px");
    expect(container.querySelector('[data-hote="bord-panneau"]')).not.toBeNull();
  });

  it("au pied de la colonne, ni hauteur imposée ni hôte du bord", () => {
    const { container } = render(
      <PanneauCommande forme="colonne">
        <p>places</p>
      </PanneauCommande>,
    );
    const panneau = container.querySelector("#panneau") as HTMLElement;
    expect(panneau.style.getPropertyValue("--panneau-h")).toBe("");
    expect(container.querySelector('[data-hote="bord-panneau"]')).toBeNull();
  });
});
