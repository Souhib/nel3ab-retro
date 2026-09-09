import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { DEFAULT_KEYS } from "../media/pad";
import { KeyboardWiring } from "./KeyboardWiring";

const view = () =>
  render(<KeyboardWiring profile={DEFAULT_KEYS} pad={1} layout={null} disabled={false} />);
const key = (target: Element | Window, type: "keydown" | "keyup", code: string) => {
  const event = new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true });
  fireEvent(target, event);
  return event;
};

it("montre les flèches physiques et le stick du Nunchuk, même quand deux touches s'annulent", () => {
  const { container } = view();
  const test = screen.getByRole("button", { name: "Tester le clavier" });
  test.focus();
  expect(key(test, "keydown", "ArrowLeft").defaultPrevented).toBe(true);
  expect(container.querySelector('[data-code="ArrowLeft"]')).toHaveAttribute("data-lit", "oui");
  expect(container.querySelector('[data-part="x"]')).toHaveAttribute("data-lit", "oui");
  expect(container.querySelector('[data-part="D_LEFT"]')).toHaveAttribute("data-lit", "non");
  expect(container.querySelector('[data-stick="x"] .n3-stick-body')).toHaveAttribute(
    "transform",
    expect.stringMatching(/^translate\(-[\d.]+ 0.00\)$/),
  );
  key(test, "keydown", "ArrowRight");
  expect(container.querySelector('[data-code="ArrowRight"]')).toHaveAttribute("data-lit", "oui");
  expect(container.querySelector('[data-part="x"]')).toHaveAttribute("data-lit", "non");
  key(window, "keyup", "ArrowLeft");
  expect(container.querySelector('[data-stick="x"] .n3-stick-body')).toHaveAttribute(
    "transform",
    expect.stringMatching(/^translate\([\d.]+ 0.00\)$/),
  );
  key(window, "keyup", "ArrowRight");
  expect(container.querySelector('[data-lit="oui"]')).toBeNull();
});

it("relit une correspondance modifiée et distingue la croix du stick", () => {
  const { container, rerender } = view();
  rerender(
    <KeyboardWiring
      profile={{ ArrowLeft: { kind: "button", name: "D_LEFT" } }}
      pad={1}
      layout={null}
      disabled={false}
    />,
  );
  const test = screen.getByRole("button");
  test.focus();
  key(test, "keydown", "ArrowLeft");
  expect(container.querySelector('[data-part="D_LEFT"]')).toHaveAttribute("data-lit", "oui");
  expect(container.querySelector('[data-part="x"]')).toHaveAttribute("data-lit", "non");
  key(test, "keydown", "KeyV");
  expect(container.querySelector("output")).toHaveTextContent("V · non assignée");
  test.blur();
  expect(container.querySelector('[data-lit="oui"]')).toBeNull();
});

it("laisse les champs et les touches de sortie naviguer sans tester ni capturer", () => {
  const { container, rerender } = view();
  const test = screen.getByRole("button");
  expect(key(document.body, "keydown", "ArrowLeft").defaultPrevented).toBe(false);
  expect(container.querySelector('[data-lit="oui"]')).toBeNull();
  test.focus();
  for (const code of ["Escape", "Tab"])
    expect(key(test, "keydown", code).defaultPrevented).toBe(false);
  key(test, "keydown", "ArrowUp");
  expect(container.querySelector('[data-part="x"]')).toHaveAttribute("data-lit", "oui");
  fireEvent(window, new Event("blur"));
  expect(container.querySelector('[data-lit="oui"]')).toBeNull();
  rerender(<KeyboardWiring profile={DEFAULT_KEYS} pad={1} layout={null} disabled />);
  expect(key(test, "keydown", "ArrowLeft").defaultPrevented).toBe(false);
  expect(container.querySelector('[data-lit="oui"]')).toBeNull();
});

it("teste aussi une touche Ctrl assignée, sans réserver les raccourcis hors de cette zone", () => {
  const { container } = render(
    <KeyboardWiring
      profile={{ ControlLeft: { kind: "trigger", side: "L" } }}
      pad={1}
      layout={null}
      disabled={false}
    />,
  );
  const test = screen.getByRole("button");
  test.focus();
  fireEvent.keyDown(test, { code: "ControlLeft", ctrlKey: true });
  expect(container.querySelector('[data-part="L"]')).toHaveAttribute("data-lit", "oui");
  key(window, "keyup", "ControlLeft");
  expect(container.querySelector('[data-lit="oui"]')).toBeNull();
});
