/**
 * Le portail des avis qui doivent passer au-dessus du menu ouvert.
 *
 * Le menu est un dialogue modal: tout ce qui n'est pas DANS le dialogue devient
 * inerte. Un avis ne se voit donc au-dessus du menu que s'il est rendu dans la
 * place que le menu lui réserve. Aucun essai ne citait ce composant dans la
 * première version (relecture du 22 novembre 2026).
 */
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { HoteDesSurcouches, PlaceDesSurcouches, Surcouche } from "./Surcouche";

function Page({ menu }: { menu: boolean }) {
  return (
    <HoteDesSurcouches>
      <main>
        <Surcouche>
          <p>avis de lancement</p>
        </Surcouche>
      </main>
      {menu ? (
        <dialog id="menu" open>
          <footer>pied</footer>
          <PlaceDesSurcouches />
        </dialog>
      ) : null}
    </HoteDesSurcouches>
  );
}

it("rend l'avis dans le menu ouvert, à la place qu'il réserve", () => {
  render(<Page menu />);
  const avis = screen.getByText("avis de lancement");
  expect(avis.closest("#menu")).not.toBeNull();
  expect(avis.closest("[data-surcouche]")).not.toBeNull();
  expect(avis.closest("main")).toBeNull();
});

it("le jumeau: sans menu, l'avis reste à sa place dans la page", () => {
  const { rerender } = render(<Page menu />);
  rerender(<Page menu={false} />);
  const avis = screen.getByText("avis de lancement");
  expect(avis.closest("main")).not.toBeNull();
  expect(document.querySelector("[data-surcouche]")).toBeNull();
});

it("donne aux avis la hauteur du pied du menu", () => {
  render(<Page menu />);
  const place = document.querySelector<HTMLElement>("[data-surcouche]");
  // jsdom ne mesure rien: la hauteur lue vaut 0, mais la variable est posée
  // là où les avis la lisent (`index.css`, `--pied-menu`).
  expect(place?.style.getPropertyValue("--pied-menu")).toBe("0px");
});
