import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { InputStream } from "../media/input";
import { Wiring } from "./Wiring";
import { identify } from "../media/families";
import { standardProfile } from "../media/pad";
import {
  DUALSHOCK,
  GAMECUBE,
  physicalMap,
  STANDARD_PAD,
  SWITCH_PRO_PAD,
  XBOX,
} from "../lib/padmap";
import { paintWiring } from "../lib/wiring";
import { PadMapView } from "./PadMap";

it("peint deux lectures distinctes dans le vrai balisage et les efface au débranchement", () => {
  const { container } = render(
    <>
      <PadMapView map={GAMECUBE} title="Jeu" />
      <PadMapView map={DUALSHOCK} title="Main" />
    </>,
  );
  const profile = standardProfile("pad");
  profile.buttons.A = { button: 1 };
  const raw = {
    id: "pad",
    mapping: "standard",
    buttons: Array.from({ length: 17 }, (_, at) => ({
      pressed: at === 1,
      value: at === 1 ? 1 : 0,
    })),
    axes: [0, -1, 0, 0],
  } as unknown as Gamepad;
  paintWiring(container, raw, profile);
  expect(container.querySelector('[data-part="A"]')).toHaveAttribute("data-lit", "oui");
  expect(container.querySelector('[data-part="b1"]')).toHaveAttribute("data-lit", "oui");
  expect(container.querySelector('[data-part="b0"]')).toHaveAttribute("data-lit", "non");
  for (const key of ["x", "a0"]) {
    const transform = container
      .querySelector(`[data-stick="${key}"] .n3-stick-body`)
      ?.getAttribute("transform");
    expect(transform).toMatch(/^translate\(0.00 -[\d.]+\)$/);
  }
  paintWiring(container, null, profile);
  expect(container.querySelector('[data-lit="oui"]')).toBeNull();
  expect(container.querySelector('[data-stick="x"] .n3-stick-body')).toHaveAttribute(
    "transform",
    "translate(0.00 0.00)",
  );
});

it("une famille reconnue ne suffit pas sans disposition standard du navigateur", () => {
  expect(physicalMap(identify("DualSense Wireless Controller", "standard"))).toBe(DUALSHOCK);
  expect(physicalMap(identify("Xbox Wireless Controller", "standard"))).toBe(XBOX);
  expect(physicalMap(identify("DualSense Wireless Controller", ""))).toBe(STANDARD_PAD);
  expect(physicalMap(null)).toBe(STANDARD_PAD);
  // La manette Pro a son propre dessin depuis le 21 novembre 2026, et la même
  // condition : sans disposition standard, ses indices ne disent pas sa forme.
  const pro = "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)";
  expect(physicalMap(identify(pro, "standard"))).toBe(SWITCH_PRO_PAD);
  expect(physicalMap(identify(pro, ""))).toBe(STANDARD_PAD);
});

it("montre aussi le troisième port du même adaptateur, sans lire un autre modèle", () => {
  const one = {
    id: "adapter",
    index: 0,
    mapping: "",
    timestamp: 0,
    buttons: [{ value: 0, pressed: false }],
    axes: [0, 0],
  } as unknown as Gamepad;
  const third = {
    ...one,
    index: 2,
    buttons: [{ value: 0.25, pressed: true, touched: true }],
  } as Gamepad;
  let frame!: FrameRequestCallback;
  vi.stubGlobal("navigator", { getGamepads: () => [one, null, third] });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frame = fn;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const stream = new InputStream(
    (path) => path,
    () => {},
    () => {},
    true,
  );
  const state = {
    ...stream.state(),
    using: 0,
    padId: one.id,
    pads: [{ id: one.id, index: 0, buttons: 1, axes: 2 }],
    profile: null,
  };
  const { container, unmount } = render(
    <Wiring state={state} pad={0} selected="A" onSelect={() => {}} />,
  );
  try {
    frame(0);
    expect(container.querySelector('[data-part="A"]')).toHaveAttribute("data-lit", "oui");
    expect(container.querySelector('[data-part="b0"]')).toHaveAttribute("data-lit", "oui");
    Object.assign(third, { id: "other" });
    frame(1);
    expect(container.querySelector('[data-lit="oui"]')).toBeNull();
  } finally {
    unmount();
    vi.unstubAllGlobals();
  }
});

