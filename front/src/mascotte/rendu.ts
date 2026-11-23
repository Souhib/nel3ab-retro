/**
 * Le rendu de la mascotte: LE SEUL ENDROIT À REMPLACER quand le personnage
 * sera choisi (ADR D37).
 *
 * En attendant, c'est la pièce qui traversait la borne en mode démo sur la
 * page des effets: dix pixels de haut, quatre images qui la font tourner, en
 * or de la mire. Chaque scène est un petit mouvement de la pièce. Le futur
 * personnage garde le même contrat (`Rendu`): il se dessine dans un hôte,
 * sait montrer la pose clé d'une scène, et sait la jouer.
 *
 * Seuls `transform` et `opacity` s'animent, en WAAPI, sans bibliothèque. La
 * pièce ne sort jamais de son hôte, qui coupe ce qui dépasse
 * (`.rt-mascotte-hote`, `src/effets.css`): une scène ne peut pas passer sur
 * l'image voisine.
 */
import { chemin } from "../lib/logo";
import type { Scene, Version } from "./scenes";
import { DUREES } from "./scenes";

/** Ce qu'un rendu sait faire. */
export type Rendu = {
  /** Le nom du personnage, pour les essais et la planche. */
  nom: string;
  /** Dessine le personnage dans l'hôte, au repos. Rend son élément. */
  dessiner(hote: HTMLElement): HTMLElement;
  /** Montre la pose clé d'une scène, sans mouvement. */
  poseCle(el: HTMLElement, scene: Scene): void;
  /** Joue une scène. Rend ses animations, que l'appelant attend ou arrête. */
  jouer(el: HTMLElement, scene: Scene, version: Version): Animation[];
};

/** Les quatre images de la pièce qui tourne: sa largeur apparente, en pixels,
 * comme `spritePiece` de la page des effets. */
const LARGEURS = [8, 6, 2, 6] as const;

/** Les cases d'une image: le bord sombre, le coeur clair, le reflet. */
function image(largeur: number) {
  const bord: { x: number; y: number }[] = [];
  const coeur: { x: number; y: number }[] = [];
  const rx = largeur / 2;
  const ry = 4.5;
  for (let y = 0; y < 10; y += 1)
    for (let x = 0; x < 10; x += 1) {
      const dx = (x + 0.5 - 5) / rx;
      const dy = (y + 0.5 - 5) / ry;
      const d = dx * dx + dy * dy;
      if (d <= 1) (d > 0.55 ? bord : coeur).push({ x, y });
    }
  const reflet = largeur > 3 ? [3, 4, 5].map((y) => ({ x: 4, y })) : [];
  return { bord, coeur, reflet };
}

/** La pièce en SVG: quatre images superposées, une seule visible à la fois. */
export function pieceSVG(): string {
  const images = LARGEURS.map((largeur, rang) => {
    const { bord, coeur, reflet } = image(largeur);
    return (
      `<g class="rt-piece-image" data-image="${rang}">` +
      `<path style="fill:var(--rt-piece-bord)" d="${chemin(bord)}"/>` +
      `<path style="fill:var(--rt-piece-coeur)" d="${chemin(coeur)}"/>` +
      (reflet.length ? `<path style="fill:var(--rt-piece-reflet)" d="${chemin(reflet)}"/>` : "") +
      "</g>"
    );
  });
  return `<svg class="rt-piece rt-nettes" viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${images.join("")}</svg>`;
}

type Images = Keyframe[];

/** Le mouvement de chaque scène, et sa pose clé (la dernière image). */
const MOUVEMENTS: Record<
  Scene,
  { images: Images; tourne: "vite" | "lent" | "non"; cle?: Keyframe }
