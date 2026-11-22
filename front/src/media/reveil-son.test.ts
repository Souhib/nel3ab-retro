import { describe, expect, it, vi } from "vitest";
import { GESTES_DU_SON, armerReveilDuSon } from "./reveil-son";

/** Un son qu'on peut couper et rallumer à la main. */
function faux(depart: "suspended" | "running" = "suspended") {
  const son = {
    etat: depart as string,
    running: () => son.etat === "running",
    start: vi.fn(async () => {
      son.etat = "running";
    }),
    reprendre: vi.fn(),
  };
  return son;
}

const geste = (cible: EventTarget, kind = "pointerup") => cible.dispatchEvent(new Event(kind));

describe("le réveil du son", () => {
  it("démarre au premier geste quand rien ne joue", async () => {
    const son = faux();
    const fenetre = new EventTarget();
    armerReveilDuSon(son, fenetre, document);
    geste(fenetre);
    await Promise.resolve();
    expect(son.start).toHaveBeenCalledTimes(1);
  });

  it("ne redémarre pas un son qui joue", () => {
    // Le jumeau: un réveil qui démarrerait à chaque geste rejouerait le
    // déblocage d'iOS à chaque appui de manette.
    const son = faux("running");
    const fenetre = new EventTarget();
    armerReveilDuSon(son, fenetre, document);
    for (const kind of GESTES_DU_SON) geste(fenetre, kind);
    expect(son.start).not.toHaveBeenCalled();
  });

  it("se réarme après une interruption, sans recharger la page", async () => {
    // La faute de l'audit M10: l'écoute se retirait au premier succès. Un
    // appel ou un détour par une autre application coupe le contexte sur iOS
    // (« interrupted »), et plus aucun geste ne le relançait.
    const son = faux();
    const fenetre = new EventTarget();
    armerReveilDuSon(son, fenetre, document);
    geste(fenetre);
    await Promise.resolve();
    expect(son.running()).toBe(true);
    son.etat = "interrupted";
    geste(fenetre, "touchend");
    await Promise.resolve();
    expect(son.start).toHaveBeenCalledTimes(2);
    expect(son.running()).toBe(true);
  });

  it("tente une reprise sans geste au retour sur la page, et seulement alors", () => {
    const son = faux();
    son.etat = "interrupted";
    const fenetre = new EventTarget();
    const visible = { value: "hidden" as DocumentVisibilityState };
    // `defineProperty` et pas `Object.assign`: ce dernier lit le getter une
    // fois et copie sa valeur, et le document restait caché pour toujours.
    const doc = Object.defineProperty(new EventTarget(), "visibilityState", {
      get: () => visible.value,
    }) as unknown as Document;
    armerReveilDuSon(son, fenetre, doc);
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(son.reprendre).not.toHaveBeenCalled();
    visible.value = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(son.reprendre).toHaveBeenCalledTimes(1);
    // Pas `start`: hors d'un geste, iOS refuserait le déblocage et le
    // diagnostic noterait un refus qui n'en est pas un.
    expect(son.start).not.toHaveBeenCalled();
    // Le jumeau: un son qui joue n'est pas repris.
    son.etat = "running";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(son.reprendre).toHaveBeenCalledTimes(1);
  });

  it("se retire entièrement quand on le défait", () => {
    const son = faux();
    const fenetre = new EventTarget();
    const doc = Object.assign(new EventTarget(), {
      visibilityState: "visible",
    }) as unknown as Document;
    const defaire = armerReveilDuSon(son, fenetre, doc);
    defaire();
    for (const kind of GESTES_DU_SON) geste(fenetre, kind);
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(son.start).not.toHaveBeenCalled();
    expect(son.reprendre).not.toHaveBeenCalled();
  });
});
