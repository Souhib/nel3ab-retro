/** Le stockage et le service apportent du JSON, pas un PadProfile vérifié.
 * Une forme invalide ne doit jamais lever dans la boucle d'entrée. Les anciens
 * profils sans repos restent valides, avec leur repos implicite à zéro. */
import { BUTTON, type Control, type PadProfile, type StickAxis } from "./pad";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const index = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const between = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;

function control(value: unknown): value is Control {
  if (!record(value)) return false;
  if ("button" in value) {
    return (
      !("axis" in value) &&
      index(value.button) &&
      (value.rest === undefined || between(value.rest, 0, 1))
    );
  }
  return (
    index(value.axis) &&
    between(value.rest, -1, 1) &&
    between(value.full, -1, 1) &&
    value.full !== value.rest
  );
}

function stick(value: unknown): value is StickAxis {
  return (
    record(value) &&
    index(value.axis) &&
    (value.sign === 1 || value.sign === -1) &&
    (value.rest === undefined || between(value.rest, -1, 1))
  );
}

export function readProfile(value: unknown, id: string): PadProfile | null {
  if (
    !record(value) ||
    value.id !== id ||
    !record(value.buttons) ||
    !record(value.triggers) ||
    !record(value.sticks)
  )
    return null;
  if (
    !Object.entries(value.buttons).every(
      ([key, entry]) => Object.hasOwn(BUTTON, key) && control(entry),
    ) ||
    !Object.entries(value.triggers).every(
      ([key, entry]) => (key === "L" || key === "R") && control(entry),
    ) ||
    !Object.entries(value.sticks).every(
      ([key, entry]) => ["x", "y", "cx", "cy"].includes(key) && stick(entry),
    )
  )
    return null;
  return value as PadProfile;
}
