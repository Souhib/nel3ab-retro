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

/* Les pixels que chaque toile reçoit, par une toile simulée : jsdom n'a pas
   de contexte 2D. L'essai ne regardait que la présence de la toile, sous un
   contexte nul : il passait sans qu'un seul pixel soit peint (relecture
   d'Aïn, 24 novembre 2026). */
function compterLesPixels(avecContexte: boolean) {
  const pixels = new Map<HTMLCanvasElement, number>();
  const contexte = (toile: HTMLCanvasElement) =>
    ({
      clearRect() {},
      drawImage() {},
      fillStyle: "",
      fillRect() {
        pixels.set(toile, (pixels.get(toile) ?? 0) + 1);
      },
    }) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return avecContexte ? contexte(this) : null;
  } as typeof HTMLCanvasElement.prototype.getContext);
  return pixels;
}

it("la tête d'Aïn est peinte dès le montage, dans son hôte", () => {
  const pixels = compterLesPixels(true);
  const barre = render(
    <BarreSalle
      rect={{ x: 0, y: 0, w: 390, h: 52 }}
      nomSalle="Salle 1"
      jeu={null}
      sonCoupe={false}
      onSalle={vi.fn()}
    />,
  );
  const tete = barre.container.querySelector<HTMLCanvasElement>(
    '[data-hote="barre"] > canvas.rt-mascotte',
  );
  expect(tete).not.toBeNull();
  // Une tête d'Aïn : des dizaines de pixels de la grille, sur SA toile.
  expect(pixels.get(tete as HTMLCanvasElement) ?? 0).toBeGreaterThan(50);
  // La tête n'est pas un logo : pas de sol, pas de marque.
  expect(barre.container.querySelector("[data-sol]")).toBeNull();
  vi.restoreAllMocks();
});

it("jumeau : sans contexte 2D, la toile est posée mais rien n'est compté", () => {
  const pixels = compterLesPixels(false);
  const barre = render(
    <BarreSalle
      rect={{ x: 0, y: 0, w: 390, h: 52 }}
      nomSalle="Salle 1"
      jeu={null}
      sonCoupe={false}
      onSalle={vi.fn()}
    />,
  );
  expect(barre.container.querySelector('[data-hote="barre"] > canvas.rt-mascotte')).not.toBeNull();
  expect(pixels.size).toBe(0);
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
