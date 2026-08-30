/**
 * Le bouton du clip, et son compte à rebours.
 *
 * La décision est ailleurs, dans `clip.ts`, qui est pur et testé. Ce fichier ne
 * fait que la brancher à React: un état, un minuteur d'une seconde, et le soin
 * de rendre l'ancien blob quand un nouveau clip arrive.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { aSecondLater, askForClip, type ClipState } from "./clip";

export function useClip(): { state: ClipState; ask: () => void; forget: () => void } {
  const [state, setState] = useState<ClipState>({ phase: "prêt" });
  // Le blob en cours, pour le révoquer quand on le remplace. Sans ça, chaque
  // clip laisse une trentaine de mégaoctets dans l'onglet jusqu'à sa fermeture.
  const held = useRef<string | null>(null);

  const forget = useCallback(() => {
    if (held.current) URL.revokeObjectURL(held.current);
    held.current = null;
    setState({ phase: "prêt" });
  }, []);

  const ask = useCallback(() => {
    setState((now) => {
      // Un deuxième clic pendant l'emballage ne relance rien. Le serveur
      // refuserait de toute façon; ne pas partir évite d'afficher un refus qui
      // ne serait que le nôtre.
      if (now.phase === "en cours" || now.phase === "attendre") return now;
      void askForClip().then((next) => {
        if (next.phase === "fait") {
          if (held.current) URL.revokeObjectURL(held.current);
          held.current = next.url;
        }
        setState(next);
      });
      return { phase: "en cours" };
    });
  }, []);

  useEffect(() => {
    if (state.phase !== "attendre") return undefined;
    const tick = window.setInterval(() => setState(aSecondLater), 1000);
    return () => window.clearInterval(tick);
  }, [state.phase]);

  // Et à la fermeture de la salle, pour ne pas laisser un blob derrière.
  useEffect(
    () => () => {
      if (held.current) URL.revokeObjectURL(held.current);
    },
    [],
  );

  return { state, ask, forget };
}