> = {
  arrivee: {
    images: [
      { transform: "translateY(-120%)", opacity: 0 },
      { transform: "translateY(0)", opacity: 1, offset: 0.55 },
      { transform: "translateY(-25%)", offset: 0.75 },
      { transform: "translateY(0)" },
    ],
    tourne: "vite",
  },
  depart: {
    images: [
      { transform: "translateY(0)" },
      { transform: "translateY(-30%)", offset: 0.4 },
      { transform: "translateY(0)" },
    ],
    tourne: "lent",
  },
  attente: {
    images: [
      { transform: "translateY(0)" },
      { transform: "translateY(-10%)", offset: 0.25 },
      { transform: "translateY(0)", offset: 0.5 },
      { transform: "translateY(-10%)", offset: 0.75 },
      { transform: "translateY(0)" },
    ],
    tourne: "lent",
  },
  chercher: {
    images: [
      { transform: "translateX(0)" },
      { transform: "translateX(-35%)", offset: 0.25 },
      { transform: "translateX(35%)", offset: 0.75 },
      { transform: "translateX(0)" },
    ],
    tourne: "vite",
  },
  "premiere-image": {
    images: [{ opacity: 1 }, { opacity: 0 }],
    tourne: "non",
    cle: { opacity: 0 },
  },
  rebrancher: {
    images: [
      { transform: "scale(0)" },
      { transform: "scale(1.2)", offset: 0.7 },
      { transform: "scale(1)" },
    ],
    tourne: "vite",
  },
  arret: {
    images: [{ transform: "rotate(0deg)" }, { transform: "rotate(-12deg)" }],
    tourne: "non",
    cle: { transform: "rotate(-12deg)" },
  },
  coupe: {
    images: [{ transform: "translateY(0)" }, { transform: "translateY(30%)" }],
    tourne: "non",
    cle: { transform: "translateY(30%)" },
  },
  decroche: {
    images: [
      { transform: "translateY(0) rotate(0deg)" },
      { transform: "translateY(30%) rotate(90deg)" },
    ],
    tourne: "non",
    cle: { transform: "translateY(30%) rotate(90deg)" },
  },
  redemarre: {
    images: [
      { transform: "scaleX(1)" },
      { transform: "scaleX(-1)", offset: 0.5 },
      { transform: "scaleX(1)" },
    ],
    tourne: "non",
  },
  endort: {
    images: [
      { opacity: 1, transform: "translateY(0)" },
      { opacity: 0.5, transform: "translateY(20%)" },
    ],
    tourne: "lent",
    cle: { opacity: 0.5, transform: "translateY(20%)" },
  },
  dort: {
    images: [
      { opacity: 0.5, transform: "translateY(20%) scaleY(1)" },
      { opacity: 0.5, transform: "translateY(20%) scaleY(0.92)", offset: 0.5 },
      { opacity: 0.5, transform: "translateY(20%) scaleY(1)" },
    ],
    tourne: "non",
    cle: { opacity: 0.5, transform: "translateY(20%)" },
  },
  ouvre: {
    images: [
      { opacity: 0, transform: "scale(0.4)" },
      { opacity: 1, transform: "scale(1)" },
    ],
    tourne: "vite",
  },
  range: {
    images: [{ transform: "translateY(-40%)" }, { transform: "translateY(0)" }],
    tourne: "lent",
  },
  depot: {
    images: [{ transform: "scaleY(1)" }, { transform: "scaleY(0.2) translateY(60%)", opacity: 0 }],
    tourne: "non",
    cle: { opacity: 0 },
  },
  refus: {
    images: [
      { transform: "translateX(0)" },
      { transform: "translateX(-12%)", offset: 0.2 },
      { transform: "translateX(12%)", offset: 0.4 },
      { transform: "translateX(-12%)", offset: 0.6 },
      { transform: "translateX(0)" },
    ],
    tourne: "non",
  },
  pret: {
    images: [
      { transform: "translateY(0) scale(1)" },
      { transform: "translateY(-35%) scale(1.15)", offset: 0.4 },
      { transform: "translateY(0) scale(1)" },
    ],
    tourne: "vite",
  },
  fier: {
    images: [
      { transform: "scale(1)" },
      { transform: "scale(1.25)", offset: 0.5 },
      { transform: "scale(1)" },
    ],
    tourne: "vite",
  },
  demo: {
    images: [
      { transform: "translateX(-150%)" },
      { transform: "translateX(var(--rt-demo-course, 400%))" },
    ],
    tourne: "vite",
    cle: { transform: "translateX(0)" },
  },
};

/** La pièce: le rendu provisoire. */
export const PIECE: Rendu = {
  nom: "pièce",
  dessiner(hote) {
    const el = document.createElement("span");
    el.className = "rt-mascotte";
    el.setAttribute("aria-hidden", "true");
    el.dataset.rendu = "piece";
    el.innerHTML = pieceSVG();
    hote.append(el);
    return el;
  },
  poseCle(el, scene) {
    const mouvement = MOUVEMENTS[scene];
    el.dataset.tourne = "non";
    el.dataset.scene = scene;
    const cle = mouvement.cle ?? {};
    el.style.transform = typeof cle.transform === "string" ? cle.transform : "";
    el.style.opacity = cle.opacity === undefined ? "" : String(cle.opacity);
  },
  jouer(el, scene, version) {
    const mouvement = MOUVEMENTS[scene];
    el.dataset.scene = scene;
    el.dataset.tourne = mouvement.tourne;
    el.style.transform = "";
    el.style.opacity = "";
    const duree = DUREES[scene][version];
    return [
      el.animate(mouvement.images, { duration: duree, easing: "steps(12, end)", fill: "forwards" }),
    ];
  },
};

/** Le rendu en service. Remplacer la mascotte, c'est changer cette ligne. */
export const RENDU: Rendu = PIECE;
