import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControllerStatus } from "./ControllerStatus";

const connected = { padId: "Wireless Controller", padLayout: "standard" as const, profile: null };
const unplugged = { padId: null, padLayout: null, profile: null };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("disparaît sans clic malgré les relevés répétés et ne revient pas en fermant le menu", () => {
  const props = { state: connected, visible: true, onConfigure: vi.fn() };
  const { rerender } = render(<ControllerStatus {...props} />);
  expect(screen.getByRole("status")).toHaveTextContent("connectée");
  for (let tick = 0; tick < 9; tick++) {
    act(() => vi.advanceTimersByTime(500));
    rerender(<ControllerStatus {...props} state={{ ...connected }} />);
  }
  expect(screen.getByRole("status")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(500));
  expect(screen.queryByRole("status")).toBeNull();
  rerender(<ControllerStatus {...props} visible={false} />);
  rerender(<ControllerStatus {...props} state={{ ...connected }} />);
  expect(screen.queryByRole("status")).toBeNull();
});

it("laisse un nouveau délai au débranchement puis au retour de la manette", () => {
  const props = { state: connected, visible: true, onConfigure: vi.fn() };
  const { rerender } = render(<ControllerStatus {...props} />);
  act(() => vi.advanceTimersByTime(4000));
  rerender(<ControllerStatus {...props} state={unplugged} />);
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole("status")).toHaveTextContent("déconnectée");
  act(() => vi.advanceTimersByTime(4000));
  expect(screen.queryByRole("status")).toBeNull();
  rerender(<ControllerStatus {...props} />);
  expect(screen.getByRole("status")).toHaveTextContent("reconnectée");
  fireEvent.click(screen.getByLabelText("Masquer le message de branchement"));
  rerender(<ControllerStatus {...props} state={{ ...connected }} />);
  expect(screen.queryByRole("status")).toBeNull();
});
