/**
 * Le son démarre au premier geste, et redémarre après chaque coupure.
 *
 * Un navigateur ne joue rien avant qu'on le lui ait demandé, et la demande doit
 * venir d'un geste de la personne. N'importe quel geste fait l'affaire: le
 * premier appui sur la manette à l'écran en est un. Sur un téléphone, la
 * colonne et son bouton « activer le son » ne sont pas sous les yeux, donc
 * c'est ce réveil qui donne le son (signalé le 18 août 2026).
 *
 * # Pourquoi l'écoute ne se retire plus
 *
 * Jusqu'au 22 novembre 2026, l'écoute se retirait dès que le contexte jouait.
 * Sur iOS, un appel ou un détour par une autre application coupe le contexte
 * (état « interrupted » ou « suspended »), et plus aucun geste ne le relançait:
 * la partie continuait sans son, et rien ne le disait sur la manette Xbox 360
 * (audit M10, déduit du code; l'effet d'un appel réel n'est pas vérifié sur
 * un appareil). L'écoute reste donc posée, et ne fait rien tant que le son
 * joue: un appel à `running()` par geste.
 *
 * Au retour sur la page, une REPRISE sans déblocage est tentée: hors d'un
 * geste, iOS refuserait le média muet de `start`, et le diagnostic noterait un
 * refus qui n'en est pas un. Android et un ordinateur reprennent souvent là;
 * sinon, le geste suivant s'en charge.
 *
 * Dans la couche média et pas dans un composant: ce qui touche au son vit
 * ici (règle 8 de CLAUDE.md), et la page ne fait qu'armer et défaire.
 */

/** Les événements qu'un navigateur compte comme une activation. */
export const GESTES_DU_SON = ["pointerup", "touchend", "click", "keydown"] as const;

/** Ce que le réveil demande au son: savoir s'il joue, le démarrer pendant un
 * geste, le reprendre hors d'un geste. */
export type SonReveillable = {
  running(): boolean;
  start(): Promise<void>;
  reprendre(): void;
};

/** Pose l'écoute, et rend de quoi la retirer. */
export function armerReveilDuSon(
  son: SonReveillable,
  fenetre: EventTarget = window,
  doc: Document = document,
): () => void {
  const geste = () => {
    if (son.running()) return;
    void son.start().catch(() => {
      // Refusé: le geste suivant réessaie, puisque l'écoute reste.
    });
  };
  const retour = () => {
    if (doc.visibilityState === "visible" && !son.running()) son.reprendre();
  };
  for (const kind of GESTES_DU_SON) fenetre.addEventListener(kind, geste, { passive: true });
  doc.addEventListener("visibilitychange", retour);
  return () => {
    for (const kind of GESTES_DU_SON) fenetre.removeEventListener(kind, geste);
    doc.removeEventListener("visibilitychange", retour);
  };
}
