import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { InputStream } from "../media/input";
import { Wiring } from "./Wiring";
import { identify } from "../media/families";
import { standardProfile } from "../media/pad";
import { DUALSHOCK, GAMECUBE, physicalMap, STANDARD_PAD, XBOX } from "../lib/padmap";
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
