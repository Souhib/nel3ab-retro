import { expect, it } from "vitest";
import { manetteAConfigurer, PlugHistory } from "./plug";
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

/**
 * Une manette qui attend sa configuration le dit aussi dans le menu.
 *
 * L'avis de branchement s'efface au bout de cinq secondes (choix du
 * 7 septembre 2026). Passé ce délai, rien ne rappelait qu'un adaptateur
 * attendait ses correspondances (audit P12, relecture du 22 novembre 2026):
 * l'entrée « touches et manettes » le dit avec la même règle que l'avis.
 */
it("dit qu'une manette sans disposition standard ni profil attend sa configuration", () => {
  const adaptateur = { padId: "GameCube adapter", padLayout: "unknown" as const, profile: null };
  expect(manetteAConfigurer(adaptateur)).toBe(true);
  expect(new PlugHistory().observe(adaptateur)?.configure).toBe(true);
});

it("le jumeau: ni une manette standard, ni une manette déjà configurée, ni l'absence de manette", () => {
  expect(manetteAConfigurer({ padId: "Xbox", padLayout: "standard", profile: null })).toBe(false);
  expect(
    manetteAConfigurer({
      padId: "GameCube adapter",
      padLayout: "unknown",
      profile: standardProfile("GameCube adapter"),
    }),
  ).toBe(false);
  expect(manetteAConfigurer({ padId: null, padLayout: null, profile: null })).toBe(false);
});
