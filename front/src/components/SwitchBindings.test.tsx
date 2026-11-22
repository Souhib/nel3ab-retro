import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SwitchBindings } from "./SwitchBindings";
import { InputStream } from "../media/input";
import type { Preparation } from "../client";
import { SWITCH_BUTTONS } from "../media/switch";
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
});
afterEach(() => vi.unstubAllGlobals());
function show(ready = false, pending = false, pads: Gamepad[] = []) {
  const input = new InputStream((p) => p, vi.fn(), vi.fn());
  input.switch.pads = pads;
  vi.spyOn(input, "attribution").mockReturnValue("claim-1");
  const block = vi.spyOn(input, "blockGameplay");
  const send = vi.fn().mockResolvedValue(undefined);
  // Benoît lance: la page vue ici est celle d'un joueur qui confirme son choix.
  // Le chef, lui, lance avec son choix en un geste (voir plus bas).
  const preparation = {
    id: "launch-1",
    starter: "claim-2",
    save: 0,
    players: [
      { claim: "claim-1", port: 1, name: "Alice", ready, pad: 4 },
      { claim: "claim-2", port: 2, name: "Benoit", ready: false, pad: 4 },
    ],
  } as Preparation;
  const view = render(
    <SwitchBindings
      input={input}
      source={input.switch}
      pending={pending ? preparation : null}
      send={send}
      close={vi.fn()}
    />,
  );
  return { input, block, send, ...view };
}
it("opens one correspondence list and leaves diagnostics closed; release on dismissal", () => {
  const { block, unmount } = show();
  expect(screen.getByText("Toutes les correspondances").closest("details")).toHaveAttribute("open");
  expect(
    screen.getByText("Diagnostic des boutons et des axes").closest("details"),
  ).not.toHaveAttribute("open");
  expect(block).toHaveBeenLastCalledWith(true);
  unmount();
  expect(block).toHaveBeenLastCalledWith(false);
});
it("saves and restores a named personal profile without marking the player ready", () => {
  const { input, send } = show(false, true);
  fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Tennis" } });
  fireEvent.click(screen.getByText("Enregistrer"));
  expect(input.switch.named.Tennis).toBeDefined();
  input.switch.profile.keys.A = "KeyM";
  fireEvent.change(screen.getByLabelText("Profil"), { target: { value: "Tennis" } });
  fireEvent.click(screen.getByText("Charger"));
  expect(input.switch.profile.keys.A).toBe("KeyX");
  expect(send).not.toHaveBeenCalled();
  expect(screen.queryByText("Lancer le jeu")).toBeNull();
  fireEvent.click(screen.getByText("Je suis prêt"));
  expect(send).toHaveBeenCalledWith({ id: "launch-1", action: "choose", pad: 4, ready: true });
});
it("a ready player must withdraw confirmation before changing a profile", () => {
  const { send } = show(true, true);
  expect(screen.getByText("Enregistrer")).toBeDisabled();
  expect(screen.getByText("Charger")).toBeDisabled();
  expect(screen.queryByText("Lancer le jeu")).toBeNull();
  fireEvent.click(screen.getByText("Modifier ma configuration"));
  expect(send).toHaveBeenCalledWith({ id: "launch-1", action: "choose", pad: 4, ready: false });
});

it("shows only the keyboard column, and says no controller is there, with a keyboard alone", () => {
  show();
  expect(screen.getByText("Clavier")).toBeInTheDocument();
  expect(screen.queryByText("Manette")).toBeNull();
  // The negative twin of the controller test below: 24 disabled
  // "Non assigné" buttons used to fill this column without a controller.
  expect(screen.queryAllByText("Non assigné")).toHaveLength(0);
  expect(screen.queryAllByLabelText(/Effacer la commande/)).toHaveLength(0);
  expect(screen.getByText("Aucune manette détectée")).toBeInTheDocument();
  expect(screen.getByLabelText(/Manette physique/)).toBeDisabled();
});
it("adds the controller column once a controller is plugged in", () => {
  const pad = { index: 0, id: "Manette test", mapping: "standard", buttons: [], axes: [] };
  show(false, false, [pad as unknown as Gamepad]);
  expect(screen.getByText("Manette")).toBeInTheDocument();
  expect(screen.getAllByLabelText(/Effacer la commande/)).toHaveLength(24);
  expect(screen.getByText("Première manette détectée")).toBeInTheDocument();
});
it("starts on the default profile and loads it back after a change", () => {
  const { input } = show();
  const select = screen.getByLabelText("Profil") as HTMLSelectElement;
  expect(select.value).toBe("");
  expect(select.options[0].text).toBe("Profil par défaut");
  expect(screen.getByText(/En service : Profil par défaut/)).toBeInTheDocument();
  input.switch.profile.keys.A = "KeyM";
  fireEvent.click(screen.getByText("Charger"));
  expect(input.switch.profile.keys.A).toBe("KeyX");
});

