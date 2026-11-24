/**
 * La boucle d'attention de l'accueil, à zéro salle (plan salon, scène
 * « attente », 24 novembre 2026).
 *
 * Quand rien ne tourne, Aïn lève les yeux vers « Ouvrir une salle » : la
 * scène « attente » à 2,5 s, puis toutes les 6 s, trois tours au plus. Au
 * quatrième pas, il s'endort (« dort », dans sa variante du salon) et la
 * boucle s'arrête. Rien ne tourne entre deux tours : un minuteur, pas une
 * animation.
 *
 * - Un tour sauté compte : onglet caché, la scène ne joue pas, mais le tour
 *   est passé. Revenir sur l'onglet ne rattrape rien.
 * - Un geste l'arrête pour de bon : un clic, une touche, la molette, un
 *   doigt. Passer la souris sur la page n'en est pas un : la boucle invite
 *   justement qui regarde sans rien faire.
 * - En mouvement réduit, elle n'est jamais armée.
 *
 * Écrite ici plutôt qu'en JavaScript dans `accueil.html` pour être essayée
 * sous une horloge simulée (`attention.test.ts`) ; l'accueil l'appelle par
 * `nel3abSalon.surAttention`.
 */
import { mouvementReduit } from "../lib/effets";

export const ATTENTION = {
  /** Le premier tour, en millisecondes. */
  premier: 2500,
  /** Entre deux tours. */
  pas: 6000,
  /** Les tours d'« attente », avant « dort ». */
  tours: 3,
} as const;

/** Ce qui arrête la boucle : un geste vers la page, pas un survol. */
const GESTES = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

export type SceneAttention = "attente" | "dort";

/** Arme la boucle ; rend de quoi l'arrêter. */
export function surAttention(
  jouer: (scene: SceneAttention) => void,
  {
    cachee = () => document.visibilityState !== "visible",
    reduit = mouvementReduit,
  }: { cachee?: () => boolean; reduit?: () => boolean } = {},
): () => void {
  if (reduit()) return () => {};
  let tours = 0;
  let minuteur = 0;
  let arretee = false;
  const arreter = () => {
    if (arretee) return;
    arretee = true;
    window.clearTimeout(minuteur);
    for (const nom of GESTES) document.removeEventListener(nom, arreter, true);
  };
  const tour = () => {
    tours += 1;
    const scene: SceneAttention = tours > ATTENTION.tours ? "dort" : "attente";
    if (!cachee()) jouer(scene);
    if (scene === "dort") arreter();
    else minuteur = window.setTimeout(tour, ATTENTION.pas);
  };
  for (const nom of GESTES) document.addEventListener(nom, arreter, true);
  minuteur = window.setTimeout(tour, ATTENTION.premier);
  return arreter;
}
