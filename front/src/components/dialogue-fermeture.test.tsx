/**
 * Un dialogue remonté par React ne se ferme pas tout seul.
 *
 * Un navigateur envoie l'événement `close` PLUS TARD que l'appel à `close()`:
 * il le met en file (HTML, « queue an element task »). En développement,
 * React passe deux fois sur chaque effet: il ouvre le dialogue, le referme,
 * puis le rouvre. L'événement de la fermeture du milieu arrivait après la
 * réouverture, et fermait la feuille du bas qu'on venait d'ouvrir; le menu du
 * jeu, lui, ne s'ouvrait jamais en développement (`salle-telephone.mjs`,
 * 22 novembre 2026). La page construite n'a pas ce double passage, d'où un
 * défaut invisible aux bancs qui servent la page construite.
 *
 * Le remplaçant de `setup.ts` envoie `close` tout de suite; ici, il est mis en
 * file comme dans Chrome.
 */
import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GardeSignalement } from "../lib/garde-signalement";
import { FeuilleDuBas } from "./FeuilleDuBas";
import { Tiroir } from "./Tiroir";
import { Xmb } from "./Xmb";

const fermerTout = HTMLDialogElement.prototype.close;
beforeEach(() => {
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    setTimeout(() => this.dispatchEvent(new Event("close")), 0);
  };
});
afterEach(() => {
  HTMLDialogElement.prototype.close = fermerTout;
});

/** Laisse passer la file des tâches, où attend l'événement `close`. */
const fileVidee = () => act(() => new Promise((fini) => setTimeout(fini, 5)));

const feuille = (onFermer: () => void) => (
  <FeuilleDuBas
    titre="salle 1"
    entrees={[{ id: "menu", titre: "Menu du jeu", detail: "", alerte: false }]}
    onEntree={vi.fn()}
    onFermer={onFermer}
    garde={new GardeSignalement()}
    onComplain={vi.fn(async () => {})}
  />
);
const tiroir = (onFermer: () => void) => (
  <Tiroir onFermer={onFermer}>
    <aside id="side" />
  </Tiroir>
);
const menu = (onFermer: () => void) => (
  <Xmb
    categories={[{ id: "salle", label: "salle", icon: null, items: [] }]}
    onClose={vi.fn()}
    onQuitte={onFermer}
  />
);

describe.each([
  ["la feuille du bas", "#feuilleDuBas", feuille],
  ["le tiroir", "#tiroir", tiroir],
  ["le menu du jeu", "#menu", menu],
] as const)("%s", (_, selecteur, monter) => {
  it("reste ouvert après le double passage des effets", async () => {
    const onFermer = vi.fn();
    render(<StrictMode>{monter(onFermer)}</StrictMode>);
    await fileVidee();
    expect(onFermer).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLDialogElement>(selecteur)?.open).toBe(true);
  });

  it("se dit fermé quand le navigateur le ferme vraiment", async () => {
    // Le jumeau: un dialogue qui ignorerait toute fermeture passerait
    // l'essai d'au-dessus. Le geste retour d'Android ferme ainsi.
    const onFermer = vi.fn();
    render(<StrictMode>{monter(onFermer)}</StrictMode>);
    await fileVidee();
    act(() => document.querySelector<HTMLDialogElement>(selecteur)?.close());
    await fileVidee();
    expect(onFermer).toHaveBeenCalledTimes(1);
  });
});
