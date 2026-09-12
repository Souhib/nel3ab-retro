/**
 * Les deux sauvegardes d'un jeu, du côté de la page.
 *
 * Les codes viennent de `nel3ab_emulator::saves::Slot`, qui est l'endroit où ils
 * sont définis. Ici on ne fait que les nommer pour l'écran.
 *
 * Rien n'est retenu d'une soirée à l'autre, et c'est voulu. Le choix se fait au
 * lancement, sur le jeu qu'on lance, donc un souvenir ne ferait que décider en
 * silence à la place de quelqu'un qui a le panneau sous les yeux. Le curseur
 * part sur « partie neuve »: quelqu'un qui découvre un jeu doit le découvrir, et
 * tout débloquer est un choix plutôt qu'un état où on se retrouve.
 */

/** Ce qu'un emplacement est, tel qu'il voyage sur le fil. */
export type Slot = 0 | 1 | 2;

export const SLOTS: readonly { id: Slot; label: string; note: string }[] = [
  { id: 0, label: "partie neuve", note: "rien de débloqué, comme à la sortie du jeu" },
  { id: 1, label: "tout débloqué", note: "personnages, circuits, coupes, modes" },
  { id: 2, label: "ta sauvegarde", note: "la tienne, dans cette salle comme dans une autre" },
] as const;

/** L'emplacement personnel, qui n'existe que si le salon sait qui tu es.
 *
 * Le worker ne peut pas nommer un dossier d'après quelqu'un qu'il ne connaît
 * pas: l'identité vient du salon, qui la tient du proxy. Proposer cette ligne
 * sans lui ferait cliquer sur un choix qui retombe en silence sur la partie
 * neuve, ce qui est exactement le repli muet que ce projet corrige partout. */
export const PERSONAL: Slot = 2;

/** Les appareils qu'un jeu Wii peut présenter, un choix par place.
 *
 * Une seule à la fois, jamais les deux: elles lisent le même tuyau, et un jeu
 * qui voit les deux compte deux manettes pour une personne. À deux joueurs, le
 * premier occupe deux places et le second n'entre jamais.
 */
export type Pad = 0 | 1 | 2 | 3;

export const PADS: readonly { id: Pad; label: string; note: string }[] = [
  {
    id: 0,
    label: "manette GameCube",
    note: "pour les jeux Wii qui l'acceptent, comme Mario Kart",
  },
  {
    id: 1,
    label: "Wiimote et Nunchuk",
    note: "pour les jeux qui n'acceptent qu'elle. Les sticks font le mouvement.",
  },
  {
    id: 2,
    label: "guitare",
    note: "pour Guitar Hero. Cinq frettes sur les boutons, le grattage sur la croix.",
  },
  { id: 3, label: "Wiimote seule", note: "Sans accessoire, notamment pour Mario Party 8 et 9." },
] as const;

/** Le dernier appareil connu sert d'aperçu avant de recevoir la place.
 * Le worker annonce ensuite l'appareil réellement branché sur cette place.
 * Depuis la préparation collective (ADR D17), ce cache ne décide plus à lui
 * seul de la configuration d'un lancement Wii. */
const PAD_KEY = "nel3ab:pad";

export function storedPad(): Pad {
  try {
    // Relu par la table plutôt que comparé à une chaîne: la version d'avant
    // testait `=== "1"`, donc l'arrivée d'un troisième choix aurait ramené
    // silencieusement tout le monde à la manette GameCube.
    const found = Number(localStorage.getItem(PAD_KEY));
    return PADS.find((one) => one.id === found)?.id ?? 0;
  } catch {
    return 0;
  }
}

export function rememberPad(pad: Pad): void {
  try {
    localStorage.setItem(PAD_KEY, String(pad));
  } catch {
    // Navigation privée: le choix vaut le temps de l'onglet.
  }
}

/** Ce qu'on affiche pour une manette. */
export function padLabel(pad: Pad): string {
  return PADS.find((one) => one.id === pad)?.label ?? "manette GameCube";
}

/** Ce que le panneau de lancement propose, et ce qu'un choix veut dire.
 *
 * # Pourquoi ce n'est pas écrit dans `App.tsx`
 *
 * Ça l'a été, et ça a caché un défaut pendant deux jours. Le panneau croisait
 * les deux emplacements avec les deux manettes, ce qui donnait quatre entrées
 * numérotées « 0-0 » à « 1-1 ». Quand la manette a déménagé dans les réglages,
 * le lecteur de choix est passé à `id === "1"`, qui ne peut être vrai pour
 * AUCUNE de ces quatre entrées. Tout jeu Wii démarrait donc sur « partie
 * neuve », y compris quand on demandait « tout débloqué ». Rien n'échouait: le
 * jeu se lançait, simplement pas celui qu'on avait demandé.
 *
 * Les deux moitiés vivent ici ensemble pour qu'elles ne puissent plus diverger,
 * et un essai les compare l'une à l'autre plutôt qu'à une liste écrite à la
 * main, qui serait la même erreur recopiée.
 */
export function launchPicks(personal = false): { id: string; label: string; hint: string }[] {
  return SLOTS.filter((choice) => personal || choice.id !== PERSONAL).map((choice) => ({
    id: String(choice.id),
    label: choice.label,
    hint: choice.note,
  }));
}

/** L'emplacement qu'un identifiant de `launchPicks` désigne, ou rien. */
export function slotFromPick(id: string): Slot | null {
  return SLOTS.find((choice) => String(choice.id) === id)?.id ?? null;
}

/** Ce qu'on affiche pour un emplacement. */
export function slotLabel(slot: Slot): string {
  return SLOTS.find((s) => s.id === slot)?.label ?? "partie neuve";
}
