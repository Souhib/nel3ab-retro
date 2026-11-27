/**
 * The bridge between React and the media loop, and the only two places they
 * touch.
 *
 * The session owns the canvas, the decode, the paint and the pad loops, all of
 * which run on `requestAnimationFrame` and socket events. React hands it a
 * canvas on mount and takes it back on unmount, and reads a snapshot twice a
 * second in between. Nothing here renders on a frame (ADR D12).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Session, exposeForTests, type Snapshot } from "../media/session";

export function useSession(
  volume: number,
  deviceRate: boolean,
  onSeat: (port: number | null, claim: string | null) => void,
  /** Vrai quand la personne a choisi de regarder. Lu une seule fois, à la
   * construction: changer d'avis ensuite passe par la session elle-même. */
  watching: boolean,
): { ref: React.RefObject<HTMLCanvasElement | null>; session: Session | null } {
  const ref = useRef<HTMLCanvasElement>(null);
  const [session, setSession] = useState<Session | null>(null);
  // The seat callback is rebuilt on every render of the page that owns it, and
  // the session must not be rebuilt with it: rebuilding closes the video socket
  // and the picture goes black. Reading it through a ref at the moment a seat
  // changes calls the current one without depending on it.
  const seat = useRef(onSeat);
  seat.current = onSeat;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const made = new Session(
      canvas,
      (port, claim) => seat.current(port, claim),
      volume,
      deviceRate,
      watching,
    );
    made.start();
    exposeForTests(made);
    setSession(made);
    return () => {
      made.stop();
      setSession(null);
    };
    // Aucune dépendance, délibérément : une session par page. Le volume et la
    // fréquence s'appliquent À TRAVERS la session par leurs propres effets,
    // jamais en en construisant une seconde. Le 26 novembre 2026, la seule
    // reconstruction qui restait (« manette seule », retirée depuis) laissait
    // l'ancienne session rouvrir son image et son son (`session-fin.test.ts`).
    // oxlint-disable-next-line exhaustive-deps
  }, []);

  return { ref, session };
}

/** The numbers, at reading speed rather than at frame rate. */
export function useSnapshot(session: Session | null): Snapshot | null {
  return useSyncExternalStore(
    (listener) => session?.subscribe(listener) ?? (() => {}),
    () => session?.getSnapshot() ?? null,
  );
}
