/** Une publication refusée sur la trame Dolphin se dit comme un refus Pro :
 * le son grave du socle (effet « sons », coupé par défaut) et l'avis qui la
 * dit secoué (effet « secousse », niveau tout, décidé par le socle). Le
 * jumeau : une publication acceptée ne joue et ne secoue rien. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputStream } from "../../media/input";
import type { EntreeDolphin, TrameDolphin } from "./Dolphin";
import { Reglage } from "./Reglage";

const joues = vi.hoisted(() => [] as string[]);
const secoues = vi.hoisted(() => [] as HTMLElement[]);
vi.mock("../../retro/secousse", () => ({
  secouer: (el: HTMLElement) => {
    secoues.push(el);
    return true;
  },
}));
vi.mock("../../retro/sons", async (original) => ({
  ...(await original<typeof import("../../retro/sons")>()),
  sonMenu: (son: string) => {
    joues.push(son);
    return true;
  },
}));

const rien = () => {};

afterEach(() => {
  joues.length = 0;
  secoues.length = 0;
  localStorage.clear();
});

const entree = (): EntreeDolphin => ({
  beginCapture: vi.fn(),
  cancelCapture: vi.fn(),
  beginLesson: vi.fn(),
  skipLessonStep: vi.fn(),
  reprendreLecon: vi.fn(() => true),
  oublierSuspension: vi.fn(),
  useP: vi.fn(),
  resetPad: vi.fn(),
  resetKeys: vi.fn(),
  pickKeys: vi.fn(),
  newKeys: vi.fn(),
  forgetKeys: vi.fn(),
  keyProfileNamed: vi.fn(() => null),
  rendreKeys: vi.fn(),
  surReglage: () => rien,
});

function monter(publier: TrameDolphin["publier"]) {
  const state = { ...new InputStream(() => "", rien).state(), lockedProfiles: [] };
  const trame: TrameDolphin = {
    genre: "dolphin",
    console: "gc",
    tenue: 0,
    state,
    input: entree(),
    refresh: rien,
    publier,
  };
  render(
    <Reglage onglet="profils" onOnglet={rien} onFermer={rien} autres={false} vit trame={trame} />,
  );
  return async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publier dans la salle" }));
      await new Promise((fin) => setTimeout(fin, 0));
    });
  };
}

describe("une publication du clavier refusée", () => {
  it("joue le son grave et secoue l'avis quand le salon refuse", async () => {
    const publier = monter(async () => false);
    await publier();
    const avis = screen.getByText("Publication impossible. Tes réglages à toi sont gardés.");
    expect(joues).toEqual(["erreur"]);
    expect(secoues).toEqual([avis]);
  });

  it("fait de même quand l'envoi échoue", async () => {
    const publier = monter(async () => {
      throw new Error("hors ligne");
    });
    await publier();
    const avis = screen.getByText("Publication impossible. Réessaie dans un instant.");
    expect(joues).toEqual(["erreur"]);
    expect(secoues).toEqual([avis]);
  });

  it("secoue de nouveau un second refus qui dit la même phrase", async () => {
    const publier = monter(async () => false);
    await publier();
    await publier();
    expect(joues).toEqual(["erreur", "erreur"]);
    expect(secoues).toHaveLength(2);
  });

  it("ne joue et ne secoue rien quand la publication passe", async () => {
    const publier = monter(async () => true);
    await publier();
    expect(screen.getByText("Profil publié dans la salle.")).toBeTruthy();
    expect(joues).toEqual([]);
    expect(secoues).toEqual([]);
  });
});
