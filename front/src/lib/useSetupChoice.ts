import { useEffect, useState } from "react";
import type { Preparation } from "../client";
import { storedPad, type Pad } from "./saves";

/** Le brouillon personnel suit l'appareil réel jusqu'au début de la préparation.
 * Ensuite, les annonces des autres joueurs ne doivent pas effacer son choix. */
export function useSetupChoice(pad: Pad, pending: Preparation | null) {
  const [choice, setChoice] = useState<Pad>(storedPad);
  useEffect(() => {
    if (pending)
      setChoice((held) => (pending.allowed.includes(held) ? held : (pending.allowed[0] as Pad)));
    else setChoice(pad);
  }, [pad, pending]);
  return [choice, setChoice] as const;
}
