/**
 * Le champ du nom (K03) : un libellé visible, une aide, et un refus qui dit sa
 * raison au lieu d'un bouton grisé muet (audits A11Y-10 et A11Y-17).
 *
 * L'écran qui le monte (`Entrance`) est au chantier salon ; ce banc rend le
 * champ dans un formulaire minimal, avec le vrai crochet `useNom`.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NOM } from "../lib/mots";
import { useNom } from "../lib/useNom";
import { ChampNom } from "./ChampNom";

function Banc({ onName, apercu }: { onName: (nom: string) => void; apercu?: boolean }) {
  const nom = useNom();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        nom.soumettre(onName);
      }}
    >
      <ChampNom nom={nom} apercu={apercu} />
      <button type="submit">Entrer</button>
    </form>
  );
}
const champ = () => screen.getByLabelText(NOM.libelle) as HTMLInputElement;
const taper = (texte: string) => act(() => fireEvent.change(champ(), { target: { value: texte } }));
const entrer = () => act(() => fireEvent.click(screen.getByRole("button", { name: "Entrer" })));

describe("le champ", () => {
  it("porte un libellé visible, son aide et ce que le navigateur sait compléter", () => {
    render(<Banc onName={vi.fn()} />);
    const label = screen.getByText(NOM.libelle);
    expect(label.tagName).toBe("LABEL");
    expect(label).not.toHaveClass("sr-only");
    expect(champ()).toHaveAttribute("id", "name");
    expect(champ()).toHaveAttribute("autocomplete", "nickname");
    expect(champ()).toHaveAccessibleDescription(NOM.aide);
    expect(champ()).not.toHaveAttribute("placeholder");
  });

  it("refuse un nom vide avec sa raison, et rend le focus au champ", () => {
    const onName = vi.fn();
    render(<Banc onName={onName} />);
    expect(screen.getByRole("button", { name: "Entrer" })).toBeEnabled();
    entrer();
    expect(onName).not.toHaveBeenCalled();
    expect(champ()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(NOM.vide)).toBeVisible();
    expect(champ()).toHaveAccessibleDescription(`${NOM.vide} ${NOM.aide}`);
    expect(document.activeElement).toBe(champ());
  });

  it("jumeau : des espaces seuls sont refusés aussi", () => {
    const onName = vi.fn();
    render(<Banc onName={onName} />);
    taper("   ");
    entrer();
    expect(onName).not.toHaveBeenCalled();
    expect(champ()).toHaveAttribute("aria-invalid", "true");
  });

  it("jumeau : « Lina » entre, sans refus", () => {
    const onName = vi.fn();
    render(<Banc onName={onName} />);
    taper(" Lina ");
    entrer();
    expect(onName).toHaveBeenCalledWith("Lina");
    expect(champ()).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText(NOM.vide)).toBeNull();
  });

  it("la raison s'efface dès qu'on tape", () => {
    render(<Banc onName={vi.fn()} />);
    entrer();
    taper("L");
    expect(screen.queryByText(NOM.vide)).toBeNull();
    expect(champ()).toHaveAttribute("aria-invalid", "false");
  });
});

describe("l'aperçu de l'étiquette", () => {
  it("montre l'étiquette tapée du nom, rien tant que le champ est vide", () => {
    render(<Banc onName={vi.fn()} />);
    expect(screen.queryByText(NOM.apercu)).toBeNull();
    taper("Lina");
    expect(screen.getByText(NOM.apercu)).toBeVisible();
    expect(document.querySelector(".n3-apercu .n3-etiquette-nom")).toHaveTextContent("Lina");
    // jsdom n'a pas de mise en page : rien n'y est jamais coupé. La mesure se
    // prouve dans le navigateur (parcours.mjs, nom-apercu).
    expect(screen.queryByText(NOM.coupe)).toBeNull();
  });

  it("jumeau : sans aperçu demandé, aucune étiquette", () => {
    render(<Banc onName={vi.fn()} apercu={false} />);
    taper("Lina");
    expect(document.querySelector(".n3-etiquette")).toBeNull();
  });

  it("n'offre ni toile ni écriture à la main", () => {
    render(<Banc onName={vi.fn()} />);
    expect(document.querySelector("canvas")).toBeNull();
    expect(screen.queryByText(/Écris ton nom/)).toBeNull();
  });
});