it("dessine en aplats nets : ni dégradé, ni filtre, ni reflet, ni ombre", () => {
  const { container } = render(
    <>
      {[GAMECUBE, DUALSHOCK, XBOX, STANDARD_PAD, SWITCH_PRO_PAD].map((map) => (
        <PadMapView key={map.id} map={map} title={map.name} />
      ))}
    </>,
  );
  // La précondition : cinq dessins sont bien rendus.
  expect(container.querySelectorAll("[data-padmap]")).toHaveLength(5);
  for (const volume of [
    "linearGradient",
    "radialGradient",
    "filter",
    "pattern",
    "[filter]",
    ".n3-sheen",
    ".n3-rim",
    ".n3-gloss",
    ".n3-inner",
    ".n3-dish",
    ".n3-stick-shadow",
  ]) {
    expect(container.querySelector(volume), volume).toBeNull();
  }
  // Le jumeau : la coque et ses touches sont toujours là.
  expect(container.querySelectorAll(".n3-shell")).toHaveLength(5);
  expect(container.querySelector('[data-part="A"] .n3-cap')).not.toBeNull();
});

it("pose la place de la page sur le dessin, et rien sans place", () => {
  const { container } = render(
    <>
      <PadMapView map={XBOX} title="Ta manette" place={2} />
      <PadMapView map={GAMECUBE} title="Jeu" />
    </>,
  );
  const [main, jeu] = container.querySelectorAll("[data-padmap]");
  expect(main).toHaveAttribute("data-place", "2");
  expect(jeu).not.toHaveAttribute("data-place");
});

it("Wiring passe la place de la page aux deux dessins", () => {
  const stream = new InputStream(
    () => "",
    () => {},
  );
  const state = { ...stream.state(), port: 3 };
  const { container } = render(<Wiring state={state} pad={0} selected="A" onSelect={() => {}} />);
  const dessins = container.querySelectorAll("[data-padmap]");
  expect(dessins).toHaveLength(2);
  for (const dessin of dessins) expect(dessin).toHaveAttribute("data-place", "3");
  const spectateur = render(
    <Wiring state={{ ...state, port: null }} pad={0} selected="A" onSelect={() => {}} />,
  ).container;
  expect(spectateur.querySelector("[data-place]")).toBeNull();
});

it("pose des coins en pixels sur la pièce choisie et l'attendue, sans anneau", () => {
  const { container } = render(
    <PadMapView map={GAMECUBE} title="Jeu" selected="A" waiting="B" onSelect={() => {}} />,
  );
  const coins = (part: string) =>
    container.querySelector(`[data-part="${part}"] > .n3-coins`)?.getAttribute("d") ?? "";
  // Quatre angles droits, un par coin du cadre : M, puis deux traits.
  for (const part of ["A", "B", "Z", "x"]) expect(coins(part).match(/M/g)).toHaveLength(4);
  expect(container.querySelector('[data-part="A"]')).toHaveAttribute("data-selected", "oui");
  expect(container.querySelector('[data-part="B"]')).toHaveAttribute("data-attendue", "oui");
  // Jumeau : les autres pièces ne portent ni choix ni attente.
  expect(container.querySelector('[data-part="Z"]')).not.toHaveAttribute("data-selected");
  expect(container.querySelector('[data-part="Z"]')).not.toHaveAttribute("data-attendue");
  // Plus d'anneau au feutre.
  expect(container.querySelector(".n3-wanted, .n3-selection")).toBeNull();
});

it("garde le dessin hors de la tabulation : la liste agit, le dessin montre", () => {
  const choisi = vi.fn();
  const { container } = render(<PadMapView map={GAMECUBE} title="Jeu" onSelect={choisi} />);
  const pieces = [...container.querySelectorAll<SVGGElement>("[data-part]")];
  expect(pieces.length).toBeGreaterThan(5);
  for (const piece of pieces) expect(piece.tabIndex).toBeLessThan(0);
  expect(container.querySelector('[tabindex="0"]')).toBeNull();
  // Un clic choisit toujours la pièce.
  pieces[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(choisi).toHaveBeenCalledWith(pieces[0]!.dataset["part"]);
});
