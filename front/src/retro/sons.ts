/**
 * Les petits sons de menu: un bip quand le curseur bouge, une pièce quand un
 * joueur arrive, un son grave sur une erreur.
 *
 * Fabriqués par le navigateur (WebAudio), sans fichier à télécharger. Un
 * réglage à part, coupé par défaut, qu'aucun niveau d'effets n'allume
 * (`lib/effets`, `changerSons`). Et jamais pendant que le jeu a le focus: le
 * son du jeu passe toujours avant, et un bip au milieu d'une partie se
 * prendrait pour un bruit du jeu.
 *
 * Le contexte audio est le sien, distinct de celui du jeu (`media/sound.ts`):
 * le couper ou le perdre ne touche jamais le son de la partie.
 */
import { effetActif } from "../lib/effets";
import { ZONE_JEU } from "../lib/focus-jeu";

export type SonMenu = "bip" | "piece" | "erreur" | "lettre" | "valider";

type Note = { frequence: number; duree: number; debut?: number; volume?: number };

/** Chaque son, en notes carrées comme une puce sonore 8 bits. */
export const PARTITIONS: Record<SonMenu, readonly Note[]> = {
  bip: [{ frequence: 880, duree: 0.035, volume: 0.03 }],
  lettre: [{ frequence: 1200, duree: 0.012, volume: 0.018 }],
  valider: [
    { frequence: 660, duree: 0.05 },
    { frequence: 990, duree: 0.08, debut: 0.05 },
  ],
  piece: [
    { frequence: 988, duree: 0.08 },
    { frequence: 1319, duree: 0.3, debut: 0.08 },
  ],
  erreur: [
    { frequence: 196, duree: 0.12 },
    { frequence: 147, duree: 0.22, debut: 0.12 },
  ],
};

type Fabrique = new () => AudioContext;
let contexte: AudioContext | null = null;

function fabrique(): Fabrique | null {
  const w = window as unknown as { AudioContext?: Fabrique; webkitAudioContext?: Fabrique };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Le jeu a-t-il le focus ? Alors aucun son de menu. */
export function jeuAuFocus(): boolean {
  const actif = document.activeElement;
  return actif instanceof Element && actif.closest(`[${ZONE_JEU}]`) !== null;
}

/** Prépare le contexte audio. À appeler dans un geste de la personne (un
 * clic, une touche): un navigateur refuse de faire du bruit avant. */
export function preparerSons(): void {
  if (!effetActif("sons")) return;
  try {
    const Construire = fabrique();
    if (!Construire) return;
    contexte ??= new Construire();
    if (contexte.state === "suspended") void contexte.resume();
  } catch {
    contexte = null;
  }
}

/** Joue un son de menu, s'il est permis. Rend `true` s'il a été joué. */
export function sonMenu(son: SonMenu): boolean {
  if (!effetActif("sons") || jeuAuFocus()) return false;
  if (contexte === null) preparerSons();
  const ac = contexte;
  if (ac === null || ac.state !== "running") return false;
  for (const note of PARTITIONS[son]) {
    const t0 = ac.currentTime + (note.debut ?? 0);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(note.frequence, t0);
    gain.gain.setValueAtTime(note.volume ?? 0.045, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.duree);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + note.duree + 0.02);
  }
  return true;
}

/** Pour les essais: oublie le contexte audio. */
export function oublierContexte(): void {
  contexte = null;
}
