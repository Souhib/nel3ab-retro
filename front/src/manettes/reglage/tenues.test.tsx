/** La table dit quelle commande est tenue, depuis le dessin du jeu, sans
 * passer par React. */
import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { PadMapView } from "../../components/PadMap";
import { GAMECUBE, XBOX } from "../../lib/padmap";
import { suivreTenues } from "./tenues";

const attendre = () => new Promise((fin) => setTimeout(fin, 0));

function monter() {
  const { container } = render(
    <div>
      <div className="n3-dessins">
        <PadMapView map={GAMECUBE} title="gauche" />
        <PadMapView map={XBOX} title="droite" />
      </div>
      <table>
        <tbody>
          {["A", "B", "x", "y", "x-"].map((cle) => (
            <tr key={cle} data-cle={cle} />
          ))}
        </tbody>
      </table>
    </div>,
  );
  const allumer = (part: string, oui: boolean) =>
    container.querySelector(`[data-part="${part}"]`)!.setAttribute("data-lit", oui ? "oui" : "non");
  const tenues = () =>
    [...container.querySelectorAll<HTMLElement>("tr[data-tenu]")].map((tr) => tr.dataset["cle"]);
  return { container, allumer, tenues };
}

it("marque la ligne d'une commande allumée à gauche, et la démarque au relâché", async () => {
  const { container, allumer, tenues } = monter();
  const arreter = suivreTenues(container.firstElementChild!);
  allumer("A", true);
  await attendre();
  expect(tenues()).toEqual(["A"]);
  // Le stick porte ses deux axes et ses deux sens au clavier.
  allumer("x", true);
  await attendre();
  expect(tenues()).toEqual(["A", "x", "y", "x-"]);
  allumer("A", false);
  allumer("x", false);
  await attendre();
  expect(tenues()).toEqual([]);
  arreter();
  // Arrêté : plus rien ne suit.
  allumer("B", true);
  await attendre();
  expect(tenues()).toEqual([]);
});

it("ne lit pas le dessin de droite : b1 allumé ne tient aucune commande", async () => {
  const { container, allumer, tenues } = monter();
  suivreTenues(container.firstElementChild!);
  allumer("b1", true);
  await attendre();
  expect(tenues()).toEqual([]);
});

it("marque aussi les lignes rendues après coup", async () => {
  const { container, allumer, tenues } = monter();
  suivreTenues(container.firstElementChild!);
  allumer("B", true);
  await attendre();
  const ligne = document.createElement("tr");
  ligne.dataset["cle"] = "B";
  container.querySelector("tbody")!.replaceChildren(ligne);
  await attendre();
  expect(tenues()).toEqual(["B"]);
});
