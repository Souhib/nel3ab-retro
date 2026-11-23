/**
 * Ce qu'une page « manette seule » montre entre sa barre et ses touches.
 *
 * Jusqu'au 23 novembre 2026, un calque posé sur la toile disait « MANETTE
 * SEULE » en capitales espacées, une phrase sur le décodage et un
 * aller-retour en millisecondes. Il ne disait ni à qui était la manette, ni
 * si les touches arrivaient. Il dit maintenant :
 *
 * - le jeu, sous « Manette seule » ;
 * - la place que ce téléphone tient, ou qu'il n'en tient aucune ;
 * - si les touches arrivent, seulement quand la salle a répondu depuis moins
 *   de deux secondes (`lib/manette-seule`) : rien n'est affirmé sans mesure.
 *
 * La toile reste montée ailleurs, réduite à rien : elle appartient à la
 * boucle média, qui la tient par une référence (ADR D13).
 */
import type { Rect } from "../lib/cadre";
import { phraseDeLatence } from "../lib/manette-seule";
import { MANETTE_SEULE, placeN } from "../lib/mots";
import { placeDe } from "./Cadre";
import "./telephone.css";

export function ManetteSeule({
  rect,
  jeu,
  place,
  allerRetourMs,
  entenduIlYaMs,
}: {
  rect: Rect;
  jeu: string | null;
  /** La place de ce téléphone, `null` sans place. */
  place: number | null;
  allerRetourMs: number | null;
  entenduIlYaMs: number | null;
}) {
  return (
    <section id="padOnlyNotice" className="n3-manette-seule" style={placeDe(rect)}>
      <h1 className="n3-manette-seule-titre">
        {jeu ? `${enPhrase(MANETTE_SEULE)}, ${jeu}` : enPhrase(MANETTE_SEULE)}
      </h1>
      <p className="n3-manette-seule-place">
        {place === null
          ? "Ce téléphone ne tient pas de place."
          : `Ce téléphone est ta manette, ${placeN(place)}.`}
      </p>
      <p className="n3-manette-seule-latence" aria-live="polite">
        {phraseDeLatence({ allerRetourMs, entenduIlYaMs })}
      </p>
    </section>
  );
}

/** « manette seule » en début de phrase. */
const enPhrase = (mots: string) => mots.charAt(0).toUpperCase() + mots.slice(1);
