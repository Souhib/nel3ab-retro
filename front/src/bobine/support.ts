/**
 * Ce que la console avale: un disque, une cartouche ou une carte.
 *
 * Bobine ne fait pas le même geste pour les trois: il essuie un disque, il
 * souffle dans une cartouche, il tient une carte du bout des doigts. Le support
 * vient du manifeste des consoles (`consoles/consoles.json`, champ `media`),
 * comme tout ce qui décrit une console. Un code absent du manifeste (« ? »,
 * une console à venir) prend la cartouche, le support des consoles rétro.
 */
import manifest from "../../../consoles/consoles.json";

export type Support = "disque" | "cartouche" | "carte";

const NOMS: Record<string, Support> = {
  disc: "disque",
  cartridge: "cartouche",
  card: "carte",
};

export function supportDe(console: string | null | undefined): Support {
  const media = manifest.consoles.find((one) => one.code === console)?.media;
  return (media === undefined ? undefined : NOMS[media]) ?? "cartouche";
}
