/** Un profil de préparation appartient à la personne, comme ses touches. */
import { SETUPS_STORED, gather, push } from "./bindings";
import type { Pad } from "./saves";
import { BUTTON, standardProfile, type KeyProfile, type PadProfile } from "../media/pad";
import { readProfile } from "../media/profile";
import type { InputState } from "../media/input";

export type SetupProfile = {
  /** Jeux qui proposent ce profil. Identité indépendante de l'ordre du catalogue. */
  games?: string[];
  kind: Pad;
  device: string | null;
  standard: boolean;
  pad: PadProfile | null;
  keys: KeyProfile;
};
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export function readSetup(value: unknown): SetupProfile | null {
  if (
    !object(value) ||
    ![0, 1, 2, 3].includes(value.kind as number) ||
    !(value.device === null || typeof value.device === "string") ||
    typeof value.standard !== "boolean" ||
    (value.games !== undefined &&
      (!Array.isArray(value.games) ||
        !value.games.every((game) => typeof game === "string" && game.length > 0))) ||
    !object(value.keys)
  )
    return null;
  if (
    value.pad !== null &&
    (typeof value.device !== "string" || !readProfile(value.pad, value.device))
  )
    return null;
  if (
    !Object.values(value.keys).every(
      (a) =>
        object(a) &&
        ((a.kind === "button" && typeof a.name === "string" && Object.hasOwn(BUTTON, a.name)) ||
          (a.kind === "trigger" && (a.side === "L" || a.side === "R")) ||
          (a.kind === "stick" &&
            ["x", "y", "cx", "cy"].includes(a.stick as string) &&
            (a.sign === 1 || a.sign === -1))),
    )
  )
    return null;
  return value as SetupProfile;
}
export function setups(): Record<string, SetupProfile> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SETUPS_STORED) ?? "{}");
    if (!object(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).flatMap(([name, value]) => {
        const found = readSetup(value);
        return found ? [[name, found]] : [];
      }),
    );
  } catch {
    return {};
  }
}
export function snapshotSetup(kind: Pad, state: InputState): SetupProfile {
  return structuredClone({
    kind,
    device: state.padId,
    standard: state.padLayout === "standard",
    pad:
      state.profile ??
      (state.padId && state.padLayout === "standard" ? standardProfile(state.padId) : null),
    keys: state.keys,
  });
}
export function saveSetup(name: string, value: SetupProfile, replace = false): void {
  const wanted = name.trim();
  if (!wanted || wanted.length > 40) throw new Error("Choisis un nom de 1 à 40 caractères.");
  const existing = setups();
  if (Object.hasOwn(existing, wanted) && !replace)
    throw new Error("Ce nom existe déjà. Choisis-le pour le mettre à jour.");
  // Même plafond que le service, calculé avant l'écriture pour ne pas annoncer
  // une sauvegarde personnelle que le serveur refuserait systématiquement.
  const previous = existing[wanted];
  keepSetups({
    ...existing,
    [wanted]: { ...value, ...(previous?.games ? { games: previous.games } : {}) },
  });
}

function keepSetups(value: Record<string, SetupProfile>): void {
  const encoded = JSON.stringify(value);
  if (
    new TextEncoder().encode(JSON.stringify({ ...gather(), setups: JSON.parse(encoded) })).length >
    32768
  )
    throw new Error("Tes profils sont trop volumineux. Supprime un ancien profil.");
  localStorage.setItem(SETUPS_STORED, encoded);
  push();
}

/** Le catalogue n'expose pas encore l'identifiant du disque. Console et titre
 * distinguent les jeux sans dépendre de leur position, qui change à un ajout.
 * Deux éditions de même nom partagent donc ce choix, comme les fiches de jeu. */
export function setupGameKey(game: { console?: string; name: string }): string {
  return `${game.console ?? "?"}:${game.name.trim().toLocaleLowerCase("en-US")}`;
}

export function preferredSetup(game: string): string | null {
  return Object.entries(setups()).find(([, setup]) => setup.games?.includes(game))?.[0] ?? null;
}

export function preferSetup(game: string, name: string | null): void {
  const saved = setups();
  if (name !== null && !Object.hasOwn(saved, name)) throw new Error("Ce profil n'existe plus.");
  const next = Object.fromEntries(
    Object.entries(saved).map(([label, setup]) => {
      const games = (setup.games ?? []).filter((key) => key !== game);
      if (label === name) games.push(game);
      return [label, { ...setup, games }];
    }),
  );
  keepSetups(next);
}
export function deleteSetup(name: string): void {
  const kept = setups();
  delete kept[name];
  localStorage.setItem(SETUPS_STORED, JSON.stringify(kept));
  push();
}
