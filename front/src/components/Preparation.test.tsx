import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Preparation } from "./Preparation";
import { HAUTEUR_DU_COIN } from "./Colonne";
import { InputStream } from "../media/input";
import type { Preparation as Pending } from "../client";
import type { Pad } from "../lib/saves";

const pending: Pending = {
  id: "round-one",
  game: 1,
  save: 0,
  starter: "alice",
  allowed: [1, 0],
  players: [
    { port: 1, claim: "alice", name: "Alice", pad: null, ready: false },
    { port: 2, claim: "benoit", name: "Benoît", pad: null, ready: false },
  ],
};

beforeEach(() => localStorage.clear());

function show(qui: string, extra: Partial<Parameters<typeof Preparation>[0]> = {}) {
  const input = new InputStream((s) => s, vi.fn(), vi.fn());
  vi.spyOn(input, "attribution").mockReturnValue(qui);
  const bloc = () => (
    <Preparation
      pending={pending}
      input={input}
      state={{ ...input.state(), port: qui === "spectateur" ? null : 1 }}
      selected={1}
      onSelect={vi.fn()}
      send={vi.fn().mockResolvedValue(undefined)}
      {...extra}
    />
  );
  const vue = render(bloc());
  /** Un rendu de plus, avec les mêmes données. */
  return { encore: () => vue.rerender(bloc()) };
}

it("le bloc ne se met pas de côté : il ne couvre rien (P1)", () => {
  // « Plus tard » servait à sortir d'un dialogue modal. Le bloc vit dans la
  // colonne, à côté du jeu : plus rien à écarter.
  show("benoit");
  expect(screen.queryByRole("button", { name: "Plus tard" })).toBeNull();
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.querySelector("#preparation")).not.toBeNull();
});

