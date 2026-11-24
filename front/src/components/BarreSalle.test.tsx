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

it("pose la pastille dans sa place, après le nom de la salle et avant « La salle »", () => {
  // Décision du chef de chantier, 24 novembre 2026 : un vrai emplacement
  // dans la barre, jamais par-dessus le nom de la salle.
  const barre = render(
    <BarreSalle
      rect={{ x: 0, y: 0, w: 375, h: 52 }}
      nomSalle="Salle 1"
      jeu="Kart"
      sonCoupe={false}
      onSalle={vi.fn()}
      pastille={<div id="pastilleEtat">Image figée</div>}
    />,
  );
  const tete = barre.container.querySelector("#barreSalle");
  expect(tete?.hasAttribute("data-pastille")).toBe(true);
  // Dans l'ordre de la barre : la tête d'Aïn, les noms, la place de la
  // pastille, « La salle ». Aucun ne se pose sur un autre.
  expect([...(tete?.children ?? [])].map((el) => el.id || el.className)).toEqual([
    "n3-barre-tete rt-mascotte-hote",
    "n3-barre-noms",
    "n3-barre-pastille",
    "laSalle",
  ]);
  expect(barre.container.querySelector(".n3-barre-pastille > #pastilleEtat")).not.toBeNull();
  expect(barre.container.querySelector(".n3-barre-salle")?.textContent).toBe("Salle 1");
  barre.unmount();
  // Le jumeau : sans pastille, ni place vide ni marque.
  const sans = render(
    <BarreSalle
      rect={{ x: 0, y: 0, w: 375, h: 52 }}
      nomSalle="Salle 1"
      jeu="Kart"
      sonCoupe={false}
      onSalle={vi.fn()}
    />,
  );
  expect(sans.container.querySelector("#barreSalle")?.hasAttribute("data-pastille")).toBe(false);
  expect(sans.container.querySelector(".n3-barre-pastille")).toBeNull();
});
