/**
 * Le plein écran, là où il existe, et l'écran d'accueil là où il n'existe pas.
 *
 * Sur un iPhone, Safari n'offre le plein écran qu'à une vidéo: l'élément de la
 * page n'a pas de `requestFullscreen`. Le bouton de la salle l'appelait quand
 * même, et l'erreur « requestFullscreen is not a function » partait AVANT la
 * promesse, si bien que le `.catch` posé derrière ne rattrapait rien: le
 * bouton promettait un plein écran qui n'arrivait jamais (audit M8, 22 novembre
 * 2026, mesuré dans un banc qui retire l'API; non vérifié sur un vrai iPhone).
 *
 * La page demande donc d'abord ce que l'appareil permet. Sur un iPhone, ce qui
 * retire la barre de Safari est d'ouvrir la salle depuis l'écran d'accueil:
 * la page porte `apple-mobile-web-app-capable` (index.html), et une salle
 * ajoutée ainsi s'ouvre sans la barre. Un iPad porte l'API sous son nom
 * préfixé, `webkitRequestFullscreen`.
 */

/** Ce que la page peut proposer. */
export type PleinEcran =
  /** L'API existe et est permise. */
  | "api"
  /** Un appareil Apple sans l'API: l'écran d'accueil fait le même travail. */
  | "ecran-accueil"
  /** Déjà ouverte depuis l'écran d'accueil, sans l'API: rien à proposer. */
  | "deja"
  /** Ni l'un ni l'autre: ne rien promettre. */
  | "aucun";

/** Ce qu'on lit de l'appareil, séparé de la décision pour qu'elle s'essaie. */
export type Appareil = { api: boolean; installe: boolean; apple: boolean };

export function pleinEcranPossible({ api, installe, apple }: Appareil): PleinEcran {
  // L'API d'abord: une page ouverte depuis l'écran d'accueil d'un Android
  // garde ses barres du système, et l'API les retire encore. « deja » ne vaut
  // que là où il n'y a rien d'autre à proposer (relecture du 22 novembre 2026).
  if (api) return "api";
  if (installe) return "deja";
  if (apple) return "ecran-accueil";
  return "aucun";
}

type Prefixe = {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type ElementPrefixe = {
  requestFullscreen?: () => Promise<void>;
  webkitRequestFullscreen?: () => void;
};

/** Ce que ce navigateur permet, lu sans rien appeler. */
export function lireAppareil(
  doc: Document = document,
  nav: Navigator = navigator,
  media: (query: string) => MediaQueryList = (query) => window.matchMedia(query),
): Appareil {
  const d = doc as Document & Prefixe;
  const el = doc.documentElement as unknown as ElementPrefixe;
  const api =
    (d.fullscreenEnabled === true && typeof el.requestFullscreen === "function") ||
    (d.webkitFullscreenEnabled === true && typeof el.webkitRequestFullscreen === "function");
  let installe = (nav as Navigator & { standalone?: boolean }).standalone === true;
  try {
    installe ||=
      media("(display-mode: standalone)").matches || media("(display-mode: fullscreen)").matches;
  } catch {
    /* un navigateur sans `matchMedia` n'a pas d'écran d'accueil non plus */
  }
  // Un iPad se dit Macintosh depuis iPadOS 13: on le reconnaît à son écran
  // tactile, qu'aucun Mac n'a.
  const apple =
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  return { api, installe, apple };
}

/** Vrai quand la page est en plein écran, sous l'un ou l'autre nom. */
export function enPleinEcran(doc: Document = document): boolean {
  const d = doc as Document & Prefixe;
  return (d.fullscreenElement ?? d.webkitFullscreenElement ?? null) !== null;
}

/**
 * Entrer ou sortir, sans jamais lever d'erreur.
 *
 * Rend ce qui s'est passé plutôt que de le jeter: « impossible » quand l'API
 * n'existe pas, « refuse » quand le navigateur dit non (hors d'un geste, dans
 * un cadre), y compris quand le refus part avant toute promesse.
 */
export async function basculerPleinEcran(
  doc: Document = document,
): Promise<"entre" | "sorti" | "refuse" | "impossible"> {
  const d = doc as Document & Prefixe;
  if (enPleinEcran(doc)) {
    try {
      if (typeof d.exitFullscreen === "function") await d.exitFullscreen();
      else if (typeof d.webkitExitFullscreen === "function") d.webkitExitFullscreen();
      else return "impossible";
      return "sorti";
    } catch {
      return "refuse";
    }
  }
  const el = doc.documentElement as unknown as ElementPrefixe;
  const entrer =
    typeof el.requestFullscreen === "function"
      ? () => el.requestFullscreen?.()
      : typeof el.webkitRequestFullscreen === "function"
        ? () => el.webkitRequestFullscreen?.()
        : null;
  if (entrer === null) return "impossible";
  try {
    await entrer();
    return "entre";
  } catch {
    return "refuse";
  }
}
