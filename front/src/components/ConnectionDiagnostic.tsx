import { useEffect, useState } from "react";
import { readMyConnection } from "../client";
import { diagnostic } from "../lib/diagnosis";
import type { Liaison } from "../media/liaison";
import type { VideoStats } from "../media/video";
import { IMAGE } from "../lib/mots";

export function ConnectionDiagnostic({
  video,
  liaison,
  salle,
  moteur = null,
  onReduce,
}: {
  video: VideoStats;
  /** L'état de la liaison, le même que celui du bandeau (`lib/diagnosis`). */
  liaison: Liaison;
  salle: number;
  moteur?: string | null;
  onReduce: () => void;
}) {
  const [route, setRoute] = useState("unknown");
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const read = async () => {
      try {
        const { data } = await readMyConnection({
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
        });
        const kind = data?.kind;
        if (active) setRoute(kind === "direct" || kind === "relay" ? kind : "unknown");
      } catch {
        if (active) setRoute("unknown");
      }
    };
    void read();
    // A route can change during a visit. Thirty seconds is a display refresh,
    // not a health deadline; this lookup never runs on the media path.
    const timer = window.setInterval(() => void read(), 30_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);
  const diagnosis = diagnostic(liaison, video, salle, moteur);
  return (
    <details id="connection-diagnostic" className="border-t border-rule pt-2 text-corps">
      <summary className="cursor-pointer">Ta connexion · {diagnosis.title.toLowerCase()}</summary>
      <div className="grid gap-2 pt-2">
        <p>{diagnosis.detail}</p>
        {video.halfDenied ? (
          <p>L’image légère n’existe pas pour la taille d’image de ce jeu.</p>
        ) : null}
        <p className="text-faint">
          {route === "direct"
            ? "Trajet direct jusqu’à la salle."
            : route === "relay"
              ? "Trajet par un relais. Cela ne suffit pas à expliquer une saccade."
              : "Trajet inconnu pour l’instant."}
        </p>
        <p className="text-faint">
          {video.half ? IMAGE.legere : IMAGE.complete} · {video.picture.width} ×{" "}
          {video.picture.height}
        </p>
        {diagnosis.reduce ? (
          <button type="button" className="n3-action" onClick={onReduce}>
            {IMAGE.passer}
          </button>
        ) : null}
      </div>
    </details>
  );
}
