/** Inviter : envoyer, copier, sinon montrer le lien sélectionné (audit P11). */
import { describe, expect, it, vi } from "vitest";

import { copier, envoyer, selectionner } from "./invitation";

const LIEN = "https://nel3ab.app/r/1/?entrer=jouer";

describe("envoyer", () => {
  it("passe par la feuille de partage, et ne copie pas en plus", async () => {
    const partager = vi.fn().mockResolvedValue(undefined);
    const copie = vi.fn().mockResolvedValue(undefined);
    expect(await envoyer(LIEN, { partager, copier: copie })).toBe("envoyee");
    expect(partager).toHaveBeenCalledWith({ title: "nel3ab", url: LIEN });
    expect(copie).not.toHaveBeenCalled();
  });

  it("se tait quand on ferme la feuille de partage", async () => {
    const partager = vi.fn().mockRejectedValue(new DOMException("non", "AbortError"));
    const copie = vi.fn();
    expect(await envoyer(LIEN, { partager, copier: copie })).toBe("annulee");
    expect(copie).not.toHaveBeenCalled();
  });

  it("copie quand le partage échoue pour une autre raison", async () => {
    const partager = vi.fn().mockRejectedValue(new DOMException("refusé", "NotAllowedError"));
    const copie = vi.fn().mockResolvedValue(undefined);
    expect(await envoyer(LIEN, { partager, copier: copie })).toBe("copiee");
    expect(copie).toHaveBeenCalledWith(LIEN);
  });
});

describe("copier", () => {
  it("copie le lien entier", async () => {
    const copie = vi.fn().mockResolvedValue(undefined);
    expect(await copier(LIEN, { copier: copie })).toBe("copiee");
    expect(copie).toHaveBeenCalledWith(LIEN);
  });

  it("demande une copie à la main quand rien ne marche, plutôt que de se taire", async () => {
    expect(await copier(LIEN, { copier: vi.fn().mockRejectedValue(new Error("refus")) })).toBe(
      "a-copier",
    );
    expect(await copier(LIEN, {})).toBe("a-copier");
  });

  it("jumeau : copier n'ouvre jamais la feuille de partage", async () => {
    const partager = vi.fn().mockResolvedValue(undefined);
    await copier(LIEN, { partager, copier: vi.fn().mockResolvedValue(undefined) });
    expect(partager).not.toHaveBeenCalled();
  });
});

describe("selectionner", () => {
  it("met tout le texte de l'élément dans la sélection du document", () => {
    const p = document.createElement("p");
    p.textContent = LIEN;
    document.body.append(p);
    selectionner(p);
    expect(document.getSelection()?.toString()).toBe(LIEN);
    p.remove();
  });
});
