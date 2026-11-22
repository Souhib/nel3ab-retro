/** Inviter: partager, sinon copier, sinon montrer le lien (audit P11). */
import { describe, expect, it, vi } from "vitest";

import { ditInvitation, inviter } from "./invitation";

const LIEN = "https://nel3ab.app/r/1/?entrer=jouer";

describe("inviter", () => {
  it("partage quand le navigateur sait partager, et ne copie pas en plus", async () => {
    const partager = vi.fn().mockResolvedValue(undefined);
    const copier = vi.fn().mockResolvedValue(undefined);
    expect(await inviter(LIEN, { partager, copier })).toBe("partagee");
    expect(partager).toHaveBeenCalledWith({ title: "nel3ab", url: LIEN });
    expect(copier).not.toHaveBeenCalled();
  });

  it("se tait quand on ferme la feuille de partage", async () => {
    const partager = vi.fn().mockRejectedValue(new DOMException("non", "AbortError"));
    const copier = vi.fn();
    expect(await inviter(LIEN, { partager, copier })).toBe("annulee");
    expect(copier).not.toHaveBeenCalled();
    expect(ditInvitation("annulee")).toBe("");
  });

  it("copie quand le partage échoue pour une autre raison", async () => {
    const partager = vi.fn().mockRejectedValue(new DOMException("refusé", "NotAllowedError"));
    const copier = vi.fn().mockResolvedValue(undefined);
    expect(await inviter(LIEN, { partager, copier })).toBe("copiee");
    expect(copier).toHaveBeenCalledWith(LIEN);
  });

  it("copie sans feuille de partage", async () => {
    const copier = vi.fn().mockResolvedValue(undefined);
    expect(await inviter(LIEN, { copier })).toBe("copiee");
    expect(ditInvitation("copiee")).toContain("copié");
  });

  it("montre le lien quand rien ne marche, plutôt que de se taire", async () => {
    expect(await inviter(LIEN, { copier: vi.fn().mockRejectedValue(new Error("refus")) })).toBe(
      "a-copier",
    );
    expect(await inviter(LIEN, {})).toBe("a-copier");
    expect(ditInvitation("a-copier")).toBe("Copie ce lien :");
  });
});
