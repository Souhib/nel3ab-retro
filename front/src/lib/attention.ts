/**
 * La boucle d'attention de l'écran éteint.
 *
 * Bobine respirait sans fin sur l'écran d'une salle au repos : une animation
 * qui ne s'arrête jamais finit par ne plus rien dire, et coûte des images à
 * la machine pendant qu'on lit la colonne. La mascotte joue maintenant la
 * scène « attente » une première fois après 2,5 s, puis toutes les 6 s, trois
 * fois au plus, et plus du tout dès le premier geste (pointeur ou touche) ou
 * quand l'onglet se cache.
 *
 * L'ordonnanceur est séparé du dessin : il appelle `jouer`, et c'est tout.
 * En mouvement réduit, la mascotte montre sa pose clé (socle) : la boucle
 * n'a rien à savoir de plus.
 */

export const ATTENTION = { premiere: 2500, intervalle: 6000, fois: 3 } as const;

/** Les instants des appels, en millisecondes après l'entrée. */
export function instantsDAttention(): number[] {
  return Array.from(
    { length: ATTENTION.fois },
    (_, i) => ATTENTION.premiere + i * ATTENTION.intervalle,
  );
}

const GESTES = ["pointerdown", "keydown"] as const;

/**
 * Lance la boucle. Rend la fonction qui l'arrête (à appeler au démontage).
 *
 * `cible` reçoit les gestes (la fenêtre, d'ordinaire) ; `doc` dit si l'onglet
 * est caché.
 */
export function demarrerAttention(o: {
  jouer: () => void;
  cible: EventTarget;
  doc: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
}): () => void {
  const minuteurs: ReturnType<typeof setTimeout>[] = [];
  let arretee = false;
  const arreter = () => {
    if (arretee) return;
    arretee = true;
    for (const minuteur of minuteurs) clearTimeout(minuteur);
    for (const geste of GESTES) o.cible.removeEventListener(geste, arreter);
    o.doc.removeEventListener("visibilitychange", surVisibilite);
  };
  const surVisibilite = () => {
    if (o.doc.hidden) arreter();
  };
  if (o.doc.hidden) {
    arretee = true;
    return () => {};
  }
  for (const geste of GESTES) o.cible.addEventListener(geste, arreter);
  o.doc.addEventListener("visibilitychange", surVisibilite);
  for (const instant of instantsDAttention()) {
    minuteurs.push(
      setTimeout(() => {
        if (!arretee) o.jouer();
      }, instant),
    );
  }
  return arreter;
}
