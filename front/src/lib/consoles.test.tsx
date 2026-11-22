import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import manifest from "../../../consoles/consoles.json";
import { consoleLue } from "../components/LobbyPlan";
import { ConsoleIcon, GameIcon } from "../components/XmbIcons";
import {
  CONSOLE_CODES,
  CONSOLES,
  consoleLabel,
  launchable,
  preparable,
  smoothArt,
  usesProInput,
} from "./consoles";

/** Le garde entre couches côté page (ADR D22).
 *
 * La liste et les capacités se LISENT dans le manifeste. Ce que la page dessine
 * encore à la main, une icône par console et le nom du plan du salon, est
 * comparé au fichier: une console ajoutée au seul manifeste rougit ces essais
 * au lieu de s'afficher avec la silhouette d'un disque muet. */
it("range les consoles du manifeste dans son ordre, puis le rayon « à classer »", () => {
  expect(CONSOLE_CODES).toEqual(manifest.consoles.map((one) => one.code));
  expect(CONSOLES.map((one) => one.code)).toEqual([...CONSOLE_CODES, "?"]);
});

it("garde les noms d'étagère d'avant pour les quatre consoles", () => {
  expect(CONSOLES.slice(0, 4).map((one) => one.label)).toEqual([
    "GameCube",
    "Wii",
    "Switch",
    "Switch 2 (expérimental)",
  ]);
  expect(consoleLabel("?")).toBe("à classer");
  expect(consoleLabel("nes")).toBe("nes");
});

it("sépare les sens de l'ancien isSwitchConsole", () => {
  // La trame Pro: les deux Switch comme avant, et la Xbox 360 décrite.
  expect(["gc", "wii", "switch", "switch2", "x360", "?"].map(usesProInput)).toEqual([
    false,
    false,
    true,
    true,
    true,
    false,
  ]);
  // L'image lissée: les deux Switch comme avant, pas les bannières.
  expect(["gc", "wii", "switch", "switch2", "?"].map(smoothArt)).toEqual([
    false,
    false,
    true,
    true,
    false,
  ]);
  // La préparation: les cinq consoles jouables depuis le 21 novembre 2026, pas « ? ».
  expect(CONSOLE_CODES.filter(preparable)).toEqual(["gc", "wii", "switch", "switch2", "x360"]);
  expect(preparable("?")).toBe(false);
});

it("grise une console décrite mais pas jouable, et pas un disque muet", () => {
  // La Xbox 360 servait d'exemple jusqu'au 21 novembre 2026; le cas reste,
  // lu sur une console que le manifeste ne décrit pas comme jouable.
  expect(launchable("x360")).toBe(true);
  // Le jumeau: « ? » garde son chemin en deux pressions, le worker décide.
  expect(launchable("?")).toBe(true);
  expect(launchable("gc")).toBe(true);
});

it("dessine chaque console du manifeste avec sa propre silhouette", () => {
  const drawn = (console: string) => renderToStaticMarkup(<ConsoleIcon console={console} />);
  const generic = renderToStaticMarkup(<GameIcon />);
  for (const code of CONSOLE_CODES) {
    expect(drawn(code), `${code} n'a pas d'icône`).not.toBe(generic);
  }
  expect(new Set(CONSOLE_CODES.map(drawn)).size).toBe(CONSOLE_CODES.length);
  // Le jumeau: un disque muet garde la silhouette générique.
  expect(drawn("?")).toBe(generic);
});

it("nomme chaque console du manifeste sur le plan du salon", () => {
  for (const code of CONSOLE_CODES) {
    expect(consoleLue(code), code).not.toBe("CONSOLE NON LUE");
  }
  expect(consoleLue("switch")).toBe("SWITCH");
  expect(consoleLue("gc")).toBe("GAMECUBE");
  // Le jumeau: un disque muet reste dit comme tel.
  expect(consoleLue("?")).toBe("CONSOLE NON LUE");
  expect(consoleLue(undefined)).toBeNull();
});
