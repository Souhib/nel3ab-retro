/**
 * Les deux sauvegardes d'un jeu, du côté de la page.
 *
 * Les codes viennent de `nel3ab_emulator::saves::Slot`, qui est l'endroit où ils
 * sont définis. Ici on ne fait que les nommer pour l'écran et les retenir d'une
 * soirée à l'autre.
 */

/** Ce qu'un emplacement est, tel qu'il voyage sur le fil. */
export type Slot = 0 | 1;

export const SLOTS: readonly { id: Slot; label: string; note: string }[] = [
  { id: 0, label: "partie neuve", note: "rien de débloqué, comme à la sortie du jeu" },
  { id: 1, label: "tout débloqué", note: "personnages, circuits, coupes, modes" },
] as const;

const KEY = "nel3ab:save";

/** L'emplacement retenu, ou la partie neuve.
 *
 * Neuve par défaut, et pas l'inverse: quelqu'un qui découvre un jeu doit le
 * découvrir. Tout débloquer est un choix, pas un état où on se retrouve.
 */
export function storedSlot(): Slot {
  try {
    return localStorage.getItem(KEY) === "1" ? 1 : 0;
  } catch {
    return 0;
  }
}

export function rememberSlot(slot: Slot): void {
  try {
    localStorage.setItem(KEY, String(slot));
  } catch {
    // Navigation privée: le choix dure le temps de l'onglet.
  }
}

/** Ce qu'on affiche pour un emplacement. */
export function slotLabel(slot: Slot): string {
  return SLOTS.find((s) => s.id === slot)?.label ?? "partie neuve";
}
