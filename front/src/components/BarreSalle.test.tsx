/**
 * « La salle » hors de la manette : dans la barre, et seul dans la bande
 * gauche en travers (`#laSalleCote`).
 */
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BarreSalle, BoutonSalle } from "./BarreSalle";

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

it("posé seul en travers, « La salle » porte la tête de la mascotte ; dans la barre, non", () => {
  const seul = render(<BoutonSalle id="laSalleCote" sonCoupe={false} onSalle={vi.fn()} tete />);
  expect(seul.container.querySelector('#laSalleCote [data-hote="barre"]')).not.toBeNull();
  seul.unmount();
  const barre = render(
    <BarreSalle
      rect={{ x: 0, y: 0, w: 390, h: 52 }}
      nomSalle="Salle 1"
      jeu={null}
      sonCoupe={false}
      onSalle={vi.fn()}
    />,
  );
  // Une seule tête dans la barre : la sienne, à gauche du nom.
  const hotes = [...barre.container.querySelectorAll('[data-hote="barre"]')];
  expect(hotes).toHaveLength(1);
  expect(hotes[0]?.closest("#laSalle")).toBeNull();
});

it("la tête d'Aïn est peinte dès le montage, dans son hôte", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const barre = render(
    <BarreSalle
      rect={{ x: 0, y: 0, w: 390, h: 52 }}
      nomSalle="Salle 1"
      jeu={null}
      sonCoupe={false}
      onSalle={vi.fn()}
    />,
  );
  const tete = barre.container.querySelector('[data-hote="barre"] > canvas.rt-mascotte');
  expect(tete).not.toBeNull();
  // La tête n'est pas un logo : pas de sol, pas de marque.
  expect(barre.container.querySelector("[data-sol]")).toBeNull();
  vi.restoreAllMocks();
});
