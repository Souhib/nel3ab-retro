/** Un essai local du clavier. Le focus réserve les touches à cette zone ;
 * aucun état n'est injecté dans InputStream ni envoyé au jeu. readKeys reste
 * la même traduction que celle de la boucle d'entrée. */
import { readKeys, type KeyProfile } from "../media/pad";
import { keyLabel } from "../media/describe";
import { paintReading } from "./wiring";

export function previewKeyboard(
  root: HTMLElement,
  profile: KeyProfile,
  layout: Map<string, string> | null,
): () => void {
  const target = root.querySelector<HTMLButtonElement>("button")!;
  const output = root.querySelector<HTMLOutputElement>("output")!;
  const held = new Set<string>();
  const paint = () => {
    paintReading(root, readKeys(held, profile));
    for (const key of root.querySelectorAll<HTMLElement>("[data-code]"))
      key.dataset["lit"] = held.has(key.dataset["code"] ?? "") ? "oui" : "non";
    output.textContent = held.size
      ? [...held]
          .map((code) => `${keyLabel(code, layout)}${profile[code] ? "" : " · non assignée"}`)
          .join(" + ")
      : document.activeElement === target
        ? "Appuie sur tes touches. Tab pour sortir."
        : "Clique ici pour tester le clavier.";
  };
  const clear = () => {
    held.clear();
    paint();
  };
  const down = (event: KeyboardEvent) => {
    if (event.code === "Escape" || event.code === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    held.add(event.code);
    paint();
  };
  const up = (event: KeyboardEvent) => {
    held.delete(event.code);
    paint();
  };
  target.addEventListener("keydown", down);
  target.addEventListener("focus", clear);
  target.addEventListener("blur", clear);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", clear);
  paint();
  return () => {
    target.removeEventListener("keydown", down);
    target.removeEventListener("focus", clear);
    target.removeEventListener("blur", clear);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", clear);
    clear();
  };
}
