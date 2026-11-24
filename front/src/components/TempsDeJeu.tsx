/**
 * Le temps de jeu, au bout du panneau de commande (effet « chiffres »,
 * roulé par « compteur » ; 23 novembre 2026, chantier salle, étape 7).
 *
 * Il ne s'affiche qu'avec l'instant de lancement que la salle annonce
 * (`depuisS`, tiré de `Room.partie.depuis_s` par `useLancement`, ADR D43).
 * Sans lui, il ne rend rien : un temps compté depuis l'arrivée de la page,
 * présenté comme temps de jeu, mentirait à qui arrive en cours de partie.
 *
 * L'afficheur du socle (`retro/chiffres`) écrit ses chiffres hors de React,
 * une fois par seconde : la salle ne se redessine pas pour une horloge.
 */
import { useEffect, useRef, useState } from "react";
import type { PartieVue } from "../client";
import { ecrireChiffres, poserAfficheur } from "../retro/chiffres";
import { TEMPS } from "../lib/mots";

/** L'écart sous lequel une nouvelle estimation garde l'ancienne, en
 * secondes. Le salon tronque l'âge à la seconde (`int(age)`) et le message
 * met quelques centaines de millisecondes à venir : deux envois de la même
 * partie diffèrent d'une seconde au plus. Un nouveau jeu redémarre le worker,
 * donc son âge repart de zéro, loin de l'ancien. */
export const ECART_DE_LANCEMENT_S = 2;

/** L'instant de lancement, en secondes Unix de l'horloge de CETTE page.
 *
 * Le salon publie un âge (`depuis_s`, « depuis combien de secondes »), pas
 * une heure : l'horloge d'un téléphone n'a pas à s'accorder avec celle de la
 * machine. L'âge se change en instant au moment où le message arrive. Une
 * estimation à moins de `ECART_DE_LANCEMENT_S` de la précédente la garde :
 * sinon l'afficheur repartirait à chaque envoi du salon. */
export function instantDeLancement(
  precedent: number | null,
  ageS: number | null | undefined,
  recuA: number,
): number | null {
  if (ageS === null || ageS === undefined || !(ageS >= 0)) return null;
  const estime = recuA - ageS;
  return precedent !== null && Math.abs(estime - precedent) < ECART_DE_LANCEMENT_S
    ? precedent
    : estime;
}

/** L'instant de lancement du jeu en cours, ou `null`.
 *
 * Seulement pendant une partie que la page voit (`enPartie`) et quand le
 * worker dit son émulateur lancé : l'âge publié compte aussi le temps où le
 * worker sert son menu, qui n'est pas du jeu. Recalculé à chaque message du
 * salon (un objet `partie` neuf), jamais à chaque rendu : l'heure de
 * réception est celle de l'effet qui suit le message. */
export function useLancement(
  partie: PartieVue | null | undefined,
  enPartie: boolean,
  maintenant: () => number = MAINTENANT,
): number | null {
  const [instant, setInstant] = useState<number | null>(null);
  const actif = enPartie && partie?.lance === true;
  const age = actif ? partie?.depuis_s : null;
  useEffect(() => {
    setInstant((precedent) => instantDeLancement(precedent, age, maintenant()));
    // `partie` en dépendance : un nouveau message, même d'âge égal, est une
    // nouvelle mesure.
  }, [partie, age, maintenant]);
  return actif ? instant : null;
}

/** « 00:12:34 » pour 754 secondes. */
export function horloge(secondes: number): string {
  const s = Math.max(0, Math.floor(secondes));
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${deux(Math.floor(s / 3600))}:${deux(Math.floor(s / 60) % 60)}:${deux(s % 60)}`;
}

/** L'horloge par défaut, une seule fonction pour tous les rendus : neuve à
 * chaque rendu, elle reposait l'afficheur et relançait la minuterie chaque
 * fois que la salle se redessine, deux fois par seconde (relecture du
 * 23 novembre 2026). */
function MAINTENANT(): number {
  return Date.now() / 1000;
}

export function TempsDeJeu({
  depuisS,
  maintenant = MAINTENANT,
}: {
  /** L'instant de lancement du jeu en cours, en secondes Unix, ou `null`. */
  depuisS: number | null;
  maintenant?: () => number;
}) {
  const boite = useRef<HTMLSpanElement>(null);
  const lisible = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = boite.current;
    if (depuisS === null || !el) return;
    const valeur = poserAfficheur(el, horloge(maintenant() - depuisS));
    const tic = () => {
      const ecoule = maintenant() - depuisS;
      ecrireChiffres(valeur, horloge(ecoule));
      if (lisible.current) lisible.current.textContent = TEMPS.lisible(ecoule);
    };
    tic();
    const minuterie = window.setInterval(tic, 1000);
    return () => window.clearInterval(minuterie);
  }, [depuisS, maintenant]);
  if (depuisS === null) return null;
  return (
    <p id="tempsDeJeu" className="n3-temps">
      <span ref={boite} aria-hidden="true" />
      <span ref={lisible} className="sr-only" />
    </p>
  );
}
