/** La ligne parlée dit aussi les nouvelles des places et de l'invitation,
 * une fois chacune, sans seconde région. */
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
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

/* Plan personnes, places-demande 14 : une arrivée dite, puis l'état de la
   salle qui change 90 ms après. Un lecteur d'écran lit la région quand elle
   se calme : remplacée aussitôt, l'arrivée n'était jamais lue. */
const avec = (
  liaison: Parameters<typeof LigneParlee>[0]["liaison"],
  nouvelle: { texte: string; cle: number } | null,
) => (
  <LigneParlee
    liaison={liaison}
    salle={1}
    demande={null}
    delai={10}
    peintes={0}
    nouvelle={nouvelle}
  />
);

it("une phrase d'état qui suit de près une arrivée s'y ajoute au lieu de l'effacer", () => {
  vi.useFakeTimers();
  try {
    const rendu = render(avec({ etat: "ok" }, { texte: "Bo prend la place 2.", cle: 1 }));
    vi.advanceTimersByTime(90);
    rendu.rerender(
      avec({ etat: "redemarre", arrivee: false }, { texte: "Bo prend la place 2.", cle: 1 }),
    );
    const dit = screen.getByRole("status").textContent ?? "";
    expect(dit).toContain("Bo prend la place 2.");
    expect(dit).toContain("redémarre");
  } finally {
    vi.useRealTimers();
  }
});

it("jumeau : une phrase d'état qui vient longtemps après l'arrivée la remplace", () => {
  vi.useFakeTimers();
  try {
    const rendu = render(avec({ etat: "ok" }, { texte: "Bo prend la place 2.", cle: 1 }));
    vi.advanceTimersByTime(5000);
    rendu.rerender(
      avec({ etat: "redemarre", arrivee: false }, { texte: "Bo prend la place 2.", cle: 1 }),
    );
    const dit = screen.getByRole("status").textContent ?? "";
    expect(dit).not.toContain("Bo prend la place 2.");
    expect(dit).toContain("redémarre");
  } finally {
    vi.useRealTimers();
  }
});

it("jumeau : deux phrases d'état de suite ne s'additionnent pas", () => {
  vi.useFakeTimers();
  try {
    const rendu = render(avec({ etat: "redemarre", arrivee: false }, null));
    vi.advanceTimersByTime(90);
    rendu.rerender(avec({ etat: "fermee", a: null, pour: null }, null));
    expect(screen.getByRole("status").textContent ?? "").not.toContain("redémarre");
  } finally {
    vi.useRealTimers();
  }
});
