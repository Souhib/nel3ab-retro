import { expect, it } from "vitest";
import { readProfile } from "./profile";
import { standardProfile } from "./pad";

it("accepte les anciens profils sans repos et les nouvelles courses mesurées", () => {
  const profile = standardProfile("one");
  expect(readProfile(JSON.parse(JSON.stringify(profile)), "one")).toEqual(profile);
  profile.sticks.x = { axis: 3, sign: -1, rest: 0.2 };
  profile.triggers.L = { axis: 4, rest: -1, full: 1 };
  expect(readProfile(profile, "one")).toEqual(profile);
  expect(readProfile(profile, "two")).toBeNull();
});

it.each([
  null,
  {},
  [],
  { id: "one" },
  { ...standardProfile("one"), sticks: { x: { axis: -1, sign: 1 } } },
  { ...standardProfile("one"), buttons: { A: { button: 0.5 } } },
  { ...standardProfile("one"), sticks: { x: { axis: 0, sign: 0 } } },
  { ...standardProfile("one"), triggers: { L: { axis: 0, rest: 1, full: 1 } } },
  { ...standardProfile("one"), buttons: { phantom: { button: 1 } } },
])("refuse un profil qui ferait mentir ou lever la lecture (%j)", (value) => {
  expect(readProfile(value, "one")).toBeNull();
});
