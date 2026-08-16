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
  onSeat: (port: number | null) => void,
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
    const made = new Session(canvas, (port) => seat.current(port), volume, deviceRate);
    made.start();
    exposeForTests(made);
    setSession(made);
    return () => {
      made.stop();
      setSession(null);
    };
    // Once, deliberately. Volume and sample rate are applied THROUGH the session
    // by their own effects, never by building a second one.
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
