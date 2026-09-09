import { MAX_BACKLOG, type VideoStats } from "../media/video";

export type Diagnosis = { title: string; detail: string; reduce: boolean };

/** Reuses the media loop's decisions. A relay alone cannot diagnose a bad link. */
export function diagnose(video: VideoStats): Diagnosis {
  if (!video.connected)
    return {
      title: "Reconnexion en cours",
      detail: "Le lien vidéo est coupé. La page réessaie automatiquement.",
      reduce: false,
    };
  if (video.awaitingRestart || video.paintedSince === 0)
    return {
      title: "Image en préparation",
      detail: "La liaison est ouverte. En attente des premières images du jeu.",
      reduce: false,
    };
  if (video.backlog >= MAX_BACKLOG)
    return {
      title: "Décodage en retard",
      detail:
        video.halfDenied || video.half
          ? "Cet appareil accumule des images à décoder. Ferme les onglets lourds."
          : "Cet appareil accumule des images à décoder. Ferme les onglets lourds ou essaie le format réduit.",
      reduce: !video.half && !video.halfDenied,
    };
  if (video.overloaded)
    return {
      title: "Réception trop irrégulière",
      detail:
        video.halfDenied || video.half
          ? "La marge vidéo ne suffit plus. Rapproche-toi du Wi-Fi ou utilise un câble."
          : "La marge vidéo ne suffit plus. Essaie le format réduit, rapproche-toi du Wi-Fi ou utilise un câble.",
      reduce: !video.half && !video.halfDenied,
    };
  return {
    title: "Aucune surcharge détectée",
    detail:
      "Ce relevé ne garantit pas l’absence de saccades. Un signalement garde les deux dernières minutes de mesures.",
    reduce: false,
  };
}
