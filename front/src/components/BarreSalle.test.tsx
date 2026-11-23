/**
 * « La salle » hors de la manette : dans la barre, et seul dans la bande
 * gauche en travers (`#laSalleCote`).
 */
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BoutonSalle } from "./BarreSalle";

it("« La salle » dit le libellé qu'on lui passe à la place de son nom, et son nom sans lui", () => {
  // L'emplacement promis au chantier personnes (« Lina · ta place ») : en
  // travers, c'est ce bouton qui ouvre la feuille, pas un geste de la manette.
  const avec = render(
    <BoutonSalle id="laSalleCote" sonCoupe={false} onSalle={vi.fn()} libelle="Lina · ta place" />,
  );
  const bouton = avec.container.querySelector("#laSalleCote") as HTMLElement;
  expect(bouton.textContent).toBe("Lina · ta place");
  expect(bouton.getAttribute("aria-label")).toBe("Lina · ta place. La salle : son, menu, places");
  avec.unmount();
  const sans = render(<BoutonSalle id="laSalleCote" sonCoupe onSalle={vi.fn()} />);
  const nu = sans.container.querySelector("#laSalleCote") as HTMLElement;
  expect(nu.textContent).toBe("La salle");
  expect(nu.getAttribute("aria-label")).toBe("Son coupé. La salle : son, menu, places");
});
