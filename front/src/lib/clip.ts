/**
 * Le clip des dernières secondes, demandé au worker.
 *
 * # Pourquoi le compte à rebours vient du serveur
 *
 * Le worker refuse un clip trop rapproché du précédent, et il dit combien de
 * temps il reste. La page affiche ce nombre-là plutôt qu'un décompte à elle.
 *
 * C'est la leçon du bouton « ça saccade », qui se réarmait au bout de trois
 * secondes pendant que le salon en refusait vingt: pendant dix-sept secondes le
 * bouton avait l'air de marcher et ne faisait rien. Un bouton qui promet autre
 * chose que ce que le serveur accepte est un bouton qui ment.
 */

/** Où en est la demande. */
export type ClipState =
  | { phase: "prêt" }
  /** Le worker emballe. Une trentaine de secondes de vidéo passent par ffmpeg. */
  | { phase: "en cours" }
  /** Trop tôt: voilà ce qu'il reste à patienter, en secondes. */
  | { phase: "attendre"; seconds: number }
  /** Le fichier est là. `url` est un blob, à révoquer quand on le remplace. */
  | { phase: "fait"; url: string; name: string; bytes: number }
  | { phase: "raté"; why: string };

/** Ce que le worker répond quand il refuse. */
type Refusal = { attendre?: number; pourquoi?: string };

/**
 * Demande un clip, et rend l'état qui en découle.
 *
 * `fetch` est passé plutôt que pris dans l'environnement, pour que les cas de
 * refus se testent sans worker: ce sont eux qui portent la logique, et ce sont
 * eux qu'on ne peut pas produire à la demande contre une vraie salle.
 */
export async function askForClip(
  send: typeof fetch = fetch,
  makeUrl: (blob: Blob) => string = URL.createObjectURL,
): Promise<ClipState> {
  let answer: Response;
  try {
    answer = await send("/clip", { method: "POST" });
  } catch (error) {
    return { phase: "raté", why: `la salle n'a pas répondu (${String(error)})` };
  }

  if (answer.ok) {
    const blob = await answer.blob();
    return {
      phase: "fait",
      url: makeUrl(blob),
      name: nameFrom(answer.headers.get("Content-Disposition")),
      bytes: blob.size,
    };
  }

  // Le nombre vient de l'en-tête quand il y est, du corps sinon. Deux sources
  // parce que `Retry-After` est ce qu'un client générique lit, et le corps ce
  // qu'une personne lit; elles disent la même chose et on prend la première.
  const said: Refusal = await answer.json().catch(() => ({}));
  const header = Number.parseInt(answer.headers.get("Retry-After") ?? "", 10);
  const seconds = Number.isFinite(header) ? header : (said.attendre ?? 0);
  if (answer.status === 429 && seconds > 0) {
    return { phase: "attendre", seconds };
  }
  return { phase: "raté", why: said.pourquoi ?? `la salle a répondu ${answer.status}` };
}

/** Le nom du fichier que le worker propose, ou un nom de secours.
 *
 * De secours et pas vide: un lien de téléchargement sans nom fait un fichier
 * appelé « clip » sans extension, que rien n'ouvre.
 */
export function nameFrom(disposition: string | null): string {
  const found = /filename="([^"]+)"/.exec(disposition ?? "");
  return found?.[1] ?? "nel3ab.mp4";
}

/** L'état une seconde plus tard, quand on attend.
 *
 * Rendu plutôt que muté, pour que le décompte se teste sans minuteur. La
 * dernière seconde ramène à « prêt » plutôt qu'à zéro: un bouton qui affiche
 * « 0 s » sans être cliquable est un bouton cassé.
 */
export function aSecondLater(state: ClipState): ClipState {
  if (state.phase !== "attendre") return state;
  return state.seconds <= 1 ? { phase: "prêt" } : { phase: "attendre", seconds: state.seconds - 1 };
}

/** Ce que le bouton dit, dans l'état où il est. */
export function clipLabel(state: ClipState): string {
  switch (state.phase) {
    case "en cours":
      return "on emballe…";
    case "attendre":
      return `encore ${state.seconds} s`;
    case "fait":
      return "clip prêt";
    case "raté":
      return "raté";
    default:
      return "clip des 30 s";
  }
}
