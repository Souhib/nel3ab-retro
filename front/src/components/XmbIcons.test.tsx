import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ConsoleIcon, CubeIcon, GameIcon, WandIcon } from "./XmbIcons";

it("donne à chaque console sa silhouette et laisse une console inconnue générique", () => {
  const drawn = (console: string) => renderToStaticMarkup(<ConsoleIcon console={console} />);
  expect(drawn("gc")).toBe(renderToStaticMarkup(<CubeIcon />));
  expect(drawn("wii")).toBe(renderToStaticMarkup(<WandIcon />));
  expect(drawn("switch")).not.toBe(drawn("gc"));
  expect(drawn("switch")).not.toBe(drawn("wii"));
  expect(drawn("?")).toBe(renderToStaticMarkup(<GameIcon />));
  expect(drawn("switch")).not.toBe(drawn("?"));
});
