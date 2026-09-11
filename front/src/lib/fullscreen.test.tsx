import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useBare } from "./fullscreen";
beforeEach(() => localStorage.clear());
function Probe() {
  const { bare } = useBare(false);
  return <p data-testid="bare">{String(bare)}</p>;
}
const press = (type: string, name: string, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true }));
  });
const bare = () => screen.getByTestId("bare").textContent;
it("Ctrl pressed and released alone folds and unfolds the column", () => {
  render(<Probe />);
  press("keydown", "Control");
  press("keyup", "Control");
  expect(bare()).toBe("true");
  press("keydown", "Control");
  press("keyup", "Control");
  expect(bare()).toBe("false");
});
it("F, a Ctrl combination, a click or Ctrl in a text field fold nothing", () => {
  render(<Probe />);
  // F is a game key: the default Switch keyboard profile puts R on it.
  press("keydown", "f");
  press("keyup", "f");
  expect(bare()).toBe("false");
  press("keydown", "Control");
  press("keydown", "c");
  press("keyup", "c");
  press("keyup", "Control");
  expect(bare()).toBe("false");
  press("keydown", "Control");
  act(() => {
    window.dispatchEvent(new Event("pointerdown"));
  });
  press("keyup", "Control");
  expect(bare()).toBe("false");
  const field = document.body.appendChild(document.createElement("input"));
  press("keydown", "Control", field);
  press("keyup", "Control", field);
  expect(bare()).toBe("false");
});