it("lights the pressed button and tilts both sticks on the shared Pro drawing", () => {
  // The paint loop runs outside React: hold its frame and run it by hand.
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  const { input, container } = show();
  vi.spyOn(input, "switchActive").mockReturnValue(true);
  input.switch.reading = { buttons: 1 << SWITCH_BUTTONS.indexOf("B"), lx: 1, ly: 0, rx: 0, ry: -1 };
  frame?.(0);
  expect(container.querySelector('[data-padmap="switch-pro"] [data-part="B"]')).toHaveAttribute(
    "data-lit",
    "oui",
  );
  // The negative twin: the button beside it stays dark.
  expect(container.querySelector('[data-part="A"]')).toHaveAttribute("data-lit", "non");
  // Right on the left stick, down on the right one: a downward push draws downward.
  expect(container.querySelector('[data-part="LS"] .n3-stick-body')).toHaveAttribute(
    "transform",
    "translate(3.89 0.00)",
  );
  expect(container.querySelector('[data-part="RS"] .n3-stick-body')).toHaveAttribute(
    "transform",
    "translate(0.00 3.89)",
  );
});

it("an Xbox 360 room draws an Xbox 360 pad and lights A at the bottom", () => {
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  const input = new InputStream((p) => p, vi.fn(), vi.fn());
  vi.spyOn(input, "attribution").mockReturnValue("claim-1");
  vi.spyOn(input, "switchActive").mockReturnValue(true);
  const { container } = render(
    <SwitchBindings
      input={input}
      source={input.switch}
      pending={null}
      game={{ index: 0, key: "Sonic.iso", name: "Sonic", console: "x360" } as never}
      send={vi.fn()}
      close={vi.fn()}
    />,
  );
  expect(container.querySelector('[data-padmap="xbox360"]')).not.toBeNull();
  expect(container.querySelector('[data-padmap="switch-pro"]')).toBeNull();
  expect(screen.getByText("LT · gâchette gauche")).toBeInTheDocument();
  input.switch.reading = { buttons: 1 << SWITCH_BUTTONS.indexOf("A"), lx: 0, ly: 0, rx: 0, ry: 0 };
  frame?.(0);
  const a = container.querySelector('[data-padmap="xbox360"] [data-part="A"]');
  expect(a).toHaveAttribute("data-lit", "oui");
  // A est le bouton du BAS sur une Xbox: au-dessous de Y sur le dessin.
  const y = container.querySelector('[data-padmap="xbox360"] [data-part="Y"]');
  const at = (part: Element | null) => Number(part?.querySelector("circle")?.getAttribute("cy"));
  expect(at(a)).toBeGreaterThan(at(y));
});

/** Le panneau de préparation d'une salle Pro, pour un jeu de `console`. */
function prepare(console: string, qui = "claim-2") {
  const input = new InputStream((p) => p, vi.fn(), vi.fn());
  vi.spyOn(input, "attribution").mockReturnValue(qui);
  const send = vi.fn().mockResolvedValue(undefined);
  const preparation = {
    id: "launch-2",
    starter: "claim-1",
    save: 0,
    allowed: [4],
    players: [
      { claim: "claim-1", port: 1, name: "Alice", ready: false, pad: null },
      { claim: "claim-2", port: 2, name: "Benoit", ready: true, pad: 4 },
    ],
  } as Preparation;
  const game = {
    index: 0,
    name: "Un jeu",
    console,
    guide: {
      allowed: [4],
      source: "https://exemple.invalid/manuel",
      note: "Le manuel.",
      actions: {},
    },
  };
  const view = render(
    <SwitchBindings
      input={input}
      source={input.switch}
      pending={preparation}
      game={game}
      send={send}
      close={vi.fn()}
    />,
  );
  return { send, ...view };
}

it("une salle Xbox 360 parle Xbox 360, pas Switch (audit T03)", () => {
  const { container } = prepare("x360");
  const texte = container.textContent ?? "";
  expect(texte).toContain("Avant de jouer · Xbox 360");
  expect(texte).toContain("manette Xbox 360 · prêt");
  expect(screen.getByRole("heading", { name: "Mes profils Xbox 360" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Commandes du jeu" })).toBeVisible();
  expect(texte).not.toMatch(/Switch|manette Pro|Nintendo/);
});

it("le jumeau: une salle Switch garde la manette Pro", () => {
  const { container } = prepare("switch");
  const texte = container.textContent ?? "";
  expect(texte).toContain("Avant de jouer · Switch");
  expect(texte).toContain("manette Pro · prêt");
  expect(screen.getByRole("heading", { name: "Mes profils Switch" })).toBeVisible();
  expect(texte).toContain("Home, Capture et le gyroscope ne sont pas disponibles.");
});

it("le chef d'une salle Pro lance en un geste (audit P6)", () => {
  const { send } = prepare("x360", "claim-1");
  expect(screen.queryByText("Je suis prêt")).toBeNull();
  const lancer = screen.getByRole("button", { name: "Lancer le jeu" });
  expect(lancer).toBeEnabled();
  fireEvent.click(lancer);
  expect(send).toHaveBeenCalledWith({ id: "launch-2", action: "launch", pad: 4 });
});
