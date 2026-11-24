/** Un geste refusé sur la trame Pro joue le son grave du socle (effet
 * « sons », coupé par défaut) en plus de dire son refus : un fichier qui
 * n'est pas un profil, un fichier trop grand. Il secoue aussi l'avis qui le
 * dit (effet « secousse », niveau tout, décidé par le socle). Le jumeau : un
 * profil valide ne joue et ne secoue rien. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SwitchInput } from "../../media/switch";
import { Reglage } from "./Reglage";
import type { TramePro } from "./Pro";

const joues = vi.hoisted(() => [] as string[]);
const secoues = vi.hoisted(() => [] as HTMLElement[]);
vi.mock("../../retro/secousse", () => ({
  // La secousse du socle décide elle-même du niveau (tout), du mouvement
  // réduit et de l'image : ici, on retient seulement l'élément secoué.
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

function monter() {
  const source = new SwitchInput();
  const trame: TramePro = {
    genre: "pro",
    console: "Switch",
    xbox: false,
    manette: "manette Pro",
    source,
    input: { switchActive: () => true, surReglage: () => rien },
    place: 1,
  };
  const vue = render(
    <Reglage onglet="profils" onOnglet={rien} onFermer={rien} autres={false} vit trame={trame} />,
  );
  const fichier = vue.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const deposer = async (contenu: string, taille?: number) => {
    const pris = new File([contenu], "profil.json", { type: "application/json" });
    if (taille !== undefined) Object.defineProperty(pris, "size", { value: taille });
    await act(async () => {
      fireEvent.change(fichier, { target: { files: [pris] } });
      await new Promise((fin) => setTimeout(fin, 0));
    });
  };
  return { source, deposer };
}

describe("un refus sur la trame Pro", () => {
  it("joue le son grave pour un fichier qui n'est pas un profil", async () => {
    const { deposer } = monter();
    await deposer('{"pas":"un profil"}');
    expect(screen.getByText("Ce fichier n’est pas un profil de manette valide.")).toBeTruthy();
    expect(joues).toEqual(["erreur"]);
  });

  it("joue le son grave pour un fichier trop grand", async () => {
    const { deposer } = monter();
    await deposer("{}", 200_000);
    expect(joues).toEqual(["erreur"]);
  });

  it("secoue l'avis qui dit le refus", async () => {
    const { deposer } = monter();
    await deposer('{"pas":"un profil"}');
    const avis = screen.getByText("Ce fichier n’est pas un profil de manette valide.");
    expect(secoues).toEqual([avis]);
    expect(avis.getAttribute("role")).toBe("status");
  });

  it("ne joue rien et ne secoue rien pour un profil valide", async () => {
    const { source, deposer } = monter();
    await deposer(JSON.stringify(source.profile));
    expect(joues).toEqual([]);
    expect(secoues).toEqual([]);
  });
});
