import { expect, it } from "vitest";
import { PlugHistory } from "./plug";
import { standardProfile } from "../media/pad";

it("retient le profil au rebranchement, sans confondre une autre manette", () => {
  const history = new PlugHistory();
  const pad = {
    padId: "Xbox controller",
    padLayout: "standard" as const,
    profile: standardProfile("Xbox controller"),
  };
  expect(history.observe({ padId: null, padLayout: null, profile: null })).toBeNull();
  const first = history.observe(pad)!;
  expect(first.title).not.toContain("reconnectée");
  expect(history.observe({ ...pad })).toBe(first);
  expect(history.observe({ padId: null, padLayout: null, profile: null })?.title).toBe(
    "Manette déconnectée",
  );
  const back = history.observe(pad)!;
  expect(back.title).toContain("reconnectée");
  expect(back.detail).toContain("profil est chargé");
  expect(history.observe({ ...pad, padId: "Another controller" })?.title).not.toContain(
    "reconnectée",
  );
});

it("un adaptateur inconnu demande une configuration jusqu'au profil enregistré", () => {
  const history = new PlugHistory();
  const pad = { padId: "USB Adapter", padLayout: "unknown" as const, profile: null };
  expect(history.observe(pad)?.configure).toBe(true);
  expect(history.observe({ ...pad, profile: standardProfile("Xbox controller") })?.configure).toBe(
    false,
  );
});
