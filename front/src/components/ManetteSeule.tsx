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
import { useEffect, useRef } from "react";
import type { Rect } from "../lib/cadre";
import {
  categorieDeLatence,
  DIRE_LA_LATENCE,
  LATENCE_TENUE_MS,
  phraseDeLatence,
  type CategorieLatence,
} from "../lib/manette-seule";
import type { Annoncer } from "../lib/usePlaces";
import { MANETTE_SEULE, placeN } from "../lib/mots";
import { placeDe } from "./Cadre";
import "./telephone.css";

export function ManetteSeule({
  rect,
  jeu,
  place,
  allerRetourMs,
  entenduIlYaMs,
  annoncer = null,
}: {
  rect: Rect;
  jeu: string | null;
  /** La place de ce téléphone, `null` sans place. */
  place: number | null;
  allerRetourMs: number | null;
  entenduIlYaMs: number | null;
  /** La ligne parlée de la salle (`LigneParlee`, `nouvelle`) : elle dit le
   * changement de catégorie, une fois. `null` : rien n'est dit. */
  annoncer?: Annoncer | null;
}) {
  useDireLaLatence(categorieDeLatence({ allerRetourMs, entenduIlYaMs }), annoncer);
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
      {/* Pas de région vivante : le chiffre bouge à chaque médiane, et un
          lecteur d'écran la relisait jusqu'à une fois par seconde (relecture
          finale du 25 novembre 2026). La catégorie est dite par la ligne
          parlée (`useDireLaLatence`). */}
      <p className="n3-manette-seule-latence">
        {phraseDeLatence({ allerRetourMs, entenduIlYaMs })}
      </p>
    </section>
  );
}

/**
 * Dit à la ligne parlée le changement de catégorie de la latence, une fois
 * qu'il a tenu `LATENCE_TENUE_MS`. La première catégorie se lit sur la page
 * et n'est pas annoncée ; revenir à la dernière dite annule l'attente.
 */
function useDireLaLatence(categorie: CategorieLatence, annoncer: Annoncer | null): void {
  const dite = useRef<CategorieLatence | null>(null);
  useEffect(() => {
    if (dite.current === null) {
      dite.current = categorie;
      return;
    }
    if (categorie === dite.current || annoncer === null) return;
    const tenue = window.setTimeout(() => {
      dite.current = categorie;
      annoncer(DIRE_LA_LATENCE[categorie], "ordinaire");
    }, LATENCE_TENUE_MS);
    return () => window.clearTimeout(tenue);
  }, [categorie, annoncer]);
}

/** « manette seule » en début de phrase. */
const enPhrase = (mots: string) => mots.charAt(0).toUpperCase() + mots.slice(1);
