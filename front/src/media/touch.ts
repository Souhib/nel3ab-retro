/**
 * La manette à l'écran, pour jouer depuis un téléphone.
 *
 * # Pourquoi ça tient en si peu de code
 *
 * La décision D3 normalise les manettes DANS LE NAVIGATEUR: le worker ne reçoit
 * qu'une trame de boutons et d'axes, et ne sait pas d'où elle vient. Une manette
 * tactile est donc une troisième source à côté du clavier et des manettes
 * physiques, fondue avec elles par la même fonction, et rien en dessous ne
 * change.
 *
 * Ça fait passer une soirée de quatre personnes ÉQUIPÉES à quatre personnes.
 *
 * # Hors de React, comme le reste du chemin des commandes
 *
 * La boucle d'entrée tourne cent fois par seconde. Un état React relu à cette
 * cadence rendrait la page à chaque appui, et la règle du projet est que React
 * ne touche pas au chemin des images ni à celui des commandes. Les événements de
 * pointeur écrivent donc ici, et la boucle lit ici.
 */
import { BUTTON, type PadReading } from "./pad";

/**
 * Où le pouce a poussé le stick, ramené dans le disque unité.
 *
 * Pure, donc éprouvable sans écran. Deux choses qu'elle fait et qu'un simple
 * rapport ne ferait pas:
 *
 * - une ZONE MORTE au centre. Un pouce posé n'est jamais parfaitement immobile,
 *   et sans elle un personnage dérive doucement pendant qu'on ne touche à rien;
 * - un plafond CIRCULAIRE et non carré. Poussé en diagonale, un rapport brut
 *   donnerait 1,41 fois la course, donc un personnage plus rapide en diagonale
 *   qu'en ligne droite. C'est le défaut classique des manettes tactiles.
 *
 * `y` est retourné parce qu'un écran compte vers le bas et une manette vers le
 * haut.
 */
export function stickFrom(
  centre: { x: number; y: number },
  point: { x: number; y: number },
  radius: number,
  dead = 0.15,
): { x: number; y: number } {
  const span = Math.max(1, radius);
  const dx = (point.x - centre.x) / span;
  const dy = (point.y - centre.y) / span;
  const reach = Math.hypot(dx, dy);
  if (reach < dead) return { x: 0, y: 0 };
  // Ce qui dépasse le bord est ramené AU bord, en gardant la direction.
  const scale = Math.min(1, reach) / reach;
  // `0 - v` et non `-v`: la seconde forme rend un zéro NÉGATIF quand `v` vaut
  // zéro, et `-0` traverse ensuite le JSON, les comparaisons et les tests en
  // ressemblant à zéro sans en être. Une valeur publique n'a pas à porter cette
  // curiosité.
  return { x: dx * scale, y: 0 - dy * scale };
}

/**
 * Ce que les doigts tiennent en ce moment.
 *
 * Un objet mutable et pas un état React, pour la raison dite plus haut. Il est
 * lu une fois par tour de boucle et écrit par les événements de pointeur.
 */
export class Touch {
  private buttons = 0;
  private stick = { x: 0, y: 0 };
  /** Vrai dès qu'un doigt a touché quelque chose. Sert à la page pour savoir
   * si cette manette sert vraiment, plutôt qu'à deviner d'après l'appareil. */
  private used = false;

  press(button: keyof typeof BUTTON): void {
    this.buttons |= BUTTON[button];
    this.used = true;
  }

  release(button: keyof typeof BUTTON): void {
    this.buttons &= ~BUTTON[button];
  }

  /** Le stick, en coordonnées de manette. */
  push(x: number, y: number): void {
    this.stick = { x, y };
    if (x !== 0 || y !== 0) this.used = true;
  }

  /** Tout lâcher.
   *
   * Appelé quand la page passe en arrière-plan ou qu'un pointeur est annulé. Un
   * bouton resté enfoncé parce qu'un appel est arrivé pendant qu'on tenait A
   * ferait courir le personnage jusqu'à ce que quelqu'un s'en aperçoive.
   */
  releaseAll(): void {
    this.buttons = 0;
    this.stick = { x: 0, y: 0 };
  }

  /** Vrai si un doigt a servi de cette manette depuis l'ouverture. */
  inUse(): boolean {
    return this.used;
  }

  /**
   * Ce qu'il faut fondre avec le clavier et les manettes, ou rien.
   *
   * Rien quand aucun doigt ne touche: une manette tactile au repos qui rendrait
   * des zéros écraserait le stick d'une vraie manette tenue en même temps, et le
   * mélange des sources est justement ce qui permet de jouer à deux appareils.
   */
  reading(): PadReading | null {
    if (this.buttons === 0 && this.stick.x === 0 && this.stick.y === 0) return null;
    return {
      buttons: this.buttons,
      x: this.stick.x,
      y: this.stick.y,
      cx: 0,
      cy: 0,
      // Les gâchettes sont tout ou rien au doigt: une glissière analogique sur
      // un écran demande une précision que personne n'a en jouant.
      l: (this.buttons & BUTTON.L) === 0 ? 0 : 1,
      r: (this.buttons & BUTTON.R) === 0 ? 0 : 1,
    };
  }
}

/**
 * Les tailles du groupe des quatre boutons, pour qu'il tienne dans la bande.
 *
 * Le calcul compte TOUT ce qui occupe la largeur: deux colonnes ordinaires, une
 * colonne large pour A, les deux espaces, et la marge des deux bords. Un premier
 * jet oubliait le supplément de A et le groupe dépassait de deux pixels sur
 * l'image — deux pixels qu'aucun oeil n'aurait vus et que le pilote a nommés.
 *
 * Pure, donc éprouvable sans écran.
 */
/** Le groupe de quatre boutons: ce qu'il mesure, et ce qui le dimensionne. */
export type Cluster = {
  /** Les variables CSS qui donnent leur taille aux touches. */
  style: Record<string, string>;
  /** Ce que le groupe mesure une fois posé, en pixels.
   *
   * Rendu plutôt que redit ailleurs, et c'est tout l'objet de ce type. La
   * version d'avant calculait la taille des touches ici et ancrait le groupe
   * là-bas contre une constante de 132 pixels. Les deux ont fini par ne plus
   * dire la même chose: mesuré le 30 août 2026 sur un écran 4:3, le groupe
   * faisait 148 pixels et l'ancrage en supposait 132, donc il partait huit
   * pixels trop à gauche et mordait sur l'image. Le pilote l'a vu, l'œil non.
   *
   * C'est la deuxième fois que cette paire diverge. La première, le 18 août,
   * l'ancrage avait oublié que le bouton A est plus large que les autres. */
  width: number;
};

export function clusterKeys(bar: number): Cluster {
  /** L'espace entre deux touches, deux fois, comme la grille le pose. */
  const GAPS = 8;
  /** De combien le bouton A dépasse les autres. */
  const BIGGER = 8;
  /** Ce qu'on laisse au bord pour que le groupe ne touche rien. */
  const MARGIN = 12;
  const key = Math.max(30, Math.min(52, Math.floor((bar - GAPS - BIGGER - MARGIN) / 3)));
  return {
    style: {
      ["--n3-key" as string]: `${key}px`,
      ["--n3-key-big" as string]: `${key + BIGGER}px`,
    },
    // Trois colonnes: une touche, le gros bouton, une touche, et les deux
    // espaces entre elles.
    width: key * 3 + BIGGER + GAPS,
  };
}
