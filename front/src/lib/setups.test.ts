import { beforeEach, expect, it } from "vitest";
import {
  deleteSetup,
  readSetup,
  saveSetup,
  setups,
  preferSetup,
  preferredSetup,
  setupGameKey,
  type SetupProfile,
} from "./setups";
import { reconcile, gather } from "./bindings";
const profile: SetupProfile = {
  kind: 1,
  device: null,
  standard: false,
  pad: null,
  keys: { KeyA: { kind: "button", name: "A" } },
};
beforeEach(() => localStorage.clear());
it("enregistre, recharge et supprime un profil personnel complet", () => {
  saveSetup("Kart", profile);
  expect(setups().Kart).toEqual(profile);
  expect(gather().setups).toEqual({ Kart: profile });
  expect(() => saveSetup("Kart", { ...profile, kind: 0 })).toThrow(/existe/);
  saveSetup("Kart", { ...profile, kind: 0 }, true);
  expect(setups().Kart.kind).toBe(0);
  deleteSetup("Kart");
  expect(setups()).toEqual({});
});
it("une personne ne reçoit pas les profils de la précédente", async () => {
  await reconcile("one", { pads: {}, keys: {} });
  saveSetup("Kart", profile);
  await reconcile("two", { pads: {}, keys: {}, setups: {} });
  expect(setups()).toEqual({});
});
it("refuse un profil tronqué ou des commandes de clavier invalides", () => {
  expect(readSetup(profile)).toEqual(profile);
  for (const invalid of [
    null,
    {},
    { ...profile, kind: 4 },
    { ...profile, keys: { KeyA: null } },
    { ...profile, keys: { KeyA: { kind: "button", name: "UNKNOWN" } } },
    { ...profile, pad: {} },
    { ...profile, games: [3] },
  ])
    expect(readSetup(invalid)).toBeNull();
  expect(() => saveSetup(" ", profile)).toThrow();
});

it("retient un choix par jeu, partagé entre appareils et isolé par personne", async () => {
  await reconcile("one", { pads: {}, keys: {}, setups: {} });
  saveSetup("Kart", profile);
  saveSetup("Autre", { ...profile, kind: 0 });
  const kart = setupGameKey({ console: "wii", name: "Mario Kart Wii" });
  const other = setupGameKey({ console: "gc", name: "Mario Kart Wii" });
  preferSetup(kart, "Kart");
  expect(preferredSetup(kart)).toBe("Kart");
  expect(preferredSetup(other)).toBeNull();
  const remote = structuredClone(gather());
  localStorage.clear();
  await reconcile("one", remote);
  expect(preferredSetup(kart)).toBe("Kart");
  preferSetup(kart, "Autre");
  expect(setups().Kart.games).toEqual([]);
  saveSetup("Autre", profile, true);
  expect(preferredSetup(kart)).toBe("Autre");
  preferSetup(kart, null);
  expect(preferredSetup(kart)).toBeNull();
  preferSetup(kart, "Kart");
  deleteSetup("Kart");
  expect(preferredSetup(kart)).toBeNull();
  expect(() => preferSetup(kart, "Absent")).toThrow();
  preferSetup(kart, "Autre");
  await reconcile("two", { pads: {}, keys: {}, setups: {} });
  expect(preferredSetup(kart)).toBeNull();
});
