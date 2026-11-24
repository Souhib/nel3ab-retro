import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import manifest from "../../../consoles/consoles.json";
import { ConsoleIcon, GameIcon } from "../components/XmbIcons";
import {
  CONSOLE_CODES,
  CONSOLES,
  consoleLabel,
  consoleLue,
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

it("garde les noms d'étagère d'avant, et la Xbox 360 sans mention", () => {
  // La Xbox 360 perd la mention « expérimental » le 22 novembre 2026, à la
  // demande du propriétaire, après une partie de Sonic de douze minutes et demie
  // sans gel sous X11. La Switch 2 la garde: le jumeau qui prouve que la page lit
  // encore le drapeau.
  expect(CONSOLES.map((one) => one.label)).toEqual([
    "GameCube",
    "Wii",
    "Switch",
    "Switch 2 (expérimental)",
    "Xbox 360",
    "à classer",
  ]);
  expect(consoleLabel("x360")).toBe("Xbox 360");
  expect(consoleLabel("?")).toBe("à classer");
  expect(consoleLabel("nes")).toBe("nes");
});

it("ne dit la mention que par le drapeau, jamais dans un nom ou une note", () => {
  // Un nom ou une note qui porte le statut ment le jour où le drapeau change:
  // le 22 novembre 2026, la note de la Xbox 360 disait encore « expérimentale ».
  expect(manifest.consoles.length).toBeGreaterThan(0);
  for (const one of manifest.consoles) {
    expect(`${one.label} · ${one.note}`, one.code).not.toMatch(/exp[ée]riment/i);
  }
  // Le jumeau: la mention de la Switch 2 vient bien du drapeau, ajoutée ici.
  expect(manifest.consoles.find((one) => one.code === "switch2")?.experimental).toBe(true);
  expect(consoleLabel("switch2")).toMatch(/expérimental/);
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
