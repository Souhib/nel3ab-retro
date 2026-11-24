/**
 * La jaquette en étiquette de cartouche (B9) : pointillé et icône sans
 * image, pixels nets pour une bannière, lissage pour une illustration.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Art } from "./Art";

describe("Art", () => {
  it("sans image : l'icône de manette, en pointillé, et aucun texte dans l'étiquette", () => {
    const { container } = render(<Art index={3} has={false} width={144} console="gc" />);
    const etiquette = container.querySelector(".n3-art");
    expect(etiquette?.hasAttribute("data-vide")).toBe(true);
    expect(etiquette?.querySelector("svg.rt-icone-pixel")).not.toBeNull();
    expect(etiquette?.textContent).toBe("");
    expect(etiquette?.querySelector("img")).toBeNull();
  });

  it("une bannière GameCube : son image, en pixels nets, à trois pour un", () => {
    const { container } = render(<Art index={3} has width={144} console="gc" />);
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toMatch(/\/art\/3\.png$/);
    expect(image?.style.imageRendering).toBe("pixelated");
    expect(container.querySelector(".n3-art")?.hasAttribute("data-vide")).toBe(false);
    const style = (container.querySelector(".n3-art") as HTMLElement).style;
    expect([style.width, style.height]).toEqual(["144px", "48px"]);
  });

  it("une illustration Switch ou Xbox 360 garde le lissage du navigateur", () => {
    for (const console of ["switch", "x360"]) {
      const { container, unmount } = render(<Art index={0} has width={96} console={console} />);
      expect(container.querySelector("img")?.style.imageRendering, console).toBe("auto");
      unmount();
    }
  });
});
