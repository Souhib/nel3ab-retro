/** La ligne parlée dit aussi les nouvelles des places et de l'invitation,
 * une fois chacune, sans seconde région. */
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { LigneParlee } from "./LigneParlee";

const ligne = (nouvelle: { texte: string; cle: number } | null) => (
  <LigneParlee
    liaison={{ etat: "ok" }}
    salle={1}
    demande={null}
    delai={10}
    peintes={0}
    nouvelle={nouvelle}
  />
);

it("dit une nouvelle, puis la suivante, et la même phrase deux fois si sa clé change", () => {
  const rendu = render(ligne({ texte: "Lien copié.", cle: 1 }));
  expect(screen.getByRole("status")).toHaveTextContent("Lien copié.");
  rendu.rerender(ligne({ texte: "Lina prend la place 3.", cle: 2 }));
  expect(screen.getByRole("status")).toHaveTextContent("Lina prend la place 3.");
  rendu.rerender(ligne({ texte: "Lien copié.", cle: 3 }));
  expect(screen.getByRole("status")).toHaveTextContent("Lien copié.");
});

it("jumeau : sans nouvelle, la ligne reste vide", () => {
  render(ligne(null));
  expect(screen.getByRole("status")).toHaveTextContent("");
});

it("jumeau : la même clé ne redit rien après une autre phrase", () => {
  const rendu = render(ligne({ texte: "Lien copié.", cle: 1 }));
  rendu.rerender(
    <LigneParlee
      liaison={{ etat: "ok" }}
      salle={1}
      demande={{ from: "Bo", port: 2, chemin: "reprise" }}
      delai={20}
      peintes={0}
      nouvelle={{ texte: "Lien copié.", cle: 1 }}
    />,
  );
  expect(screen.getByRole("status")).not.toHaveTextContent("Lien copié.");
});
