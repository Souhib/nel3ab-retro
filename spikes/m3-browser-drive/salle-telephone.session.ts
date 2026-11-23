/**
 * Une fausse liaison entre React et la boucle média, pour `salle-telephone.mjs`.
 *
 * La vraie `Session` est construite, mais le pilote coupe toutes ses sockets :
 * rien ne part vers une salle. Son instantané est corrigé pour dire « une image
 * est peinte », pour voir la salle EN PARTIE sans émulateur ni flux. Reprise du
 * banc de l'audit mobile du 22 novembre 2026.
 *
 * Paramètres de l'adresse : `pw` et `ph` (taille de l'image), `son` (l'état du
 * contexte audio annoncé, « running » par défaut), `liaison` (« ok » par défaut,
 * « irreguliere » pour la proposition de format réduit, « injoignable » pour
 * le rideau d'une arrivée qui n'aboutit pas).
 *
 * Ce fichier ne prouve rien sur la boucle média elle-même : il remplace ce
 * qu'elle dirait par ce qu'on veut voir.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Session, exposeForTests, type Snapshot } from "../../front/src/media/session";

const q = new URLSearchParams(location.search);
const W = Number(q.get("pw") ?? 640);
const H = Number(q.get("ph") ?? 480);

function patch(s: Snapshot): Snapshot {
  const etat = q.get("liaison") ?? "ok";
  return {
    ...s,
    liaison: (etat === "irreguliere"
      ? { etat: "irreguliere" }
      : etat === "injoignable"
        ? { etat: "injoignable", site: null, arrivee: true, depuisMs: 30000 }
        : { etat: "ok" }) as Snapshot["liaison"],
    video: {
      ...s.video,
      connected: true,
      paintedSince: 5000,
      dark: false,
      awaitingRestart: false,
      picture: { width: W, height: H },
    },
    sound: { ...s.sound, state: q.get("son") ?? "running" },
    input: {
      ...s.input,
      // `place=aucune` : la page d'un spectateur (étape 4 du chantier salle).
      port: q.get("place") === "aucune" ? null : 1,
      watching: q.get("place") === "aucune",
      players: 4,
      busy: [true, true, false, false],
      mics: [false, false, false, false],
    },
  };
}

function draw(canvas: HTMLCanvasElement) {
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ink = canvas.getContext("2d");
  if (!ink) return;
  const sky = ink.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#3b6fb6");
  sky.addColorStop(0.6, "#8fc1e8");
  sky.addColorStop(0.61, "#4c9a3c");
  sky.addColorStop(1, "#2c5e22");
  ink.fillStyle = sky;
  ink.fillRect(0, 0, W, H);
  ink.fillStyle = "#ffd400";
  ink.font = `bold ${Math.round(H / 18)}px sans-serif`;
  ink.fillText("VIES x3", W * 0.03, H * 0.08);
  ink.fillText("SCORE 012345", W * 0.62, H * 0.08);
  ink.fillStyle = "#e23b3b";
  ink.fillRect(W * 0.46, H * 0.62, W * 0.08, H * 0.16);
}

export function useSession(
  volume: number,
  deviceRate: boolean,
  onSeat: (port: number | null, claim: string | null) => void,
  watching: boolean,
  padOnly: boolean,
): { ref: React.RefObject<HTMLCanvasElement | null>; session: Session | null } {
  const ref = useRef<HTMLCanvasElement>(null);
  const [session, setSession] = useState<Session | null>(null);
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
      padOnly,
    );
    made.start();
    const real = made.getSnapshot;
    let lastIn: Snapshot | null = null;
    let lastOut: Snapshot | null = null;
    (made as unknown as { getSnapshot: () => Snapshot }).getSnapshot = () => {
      const s = real();
      if (s !== lastIn) {
        lastIn = s;
        lastOut = patch(s);
      }
      return lastOut as Snapshot;
    };
    exposeForTests(made);
    setSession(made);
    draw(canvas);
    const painter = window.setInterval(() => draw(canvas), 400);
    return () => {
      window.clearInterval(painter);
      made.stop();
      setSession(null);
    };
    // oxlint-disable-next-line exhaustive-deps
  }, [padOnly]);

  return { ref, session };
}

export function useSnapshot(session: Session | null): Snapshot | null {
  return useSyncExternalStore(
    (listener) => session?.subscribe(listener) ?? (() => {}),
    () => session?.getSnapshot() ?? null,
  );
}
