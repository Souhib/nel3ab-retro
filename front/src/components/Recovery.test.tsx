import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Recovery } from "./Recovery";
import type { RecoveryNotice } from "../lib/room";
import type { MenuAction } from "../media/menupad";

const notice: RecoveryNotice = {
  id: "one",
  port: null,
  from: "Souhib",
  to: "Lu",
  asking: true,
  remaining: 20,
  reason: null,
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("attend le délai et une confirmation : le silence seul ne prend rien", async () => {
  const action = vi.fn().mockResolvedValue(undefined);
  render(<Recovery notice={notice} error="" onAction={action} onClose={() => {}} />);
  const confirm = screen.getByRole("button", { name: "reprendre maintenant" });
  expect(confirm).toBeDisabled();
  act(() => vi.advanceTimersByTime(19_750));
  expect(confirm).toBeDisabled();
  act(() => vi.advanceTimersByTime(250));
  expect(confirm).toBeEnabled();
  expect(action).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(confirm));
  expect(action).toHaveBeenCalledWith({ action: "finish", id: "one", ok: undefined });
});

it("le destinataire garde le rôle, et ne peut pas confirmer la reprise", async () => {
  const action = vi.fn().mockResolvedValue(undefined);
  render(
    <Recovery
      notice={{ ...notice, asking: false }}
      error=""
      onAction={action}
      onClose={() => {}}
    />,
  );
  expect(screen.queryByRole("button", { name: "reprendre maintenant" })).toBeNull();
  expect(screen.getByText(/Souhib demande le rôle de chef/)).toBeVisible();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "je suis là, garder" })),
  );
  expect(action).toHaveBeenCalledWith({ action: "answer", id: "one", ok: false });
});

it("un accord permet de reprendre tout de suite la manette nommée", () => {
  const { rerender } = render(
    <Recovery notice={{ ...notice, port: 2 }} error="" onAction={vi.fn()} onClose={() => {}} />,
  );
  expect(screen.getByText("Reprendre la manette 2")).toBeVisible();
  expect(screen.getByRole("button", { name: "reprendre maintenant" })).toBeDisabled();
  rerender(
    <Recovery
      notice={{ ...notice, port: 2, remaining: 0 }}
      error=""
      onAction={vi.fn()}
      onClose={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "reprendre maintenant" })).toBeEnabled();
});

it("une demande terminée et une coupure ne laissent aucun bouton de reprise", () => {
  const { rerender } = render(
    <Recovery
      notice={{ ...notice, reason: "Lu est là." }}
      error=""
      onAction={vi.fn()}
      onClose={() => {}}
    />,
  );
  expect(screen.getByText("Lu est là.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "reprendre maintenant" })).toBeNull();
  rerender(
    <Recovery
      notice={null}
      error="Le salon ne répond pas."
      onAction={vi.fn()}
      onClose={() => {}}
    />,
  );
  expect(screen.getByText("Le salon ne répond pas.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "reprendre maintenant" })).toBeNull();
});

it("la manette répond « je suis là », et ne peut jamais céder la place", async () => {
  const action = vi.fn().mockResolvedValue(undefined);
  const recus: ((a: MenuAction) => void)[] = [];
  render(
    <Recovery
      notice={{ ...notice, asking: false }}
      error=""
      onAction={action}
      onClose={() => {}}
      pad={(h) => {
        if (h) recus.push(h);
      }}
    />,
  );
  expect(recus.length).toBeGreaterThan(0);
  await act(async () => recus.at(-1)!("confirm"));
  expect(action).toHaveBeenCalledWith({ action: "answer", id: "one", ok: false });
  // Le jumeau négatif, et c'est le coeur de la règle: aucune autre touche ne
  // décide à la place de personne, et AUCUNE ne donne la place à quelqu'un
  // d'autre. Une pression sur la manette qu'on tient déjà se fait sans regarder.
  action.mockClear();
  await act(async () => {
    for (const geste of ["left", "right", "up", "down", "back"] as MenuAction[]) {
      recus.at(-1)!(geste);
    }
  });
  expect(action).not.toHaveBeenCalled();
});

it("la manette ne confirme pas une reprise avant la fin du délai", async () => {
  const action = vi.fn().mockResolvedValue(undefined);
  const recus: ((a: MenuAction) => void)[] = [];
  render(
    <Recovery
      notice={notice}
      error=""
      onAction={action}
      onClose={() => {}}
      pad={(h) => {
        if (h) recus.push(h);
      }}
    />,
  );
  await act(async () => recus.at(-1)!("confirm"));
  expect(action).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(20_000));
  await act(async () => recus.at(-1)!("confirm"));
  expect(action).toHaveBeenCalledWith({ action: "finish", id: "one" });
});
