/**
 * La mascotte: poser le personnage dans un hôte, et lui faire jouer une scène.
 *
 *     const lecture = jouer("arrivee", { hote, region, phrase: "Lina arrive." });
 *     await lecture.fini;
 *
 * - une scène à la fois par hôte: une nouvelle scène finit la précédente;
 * - version complète la première fois dans ce navigateur, courte ensuite
 *   (`version: "auto"`, le défaut);
 * - jamais sur l'image du jeu: un hôte qui la touche est refusé, et l'hôte
 *   coupe tout ce qui dépasse de sa boîte;
 * - en mouvement réduit, la pose clé seule, et la phrase reste;
 * - la phrase, s'il y en a une, part d'un coup dans la région d'annonce de la
 *   page. Les mots sont ceux de l'écran (`lib/mots.ts`), pas de la scène.
 *
 * Le personnage se change dans `rendu.ts`, et nulle part ailleurs.
 */
import { mouvementReduit } from "../lib/effets";
import { toucheLImage } from "../retro/image";
import type { Contexte } from "./moteur";
import { RENDU } from "./rendu";
import { estScene, version as choisirVersion, type Scene, type Version } from "./scenes";

export {
  DUREES,
  ETATS,
  EVENEMENTS,
  pourTransition,
  SCENES,
  version,
  type Etat,
  type Evenement,
  type Scene,
  type Version,
} from "./scenes";
export { joueur, RENDU, type Mouvement, type Rendu } from "./rendu";
export type { Contexte } from "./moteur";

export type Lecture = {
  scene: Scene;
  /** La version jouée, ou `null` pour une pose clé seule. */
  version: Version | null;
  /** Vrai si l'hôte touchait l'image du jeu: rien n'a été joué. */
  refusee: boolean;
  /** Résolue à la fin de la scène, ou quand elle est interrompue. */
  fini: Promise<void>;
  /** Saute à la fin de la scène. */
  interrompre(): void;
};

const enCours = new WeakMap<HTMLElement, Lecture>();

/** La classe que l'hôte reçoit: il se positionne et coupe ce qui dépasse. */
export const HOTE = "rt-mascotte-hote";

/** Le personnage de cet hôte, dessiné au premier appel. `null` sur l'image. */
export function poserMascotte(hote: HTMLElement): HTMLElement | null {
  if (toucheLImage(hote)) return null;
  hote.classList.add(HOTE);
  const deja = hote.querySelector<HTMLElement>(":scope > .rt-mascotte");
  return deja ?? RENDU.dessiner(hote);
}

const finie = (scene: Scene, refusee: boolean): Lecture => ({
  scene,
  version: null,
  refusee,
  fini: Promise.resolve(),
  interrompre: () => {},
});

/** Joue une scène dans un hôte. */
export function jouer(
  scene: Scene,
  {
    hote,
    version = "auto",
    region = null,
    phrase,
    contexte = {},
  }: {
    hote: HTMLElement;
    version?: Version | "auto";
    region?: HTMLElement | null;
    phrase?: string;
    /** Le joueur concerné (sa couleur, son START) et la variante (`mode`
     * de « prêt »). Facultatif : sans lui, la place 1 et la variante
     * simple. */
    contexte?: Contexte;
  },
): Lecture {
  if (!estScene(scene)) throw new Error(`scène inconnue: ${String(scene)}`);
  const el = poserMascotte(hote);
  if (el === null) return finie(scene, true);
  enCours.get(hote)?.interrompre();
  if (region && phrase) region.textContent = phrase;

  if (mouvementReduit() || typeof el.animate !== "function") {
    RENDU.poseCle(el, scene, contexte);
    const lecture = finie(scene, false);
    enCours.set(hote, lecture);
    return lecture;
  }

  const joue = choisirVersion(scene, version);
  const animations = RENDU.jouer(el, scene, joue, contexte);
  const fini = Promise.all(animations.map((a) => a.finished.catch(() => undefined))).then(() => {
    if (enCours.get(hote) === lecture) enCours.delete(hote);
  });
  const lecture: Lecture = {
    scene,
    version: joue,
    refusee: false,
    fini,
    interrompre() {
      for (const animation of animations) {
        try {
          animation.finish();
        } catch {
          /* une animation déjà annulée */
        }
      }
    },
  };
  enCours.set(hote, lecture);
  return lecture;
}

/** La scène qui se joue dans cet hôte, s'il y en a une. */
export const sceneEnCours = (hote: HTMLElement): Scene | null => enCours.get(hote)?.scene ?? null;