it("l'initiateur garde l'annulation, et un jeu en cours se garde (P6)", () => {
  show("alice");
  expect(screen.getByRole("button", { name: "Annuler le lancement" })).toBeVisible();
  cleanup();
  show("alice", { enCours: "Kart des Ruelles" });
  expect(screen.getByRole("button", { name: "Garder Kart des Ruelles" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Annuler le lancement" })).toBeNull();
  // Le jumeau : les autres n'ont pas d'annulation.
  cleanup();
  show("benoit", { enCours: "Kart des Ruelles" });
  expect(screen.queryByRole("button", { name: /Garder|Annuler/ })).toBeNull();
});

it("le titre dit qui lance, sans sur-titre en capitales (P4)", () => {
  show("benoit");
  expect(screen.getByRole("heading", { name: "Alice lance le prochain jeu" })).toBeVisible();
  cleanup();
  show("alice");
  expect(screen.getByRole("heading", { name: "Tu prépares le prochain jeu" })).toBeVisible();
  expect(document.body.textContent).not.toContain("Avant de jouer");
});

it("qui regarde lit le compte, sans bouton (P9)", () => {
  show("spectateur");
  const bloc = document.querySelector("#preparation");
  expect(bloc?.textContent).toContain("Aucun joueur sur 2 n'est prêt.");
  expect(bloc?.textContent).toContain("Tu regardes.");
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});

it("« Essayer mes touches » ouvre le réglage, et rien sans réglage", () => {
  const essayer = vi.fn();
  show("benoit", { onEssayer: essayer });
  fireEvent.click(screen.getByRole("button", { name: "Essayer mes touches" }));
  expect(essayer).toHaveBeenCalledOnce();
  cleanup();
  show("benoit");
  expect(screen.queryByRole("button", { name: "Essayer mes touches" })).toBeNull();
});

it("aucune carte de jeu dans le bloc : la ligne du jeu suffit (P5)", () => {
  show("benoit");
  expect(document.querySelector(".n3-game-card")).toBeNull();
});

/** Un panneau où Benoît a déjà confirmé, ou non, vu par `qui`. */
function rendre(qui: string, benoitPret: boolean, allowed: number[] = [1, 0]) {
  const input = new InputStream((s) => s, vi.fn(), vi.fn());
  vi.spyOn(input, "attribution").mockReturnValue(qui);
  const send = vi.fn().mockResolvedValue(undefined);
  render(
    <Preparation
      pending={{
        ...pending,
        allowed,
        players: [
          pending.players[0],
          { ...pending.players[1], ready: benoitPret, pad: benoitPret ? allowed[0] : null },
        ],
      }}
      game={{ index: 1, name: "Mario Kart Wii", console: allowed.length > 1 ? "wii" : "gc" }}
      input={input}
      state={input.state()}
      selected={allowed[0] as 0 | 1}
      onSelect={vi.fn()}
      send={send}
    />,
  );
  return send;
}

it("le chef lance en un geste, avec son propre choix (audit P6)", async () => {
  const send = rendre("alice", true);
  // « Je suis prêt » puis « Lancer » disaient deux fois la même chose.
  expect(screen.queryByRole("button", { name: "Je suis prêt" })).toBeNull();
  const lancer = screen.getByRole("button", { name: "Lancer le jeu" });
  expect(lancer).toBeEnabled();
  fireEvent.click(lancer);
  expect(send).toHaveBeenCalledWith({ action: "launch", pad: 1, id: "round-one" });
});

it("le chef attend un joueur qui se prépare, et le dit", () => {
  rendre("alice", false);
  expect(screen.getByRole("button", { name: "Lancer le jeu" })).toBeDisabled();
  expect(screen.getByText("En attente de Benoît.")).toBeVisible();
  // Le jumeau: pas de raccourci avant le délai.
  expect(screen.queryByRole("button", { name: /sans attendre/ })).toBeNull();
});

it("le chef lance sans attendre un absent, après le délai", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const send = rendre("alice", false);
    await act(async () => {
      vi.advanceTimersByTime(21_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Lancer sans attendre Benoît" }));
    expect(send).toHaveBeenCalledWith({
      action: "launch",
      pad: 1,
      sans_attendre: true,
      id: "round-one",
    });
  } finally {
    vi.useRealTimers();
  }
});

it("le délai part de l'arrivée du dernier absent, pas de l'ouverture du panneau", async () => {
  // Relecture du 22 novembre 2026: quelqu'un qui s'assoit à 19 s pouvait être
  // lancé sans lui à 20 s. Le salon compte depuis son arrivée; la page aussi.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const input = new InputStream((s) => s, vi.fn(), vi.fn());
    vi.spyOn(input, "attribution").mockReturnValue("alice");
    const panneau = (players: Pending["players"]) => (
      <Preparation
        pending={{ ...pending, players }}
        game={{ index: 1, name: "Mario Kart Wii", console: "wii" }}
        input={input}
        state={input.state()}
        selected={1}
        onSelect={vi.fn()}
        send={vi.fn().mockResolvedValue(undefined)}
      />
    );
    const benoitPret = { ...pending.players[1], ready: true, pad: 1 };
    const vue = render(panneau([pending.players[0], benoitPret]));
    await act(async () => {
      vi.advanceTimersByTime(19_000);
    });
    const cleo = { port: 3, claim: "cleo", name: "Cléo", pad: null, ready: false };
    vue.rerender(panneau([pending.players[0], benoitPret, cleo]));
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    // 21 s après l'ouverture, 2 s après l'arrivée de Cléo: pas encore.
    expect(screen.getByText("En attente de Cléo.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /sans attendre/ })).toBeNull();
    // Le jumeau: vingt secondes après SON arrivée, le chef peut lancer sans elle.
    await act(async () => {
      vi.advanceTimersByTime(19_000);
    });
    expect(screen.getByRole("button", { name: "Lancer sans attendre Cléo" })).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});

it("l'attente d'un prénom à voyelle s'élide", () => {
  const input = new InputStream((s) => s, vi.fn(), vi.fn());
  vi.spyOn(input, "attribution").mockReturnValue("alice");
  render(
    <Preparation
      pending={{
        ...pending,
        players: [pending.players[0], { ...pending.players[1], name: "Éloi" }],
      }}
      input={input}
      state={input.state()}
      selected={1}
      onSelect={vi.fn()}
      send={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  expect(screen.getByText("En attente d'Éloi.")).toBeVisible();
});

it("les autres confirment, et ne lancent pas", () => {
  rendre("benoit", false);
  expect(screen.getByRole("button", { name: "Je suis prêt" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Lancer le jeu" })).toBeNull();
});

it("un seul appareil se nomme, sans liste à une seule option", () => {
  rendre("alice", true, [0]);
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
  expect(screen.getByText("Ton appareil : manette GameCube")).toBeVisible();
  // Le jumeau: deux appareils se choisissent, en radios et non en liste (P7).
  cleanup();
  rendre("alice", true, [1, 0]);
  expect(screen.getAllByRole("radio")).toHaveLength(2);
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getByRole("group", { name: "Avec quoi joues-tu ?" })).toBeVisible();
});

it("« Je suis prêt » envoie le choix coché, prêt (P7)", () => {
  const send = rendre("benoit", false, [1, 0]);
  fireEvent.click(screen.getByRole("button", { name: "Je suis prêt" }));
  expect(send).toHaveBeenCalledWith({ action: "choose", pad: 1, ready: true, id: "round-one" });
});

it("le compte ne parle pas ; un joueur prêt se dit une fois (P10)", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const input = new InputStream((s) => s, vi.fn(), vi.fn());
    vi.spyOn(input, "attribution").mockReturnValue("alice");
    const annoncer = vi.fn();
    const bloc = (benoitPret: boolean) => (
      <Preparation
        pending={{
          ...pending,
          players: [pending.players[0], { ...pending.players[1], ready: benoitPret }],
        }}
        input={input}
        state={input.state()}
        selected={1}
        onSelect={vi.fn()}
        send={vi.fn().mockResolvedValue(undefined)}
        annoncer={annoncer}
      />
    );
    const vue = render(bloc(false));
    const annuler = screen.getByRole("button", { name: "Annuler le lancement" });
    annuler.focus();
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    expect(annoncer).not.toHaveBeenCalled();
    // Le compte tourne sans redessiner les gestes (P2) : même nœud, même focus.
    expect(screen.getByRole("button", { name: "Annuler le lancement" })).toBe(annuler);
    expect(document.activeElement).toBe(annuler);
    vue.rerender(bloc(true));
    vue.rerender(bloc(true));
    expect(annoncer.mock.calls).toEqual([["Benoît est prêt."]]);
  } finally {
    vi.useRealTimers();
  }
});

it("un refus du salon s'écrit dans le bloc et se dit (P10)", async () => {
  const input = new InputStream((s) => s, vi.fn(), vi.fn());
  vi.spyOn(input, "attribution").mockReturnValue("benoit");
  const annoncer = vi.fn();
  render(
    <Preparation
      pending={pending}
      input={input}
      state={input.state()}
      selected={1}
      onSelect={vi.fn()}
      send={vi.fn().mockRejectedValue(new Error("La préparation est terminée."))}
      annoncer={annoncer}
    />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Je suis prêt" }));
  });
  expect(document.querySelector("#preparation")?.textContent).toContain(
    "La préparation est terminée.",
  );
  expect(annoncer).toHaveBeenCalledWith("La préparation est terminée.");
});

/* La préparation d'une salle Pro (Switch, Xbox 360) est le même bloc depuis
   le 24 novembre 2026 : le crochet `usePreparationPro`, qui la posait dans
   l'ancien panneau de la trame Pro, est parti avec lui. Ses essais T03 vivent
   dans `Preparation.appareil.test.tsx` ; le lancement en un geste est ici,
   sur le bloc, avec la manette Pro (appareil 4). */
function rendrePro(console: "x360" | "switch", qui: string) {
  const input = new InputStream((s) => s, vi.fn(), vi.fn());
  vi.spyOn(input, "attribution").mockReturnValue(qui);
  const send = vi.fn().mockResolvedValue(undefined);
  render(
    <Preparation
      pending={{
        ...pending,
        allowed: [4],
        players: [pending.players[0], { ...pending.players[1], ready: true, pad: 4 }],
      }}
      game={{ index: 1, name: "Un jeu", console }}
      input={input}
      state={input.state()}
      // Le type `Pad` s'arrête à 3 ; la salle passe le premier appareil
      // permis tel quel (`useSetupChoice`), ici la manette Pro.
      selected={4 as Pad}
      onSelect={vi.fn()}
      send={send}
    />,
  );
  return send;
}

it("le chef d'une salle Pro lance en un geste, avec la manette Pro (audit P6)", () => {
  const send = rendrePro("x360", "alice");
  expect(screen.queryByRole("button", { name: "Je suis prêt" })).toBeNull();
  const lancer = screen.getByRole("button", { name: "Lancer le jeu" });
  expect(lancer).toBeEnabled();
  fireEvent.click(lancer);
  expect(send).toHaveBeenCalledWith({ action: "launch", pad: 4, id: "round-one" });
});

it("le jumeau : dans une salle Pro, qui ne lance pas confirme et ne lance pas", () => {
  rendrePro("switch", "benoit");
  expect(screen.queryByRole("button", { name: "Lancer le jeu" })).toBeNull();
});

// La rangée de gestes colle au-dessus du coin d'Aïn et de « Plus bas » (P2,
// ADR D46) : sa marge suit les deux hauteurs, écrites ailleurs. Les modules
// de Node sont importés à l'exécution, comme dans `lib/regie.test.ts` : la
// page n'a pas leurs types.
type Fs = { readFileSync: (chemin: string, codage: "utf-8") => string };
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
const lire = (relatif: string) =>
  fs.readFileSync(new URL(relatif, import.meta.url).pathname, "utf-8");
const preparationCss = lire("./preparation.css");
const cadreCss = lire("./cadre.css");
it("la rangée de gestes colle au-dessus du coin et de « Plus bas », à leur hauteur", () => {
  const regle =
    /\.n3-colonne:has\(\.n3-colonne-pied\) \.n3-prep-actions \{\s*bottom: calc\((\d+)px \+ ([\d.]+rem)\);/.exec(
      preparationCss,
    );
  expect(regle).not.toBeNull();
  expect(Number(regle![1])).toBe(HAUTEUR_DU_COIN);
  const plusBas = /\.n3-plus-bas \{[^}]*?\sheight: ([\d.]+rem);/.exec(cadreCss);
  expect(plusBas?.[1]).toBe(regle![2]);
});

// P2 : un choix qui prend le focus sous la rangée collée défile au-dessus
// d'elle, au focus et après le rendu qui suit (l'avis du clavier pousse la
// colonne). jsdom n'a pas de mise en page : les boîtes sont posées à la main.
it("un choix caché sous la rangée de gestes défile au-dessus d'elle, au focus et après un rendu", () => {
  const defile = vi.fn();
  const avant = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = defile;
  let basDuChoix = 300;
  const boite = (haut: number, bas: number) =>
    ({ top: haut, bottom: bas, height: bas - haut }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains("n3-prep-actions")) return boite(400, 500);
      return boite(basDuChoix - 30, basDuChoix);
    },
  );
  try {
    const { encore } = show("benoit");
    const radio = document.querySelector<HTMLInputElement>("#preparation input[type=radio]")!;
    // Le jumeau : au-dessus de la rangée, rien ne défile.
    act(() => radio.focus());
    expect(defile).not.toHaveBeenCalled();
    // Sous la rangée : il défile, et la marge suit la hauteur de la rangée.
    basDuChoix = 420;
    act(() => radio.blur());
    act(() => radio.focus());
    expect(defile).toHaveBeenCalledTimes(1);
    expect(document.getElementById("preparation")?.style.getPropertyValue("--hauteur-gestes")).toBe(
      "100px",
    );
    // Après un rendu qui le repousse dessous, encore une fois.
    defile.mockClear();
    encore();
    expect(defile).toHaveBeenCalledTimes(1);
    // Un geste de la rangée ne fait rien défiler : il est collé.
    defile.mockClear();
    act(() => document.querySelector<HTMLElement>(".n3-prep-actions button")!.focus());
    encore();
    expect(defile).not.toHaveBeenCalled();
  } finally {
    HTMLElement.prototype.scrollIntoView = avant;
    vi.restoreAllMocks();
  }
});
