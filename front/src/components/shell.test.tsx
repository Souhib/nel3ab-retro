import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useShell } from "./shell";
import type { XmbCategory } from "./Xmb";

const categories: XmbCategory[] = [
  {
    id: "settings",
    label: "Réglages",
    icon: null,
    items: Array.from({ length: 14 }, (_, index) => ({
      id: String(index),
      label: String(index),
      icon: null,
    })),
  },
];

it("garde sa colonne aux bords verticaux de la grille Wii", () => {
  const { result } = renderHook(() => useShell(categories, 4, vi.fn()));
  act(() => result.current.point(2));
  act(() => result.current.act("up"));
  expect(result.current.row).toBe(2);
  act(() => result.current.act("down"));
  expect(result.current.row).toBe(6);
  act(() => result.current.act("down"));
  expect(result.current.row).toBe(10);
  act(() => result.current.act("down"));
  expect(result.current.row).toBe(10);
  act(() => result.current.point(13));
  act(() => result.current.act("down"));
  expect(result.current.row).toBe(13);
  act(() => result.current.act("up"));
  expect(result.current.row).toBe(9);
});

it("le panneau de configuration suspend aussi les raccourcis du navigateur", () => {
  const close = vi.fn();
  const { result, rerender } = renderHook(({ paused }) => useShell(categories, 1, close, paused), {
    initialProps: { paused: true },
  });
  const press = new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true });
  act(() => dispatchEvent(press));
  expect(result.current.row).toBe(0);
  expect(press.defaultPrevented).toBe(false);
  rerender({ paused: false });
  act(() => result.current.act("down"));
  expect(result.current.row).toBe(1);
  act(() => result.current.act("back"));
  expect(close).toHaveBeenCalledOnce();
});
