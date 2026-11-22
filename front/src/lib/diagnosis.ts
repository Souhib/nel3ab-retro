import { MAX_BACKLOG, type VideoStats } from "../media/video";
import type { Liaison } from "../media/liaison";
import { dire, NOM_ETAT } from "./liaison-mots";
import { SHORT_RATE } from "./vitals";

export type Diagnosis = { title: string; detail: string; reduce: boolean };

/** Ce que seule la colonne sait de la vidéo: la file de décodage, l'allure de
 * réception et un écran plus lent que le jeu. Un relais seul ne prouve pas un
 * mauvais lien. */
export function diagnose(video: VideoStats): Diagnosis {
  // La coupure et le gel ne se décident plus ici: c'est l'état de la liaison
  // (`diagnostic`, plus bas). Ce résumé gardait sa propre règle du gel depuis
  // le 21 novembre 2026, et la colonne pouvait contredire le bandeau.
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
          : "Cet appareil accumule des images à décoder. Ferme les onglets lourds ou essaie l'image légère.",
      reduce: !video.half && !video.halfDenied,
    };
  if (video.overloaded)
    return {
      title: "Réception trop irrégulière",
      detail:
        video.halfDenied || video.half
          ? "La marge vidéo ne suffit plus. Rapproche-toi du Wi-Fi ou utilise un câble."
          : "La marge vidéo ne suffit plus. Essaie l'image légère, rapproche-toi du Wi-Fi ou utilise un câble.",
      reduce: !video.half && !video.halfDenied,
    };
  // Après la réception: une liaison qui rame explique plus qu'un écran lent.
  // Le constat, pas la cause: le 25 septembre 2026, un ordinateur fixe est passé
  // de 110 à 21 Hz sans qu'on sache pourquoi. Pas de format réduit non plus: la
  // page recevait déjà tout.
  if (video.refreshHz > 0 && video.sourceHz > 0 && video.refreshHz < SHORT_RATE * video.sourceHz) {
    const shown = Math.round(video.refreshHz);
    const sent = Math.round(video.sourceHz);
    return {
      title: "Affichage plus lent que le jeu",
      detail: `Ton navigateur n’affiche que ${shown} images par seconde, et le jeu en envoie ${sent} : les autres sont sautées à l’affichage.`,
      reduce: false,
    };
  }
  return {
    title: "Aucune surcharge détectée",
    detail:
      "Ce relevé ne garantit pas l’absence de saccades. Un signalement garde les deux dernières minutes de mesures.",
    reduce: false,
  };
}

/** Ce que la colonne dit de la connexion.
 *
 * L'état de la liaison vient de `media/liaison`, la seule machine à états de la
 * page, et se dit avec les mots du bandeau (`dire`): la colonne et l'image ne
 * peuvent plus se contredire, par exemple pendant la reprise qui suit un gel,
 * où le bandeau dit encore « image figée » (vérification finale du
 * 22 novembre 2026). En marche, onglet caché ou image irrégulière, la colonne
 * ajoute ce que la liaison ne sait pas (`diagnose`). */
export function diagnostic(
  liaison: Liaison,
  video: VideoStats,
  salle: number,
  moteur: string | null = null,
): Diagnosis {
  if (liaison.etat === "ok" || liaison.etat === "cachee" || liaison.etat === "irreguliere")
    return diagnose(video);
  const dit = dire(liaison, salle, moteur);
  const detail = [dit.titre, dit.detail].filter((texte) => texte !== undefined && texte !== "");
  return {
    title: NOM_ETAT[liaison.etat],
    detail: detail.length > 0 ? detail.join(" ") : "En attente des premières images du jeu.",
    reduce: false,
  };
}
