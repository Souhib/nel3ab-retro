import { expect, it } from "vitest";
import manifest from "../../../consoles/consoles.json";
import { supportDe } from "./support";

it("chaque console du manifeste a un geste, et un code inconnu prend la cartouche", () => {
  expect(supportDe("gc")).toBe("disque");
  expect(supportDe("switch")).toBe("carte");
  expect(supportDe("?")).toBe("cartouche");
  expect(supportDe(undefined)).toBe("cartouche");
  for (const one of manifest.consoles) {
    expect(["disc", "cartridge", "card"], `${one.code}: support inconnu`).toContain(one.media);
  }
});
