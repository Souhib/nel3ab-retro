import { describe, expect, it } from "vitest";

import { muteNews } from "./sourdine";

describe("ce que la page dit de sa sourdine", () => {
  it("dit la coupure et le retour du son", () => {
    expect(muteNews(false, true)).toBe("coupé");
    expect(muteNews(true, false)).toBe("remis");
  });

  it("ne répète pas ce que le salon sait déjà", () => {
    expect(muteNews(true, true)).toBeNull();
    expect(muteNews(false, false)).toBeNull();
  });

  it("une page qui s'ouvre avec le son ne dit rien, une page en sourdine le dit", () => {
    expect(muteNews(null, false)).toBeNull();
    expect(muteNews(null, true)).toBe("coupé");
  });
});
