import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { changerOnglet, fermerReglage, focusRendu, ouvrirReglage, useReglage } from "./entree";

afterEach(() => {
  fermerReglage();
  document.body.innerHTML = "";
});

describe("ouvrirReglage", () => {
  it("ouvre sur l'onglet demandé et retient l'ouvreur qui avait le focus", () => {
    const bouton = document.body.appendChild(document.createElement("button"));
    bouton.focus();
    const { result } = renderHook(() => useReglage());
    expect(result.current).toBeNull();
    act(() => ouvrirReglage("clavier"));
    expect(result.current).toEqual({ onglet: "clavier", ouvreur: bouton });
  });

  it("garde le premier ouvreur quand on rouvre sur un autre onglet", () => {
    const premier = document.body.appendChild(document.createElement("button"));
    const second = document.body.appendChild(document.createElement("button"));
    premier.focus();
    ouvrirReglage("manette");
    second.focus();
    ouvrirReglage("clavier");
    expect(fermerReglage()).toBe(premier);
  });

  it("ne retient pas le corps de la page comme ouvreur", () => {
    (document.activeElement as HTMLElement | null)?.blur();
    ouvrirReglage();
    expect(fermerReglage()).toBeNull();
  });

  it("change d'onglet ouvert, et ne rouvre pas un panneau fermé", () => {
    const { result } = renderHook(() => useReglage());
    act(() => changerOnglet("profils"));
    expect(result.current).toBeNull();
    act(() => ouvrirReglage("manette"));
    act(() => changerOnglet("profils"));
    expect(result.current?.onglet).toBe("profils");
    act(() => {
      fermerReglage();
    });
    expect(result.current).toBeNull();
  });
});

describe("focusRendu", () => {
  it("rend l'ouvreur encore dans la page, et le repli quand il a disparu ou se cache", () => {
    const ouvreur = document.body.appendChild(document.createElement("button"));
    const repli = document.body.appendChild(document.createElement("button"));
    expect(focusRendu(ouvreur, () => repli)).toBe(ouvreur);
    const cache = document.body.appendChild(document.createElement("div"));
    cache.hidden = true;
    cache.append(ouvreur);
    expect(focusRendu(ouvreur, () => repli)).toBe(repli);
    ouvreur.remove();
    expect(focusRendu(ouvreur, () => repli)).toBe(repli);
    expect(focusRendu(null, () => null)).toBeNull();
  });
});
