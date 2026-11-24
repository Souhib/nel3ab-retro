/** « Les nombres de ta manette » dans le panneau : le banc lit la manette
 * tenue, à la cadence de l'écran, et seulement quand on l'ouvre.
 *
 * Trouvé au sixième passage : depuis toujours, le banc des anciens dialogues
 * était peint par `paintWiring` sur la racine des DEUX DESSINS, et il vivait
 * à côté d'elle, dans son propre `<details>`. Il affichait donc « 0.00 »
 * partout, quoi qu'on presse. Le panneau l'avait repris tel quel. */
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InputStream, type InputState } from "../../media/input";
import { standardProfile } from "../../media/pad";
import { SwitchInput } from "../../media/switch";
import type { EntreeDolphin, TrameDolphin } from "./Dolphin";
import { Reglage } from "./Reglage";

const rien = () => {};
const image = () => new Promise((fin) => requestAnimationFrame(fin));
const deuxImages = async () => {
  await act(image);
  await act(image);
};

const XBOX = "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)";
const ADAPTATEUR = "GameCube USB adapter (Vendor: 057e Product: 0337)";

/** Une manette du navigateur : le bouton 6 à 0,65, un horodatage reconnaissable. */
function manette(id = XBOX, mapping = "standard") {
  return {
    id,
    index: 0,
    mapping,
    connected: true,
    timestamp: 4321.4,
    buttons: Array.from({ length: 17 }, (_, at) => ({
      pressed: at === 6,
      touched: at === 6,
      value: at === 6 ? 0.65 : 0,
    })),
    axes: [0.25, 0, 0, 0],
  } as unknown as Gamepad;
}

const brancher = (pad: Gamepad | null) => {
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true,
    value: () => (pad ? [pad] : []),
  });
};
afterEach(() => brancher(null));

const entree = {
  beginCapture: rien,
  cancelCapture: rien,
  beginLesson: rien,
  skipLessonStep: rien,
  reprendreLecon: () => true,
  oublierSuspension: rien,
  useP: rien,
  resetPad: rien,
  resetKeys: rien,
  pickKeys: rien,
  newKeys: rien,
  forgetKeys: rien,
  keyProfileNamed: () => null,
  rendreKeys: rien,
  surReglage: () => rien,
} satisfies EntreeDolphin;

function monterDolphin(pad: Gamepad, patch: Partial<InputState> = {}) {
  brancher(pad);
  const state: InputState = {
    ...new InputStream(() => "", rien).state(),
    padId: pad.id,
    padLayout: pad.mapping === "standard" ? "standard" : "unknown",
    pads: [{ index: 0, id: pad.id, buttons: pad.buttons.length, axes: pad.axes.length }],
    using: 0,
    ...patch,
  };
  const trame: TrameDolphin = {
    genre: "dolphin",
    console: "gc",
    tenue: 0,
    state,
    input: entree,
    refresh: rien,
  };
  return render(
    <Reglage onglet="manette" onOnglet={rien} onFermer={rien} autres={false} vit trame={trame} />,
  );
}

function monterPro(pad: Gamepad) {
  const source = new SwitchInput();
  source.poll(new Set(), [pad]);
  return render(
    <Reglage
      onglet="manette"
      onOnglet={rien}
      onFermer={rien}
      autres={false}
      vit
      trame={{
        genre: "pro",
        console: "Switch",
        xbox: false,
        manette: "manette Pro",
        source,
        input: { switchActive: () => true, surReglage: () => rien },
        place: 1,
      }}
    />,
  );
}

const nombres = (racine: ParentNode) => racine.querySelector<HTMLDetailsElement>(".n3-nombres")!;
const valeur = (racine: ParentNode, marque: string) =>
  racine.querySelector(`[data-gauge="${marque}"] .n3-value`)?.textContent ?? null;
const remplie = (racine: ParentNode, marque: string) =>
  Number.parseFloat(
    racine.querySelector<HTMLElement>(`[data-gauge="${marque}"] .n3-fill`)?.style.height ?? "NaN",
  );

