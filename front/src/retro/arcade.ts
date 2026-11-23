/**
 * Les gestes d'arcade: les trois initiales, APPUIE SUR START, et le mode démo.
 */
import { effetActif, mouvementReduit } from "../lib/effets";

/**
 * « initiales »: trois lettres, comme au tableau des scores. Sans accent, en
 * capitales, les lettres seulement: « Élodie » donne « ELO », « Jean-Pierre »
 * « JEA ». Un nom plus court garde sa longueur; un nom sans lettre donne
 * « --- ». Deux joueurs peuvent avoir les mêmes trois lettres: le nom entier
 * reste dans la liste des joueurs.
 */
export function initiales(nom: string): string {
  const lettres = nom
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}]/gu, "")
    .toUpperCase();
  return lettres.length === 0 ? "---" : lettres.slice(0, 3);
}

/** Ce qui reçoit déjà Entrée: un champ, un bouton, un lien. Entrée y garde
 * son sens. */
const ATTRAPE_ENTREE =
  "input, textarea, select, button, a[href], [contenteditable], [role='button']";

/** Le bouton Start d'une manette standard (`Gamepad.buttons[9]`). */
export const BOUTON_START = 9;

/**
 * « start »: la touche Entrée et le bouton Start d'une manette branchée font
 * le geste principal de l'écran (ouvrir une salle, au salon). Seulement quand
 * l'effet est allumé, et Entrée seulement là où elle ne fait rien d'autre.
 * Rend la fonction qui arrête d'écouter.
 */
export function surStart(rappel: () => void): () => void {
  const touche = (evenement: KeyboardEvent) => {
    if (evenement.key !== "Enter" || evenement.repeat || !effetActif("start")) return;
    const cible = evenement.target;
    if (cible instanceof Element && cible.closest(ATTRAPE_ENTREE)) return;
    rappel();
  };
  document.addEventListener("keydown", touche);

  let image = 0;
  let enfonce = false;
  const lire = () => {
    image = window.requestAnimationFrame(lire);
    if (!effetActif("start") || document.visibilityState !== "visible") return;
    const manettes = navigator.getGamepads?.() ?? [];
    const presse = [...manettes].some((m) => m?.buttons[BOUTON_START]?.pressed === true);
    if (presse && !enfonce) rappel();
    enfonce = presse;
  };
  // Lire les manettes seulement quand une est branchée: une boucle d'image
  // sans manette tournerait pour rien sur la page la plus ouverte.
  const branchee = () => {
    if (image === 0) image = window.requestAnimationFrame(lire);
  };
  window.addEventListener("gamepadconnected", branchee);
  if ([...(navigator.getGamepads?.() ?? [])].some(Boolean)) branchee();

  return () => {
    document.removeEventListener("keydown", touche);
    window.removeEventListener("gamepadconnected", branchee);
    if (image !== 0) window.cancelAnimationFrame(image);
    image = 0;
  };
}

/** Les gestes qui arrêtent le mode démo. */
const GESTES = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

/**
 * « demo »: si personne ne touche à la surface pendant `ms`, `lancer` est
 * appelé (la surface reçoit `data-demo`); le premier geste appelle `arreter`
 * et retire l'attribut. Rien sans l'effet, ni en mouvement réduit: une page
 * qui bouge toute seule est exactement ce que ce réglage refuse. La boucle
 * s'arrête aussi quand la page est cachée. Rend la fonction qui arrête tout.
 */
export function surInactivite(
  surface: HTMLElement,
  ms: number,
  { lancer = () => {}, arreter = () => {} }: { lancer?: () => void; arreter?: () => void } = {},
): () => void {
  let minuterie = 0;
  let enDemo = false;
  const sortir = () => {
    if (enDemo) {
      enDemo = false;
      surface.removeAttribute("data-demo");
      arreter();
    }
  };
  const armer = () => {
    window.clearTimeout(minuterie);
    minuterie = window.setTimeout(() => {
      if (!effetActif("demo") || mouvementReduit() || document.visibilityState !== "visible")
        return;
      enDemo = true;
      surface.setAttribute("data-demo", "");
      lancer();
    }, ms);
  };
  const geste = () => {
    sortir();
    armer();
  };
  for (const nom of GESTES) document.addEventListener(nom, geste, { passive: true });
  const visibilite = () => {
    if (document.visibilityState !== "visible") sortir();
  };
  document.addEventListener("visibilitychange", visibilite);
  armer();
  return () => {
    window.clearTimeout(minuterie);
    for (const nom of GESTES) document.removeEventListener(nom, geste);
    document.removeEventListener("visibilitychange", visibilite);
    sortir();
  };
}
