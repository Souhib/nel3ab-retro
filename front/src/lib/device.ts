/**
 * L'appareil d'une personne, dit une fois, à l'arrivée dans la salle.
 *
 * # Pourquoi
 *
 * Devant « ça saccade chez moi », la première question est toujours la même:
 * sur quoi ? Un téléphone à quatre cœurs en 4G et un ordinateur fixe sur la fibre
 * ne se lisent pas pareil, et il a fallu le demander à chaque fois.
 *
 * # Pourquoi à l'arrivée seulement
 *
 * L'appareil ne change pas pendant une visite. L'écrire sur chaque relevé
 * coûterait deux cents octets toutes les dix secondes pour répéter la même
 * chose. Le salon l'écrit sur la ligne `arrivée`, que la visite relie à tous
 * les relevés qui suivent.
 *
 * # Ce qui n'y est pas
 *
 * Rien qui désigne la personne plutôt que sa machine: ni adresse, ni langue, ni
 * fuseau. Le proxy dit déjà qui elle est.
 */

/** Combien de caractères de l'identifiant du navigateur on garde.
 *
 * Cent soixante. Chrome sur Android en écrit environ 140. La borne du salon pour
 * l'appareil entier est de 512 octets (`DEVICE_MAX`). */
export const AGENT_MAX = 160;

/** Ce que la page dit de son appareil. */
export type Device = {
  /** L'écran entier et la fenêtre, en pixels CSS, et la densité de l'écran. */
  écran: string;
  fenêtre: string;
  densité: number;
  /** Cœurs logiques et mémoire en Gio, telle que le navigateur l'arrondit. Nulle
   * sur Firefox et Safari, qui ne la donnent pas. */
  cœurs: number;
  mémoire: number | null;
  /** Nombre de points de contact: zéro sur un ordinateur sans écran tactile. */
  tactile: number;
  /** Le débit estimé par Chrome, en classes « 2g » à « 4g ». Ce n'est pas le
   * type de liaison: une fibre et une bonne 4G disent toutes deux « 4g ». Nul
   * quand le navigateur ne le donne pas. */
  réseau: string | null;
  navigateur: string;
};

/** Ce qu'on lit du navigateur, séparé pour que les essais n'aient pas à en fabriquer un. */
export type DeviceSource = {
  navigator: {
    hardwareConcurrency?: number;
    maxTouchPoints?: number;
    userAgent: string;
    deviceMemory?: number;
    connection?: { effectiveType?: string };
  };
  screen: { width: number; height: number };
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
};

/** L'appareil, lu une fois. */
export function device(source: DeviceSource): Device {
  const { navigator: nav, screen } = source;
  return {
    écran: `${screen.width}x${screen.height}`,
    fenêtre: `${source.innerWidth}x${source.innerHeight}`,
    densité: Math.round(source.devicePixelRatio * 100) / 100,
    cœurs: nav.hardwareConcurrency ?? 0,
    mémoire: nav.deviceMemory ?? null,
    tactile: nav.maxTouchPoints ?? 0,
    réseau: nav.connection?.effectiveType ?? null,
    navigateur: nav.userAgent.slice(0, AGENT_MAX),
  };
}
