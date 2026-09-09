import { useEffect, useState } from "react";
import { readMyConnection } from "../client";
import { diagnose } from "../lib/diagnosis";
import type { VideoStats } from "../media/video";

export function ConnectionDiagnostic({
  video,
  onReduce,
}: {
  video: VideoStats;
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
  const diagnosis = diagnose(video);
  return (
    <details id="connection-diagnostic" className="border-t border-rule pt-2 text-xs">
      <summary className="cursor-pointer">Ta connexion · {diagnosis.title.toLowerCase()}</summary>
      <div className="grid gap-2 pt-2">
        <p>{diagnosis.detail}</p>
        {video.halfDenied ? (
          <p>Le format réduit est indisponible pour la taille d’image de ce jeu.</p>
        ) : null}
        <p className="text-faint">
          {route === "direct"
            ? "Trajet Tailscale direct."
            : route === "relay"
              ? "Trajet via un relais Tailscale. Cela ne suffit pas à expliquer une saccade."
              : "Trajet Tailscale non disponible."}
        </p>
        <p className="text-faint">
          Format {video.half ? "réduit" : "plein"} · {video.picture.width} × {video.picture.height}
        </p>
        {diagnosis.reduce ? (
          <button type="button" className="n3-action" onClick={onReduce}>
            Essayer le format réduit
          </button>
        ) : null}
      </div>
    </details>
  );
}
