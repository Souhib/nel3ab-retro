/** « Inviter quelqu'un » : le panneau déplié, le lien, le code et la copie (audit P11). */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { lienDInvitation, type Entree } from "../lib/entree";
import { INVITER } from "../lib/mots";
import * as qr from "../lib/qr";
import { Inviter } from "./Inviter";

const lien = (entree: Entree) => lienDInvitation("https://nel3ab.app", "/r/1/", entree);

function monter({
  libre = 4 as number | null,
  copier = vi.fn().mockResolvedValue(undefined),
  partager = undefined as undefined | ((d: { title: string; url: string }) => Promise<void>),
} = {}) {
  const annoncer = vi.fn();
  const charger = vi.fn(() => Promise.resolve(qr));
  const rendu = render(
    <Inviter
      lien={lien}
      libre={libre}
      annoncer={annoncer}
      outils={{ copier, partager }}
      chargerQR={charger}
    />,
  );
  return { annoncer, charger, copier, rendu };
}
const ouvrir = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: INVITER.bouton }));
  });
};
const lienAffiche = () => document.querySelector("#lienInvitation")?.textContent;

describe("replié", () => {
  it("n'est qu'un bouton, et n'évalue pas l'encodeur du code", () => {
    const { charger } = monter();
    expect(screen.getByRole("button", { name: INVITER.bouton })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(document.querySelector("#copierLien")).toBeNull();
    expect(charger).not.toHaveBeenCalled();
  });
});

describe("déplié", () => {
  it("montre le choix, la place qui attend, le lien entier et la condition du réseau", async () => {
    const { charger } = monter();
    await ouvrir();
    expect(screen.getByRole("button", { name: INVITER.bouton })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("radio", { name: INVITER.pourJouer })).toBeChecked();
    expect(screen.getByRole("radio", { name: INVITER.pourRegarder })).not.toBeChecked();
    expect(screen.getByText(INVITER.attend(4))).toBeVisible();
    expect(screen.getByText("4P")).toHaveAttribute("data-libre");
    expect(lienAffiche()).toBe("https://nel3ab.app/r/1/?entrer=jouer");
    // La condition est dite avant tout geste de copie.
    expect(screen.getByText(INVITER.reseau)).toBeVisible();
    expect(screen.getByRole("button", { name: INVITER.copier })).toHaveAttribute(
      "id",
      "copierLien",
    );
    expect(charger).toHaveBeenCalledTimes(1);
  });

  it("dessine le code du lien une fois l'encodeur chargé", async () => {
    monter();
    await ouvrir();
    const code = await screen.findByRole("img", { name: INVITER.code(INVITER.pourJouer) });
    const attendu = qr.chemin(qr.code("https://nel3ab.app/r/1/?entrer=jouer"));
    expect(code.querySelector("path")).toHaveAttribute("d", attendu.d);
  });

  it("« pour regarder » change le lien et le code", async () => {
    monter();
    await ouvrir();
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: INVITER.pourRegarder }));
    });
    expect(lienAffiche()).toBe("https://nel3ab.app/r/1/?entrer=regarder");
    expect(screen.queryByText(INVITER.attend(4))).toBeNull();
    expect(
      await screen.findByRole("img", { name: INVITER.code(INVITER.pourRegarder) }),
    ).toBeInTheDocument();
  });

  it("jumeau : sans place libre, « pour jouer » est désactivé et le lien fait regarder", async () => {
    monter({ libre: null });
    await ouvrir();
    expect(screen.getByRole("radio", { name: INVITER.pourJouer })).toBeDisabled();
    expect(screen.getByRole("radio", { name: INVITER.pourRegarder })).toBeChecked();
    expect(lienAffiche()).toBe("https://nel3ab.app/r/1/?entrer=regarder");
    expect(screen.getByText(INVITER.pleine)).toBeVisible();
  });

  it("ne parle pas lui-même : aucune région annoncée dans le panneau", async () => {
    monter();
    await ouvrir();
    expect(document.querySelector("[role=status], [role=alert], [aria-live]")).toBeNull();
  });

  it("replier rend le focus au bouton", async () => {
    monter();
    await ouvrir();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: INVITER.replier }));
    });
    expect(document.querySelector("#copierLien")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: INVITER.bouton }));
  });
});

describe("copier", () => {
  it("copie le lien choisi et le dit par la ligne de la salle", async () => {
    const { annoncer, copier } = monter();
    await ouvrir();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: INVITER.copier }));
    });
    expect(copier).toHaveBeenCalledWith("https://nel3ab.app/r/1/?entrer=jouer");
    expect(annoncer).toHaveBeenCalledWith(INVITER.copie, "ordinaire");
    // Jumeau : une copie réussie ne sélectionne rien et ne demande rien.
    expect(document.getSelection()?.toString() ?? "").toBe("");
    expect(screen.queryByText(INVITER.aLaMain)).toBeNull();
  });

  it("sélectionne le lien et le dit quand le navigateur refuse de copier", async () => {
    const { annoncer } = monter({ copier: vi.fn().mockRejectedValue(new Error("non")) });
    await ouvrir();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: INVITER.copier }));
    });
    expect(document.getSelection()?.toString()).toBe("https://nel3ab.app/r/1/?entrer=jouer");
    expect(screen.getByText(INVITER.aLaMain)).toBeVisible();
    expect(annoncer).toHaveBeenCalledWith(INVITER.nonCopie, "ordinaire");
  });
});

describe("envoyer", () => {
  it("là où le navigateur partage, « Envoyer le lien » vient d'abord, puis « Copier »", async () => {
    const partager = vi.fn((_d: { title: string; url: string }) => Promise.resolve());
    const { annoncer } = monter({ partager });
    await ouvrir();
    const boutons = [...document.querySelectorAll("#envoyerLien, #copierLien")].map(
      (b) => b.textContent,
    );
    expect(boutons).toEqual([INVITER.envoyer, INVITER.copierCourt]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: INVITER.envoyer }));
    });
    expect(partager).toHaveBeenCalledWith({
      title: "nel3ab",
      url: "https://nel3ab.app/r/1/?entrer=jouer",
    });
    expect(annoncer).toHaveBeenCalledWith(INVITER.envoye, "ordinaire");
  });

  it("jumeau : sans feuille de partage, pas de bouton « Envoyer »", async () => {
    monter();
    await ouvrir();
    expect(document.querySelector("#envoyerLien")).toBeNull();
  });
});