describe("les nombres bougent avec la manette", () => {
  it("Dolphin : ouverts, ils disent la valeur du bouton et l'horodatage", async () => {
    const { container } = monterDolphin(manette());
    nombres(container).open = true;
    await deuxImages();
    expect(valeur(container, "b6")).toBe("0.65");
    expect(remplie(container, "b6")).toBe(65);
    expect(valeur(container, "a0")).toBe("0.25000");
    expect(valeur(container, "stamp")).toBe("4321");
  });

  it("Pro : ouverts, ils lisent la manette de la trame", async () => {
    const { container } = monterPro(manette());
    nombres(container).open = true;
    await deuxImages();
    expect(valeur(container, "b6")).toBe("0.65");
    expect(valeur(container, "stamp")).toBe("4321");
  });

  // Le jumeau du coût : fermés, ils ne se peignent pas. Vingt nombres à la
  // cadence de l'écran pour une boîte que personne ne regarde, c'est ce que
  // la règle 8 refuse.
  it("fermés, ils ne se peignent pas", async () => {
    const { container } = monterDolphin(manette());
    expect(nombres(container).open).toBe(false);
    await deuxImages();
    expect(valeur(container, "b6")).toBe("0.00");
    expect(valeur(container, "stamp")).toBe("0");
  });
});

describe("le repos appris", () => {
  /** Le profil standard, sa gâchette L posée à 0,62 comme celle d'un adaptateur. */
  const profil = () => {
    const p = standardProfile(XBOX);
    p.triggers.L = { button: 6, rest: 0.62 };
    return p;
  };

  it("marque le repos d'un trait, le dit, et la jauge part de lui", async () => {
    const pad = manette();
    (pad.buttons[6] as { value: number }).value = 0.62;
    const { container } = monterDolphin(pad, { profile: profil() });
    nombres(container).open = true;
    await deuxImages();
    const jauge = container.querySelector('[data-gauge="b6"]')!;
    expect(jauge.querySelector<HTMLElement>(".n3-repos")!.style.bottom).toBe("62%");
    expect(jauge.textContent).toContain("repos 0,62");
    expect(valeur(container, "b6")).toBe("0.62");
    expect(remplie(container, "b6")).toBe(0);
  });

  it("Pro : lit le repos de la manette réglée", () => {
    const pad = manette();
    const source = new SwitchInput();
    source.poll(new Set(), [pad]);
    source.profile.devices[pad.id] = {
      standard: false,
      buttons: { ZL: { button: 6, rest: 0.62 } },
      sticks: {},
    };
    const vue = render(
      <Reglage
        onglet="manette"
        onOnglet={rien}
        onFermer={rien}
        autres={false}
        vit
        trame={{
          genre: "pro",
          console: "Switch",
          xbox: false,
          manette: "manette Pro",
          source,
          input: { switchActive: () => true, surReglage: () => rien },
          place: 1,
        }}
      />,
    );
    const trait = vue.container.querySelector<HTMLElement>('[data-gauge="b6"] .n3-repos');
    expect(trait?.style.bottom).toBe("62%");
  });

  it("ne trace aucun trait sans repos appris", () => {
    // Le jumeau : le profil standard n'a appris aucun repos.
    const { container } = monterDolphin(manette(), { profile: standardProfile(XBOX) });
    expect(container.querySelector(".n3-repos")).toBeNull();
    expect(container.querySelector(".n3-nombres")!.textContent).not.toContain("repos");
  });
});

describe("un adaptateur sans disposition standard", () => {
  // Changement 21 : ses nombres sont la seule lecture sûre, ils s'ouvrent.
  it("ouvre ses nombres, en Dolphin comme en Pro", () => {
    const pad = manette(ADAPTATEUR, "");
    expect(nombres(monterDolphin(pad).container).open).toBe(true);
    expect(nombres(monterPro(pad).container).open).toBe(true);
  });

  it("laisse fermés ceux d'une manette standard", () => {
    expect(nombres(monterDolphin(manette()).container).open).toBe(false);
    expect(nombres(monterPro(manette()).container).open).toBe(false);
  });
});

describe("les étiquettes du banc", () => {
  it("sont en minuscules", () => {
    // Changement 20 : plus de capitales forcées par la feuille.
    const { container } = monterDolphin(manette());
    const banc = container.querySelector("[data-bench]")!;
    expect(banc.querySelector(".uppercase")).toBeNull();
    expect(banc.textContent).toContain("horodatage");
  });
});
