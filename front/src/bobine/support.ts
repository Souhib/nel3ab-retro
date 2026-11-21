/**
 * Ce que la console avale: un disque, une cartouche ou une carte.
 *
 * Bobine ne fait pas le même geste pour les trois: il essuie un disque, il
 * souffle dans une cartouche, il tient une carte du bout des doigts. Le code de
 * console vient du catalogue de la salle; un code inconnu prend la cartouche,
 * le support des consoles rétro qui arriveront ensuite.
 */
export type Support = "disque" | "cartouche" | "carte";

const SUPPORTS: Record<string, Support> = {
  gc: "disque",
  wii: "disque",
  x360: "disque",
  switch: "carte",
  switch2: "carte",
};

export function supportDe(console: string | null | undefined): Support {
  if (!console) return "cartouche";
  return SUPPORTS[console] ?? "cartouche";
}
