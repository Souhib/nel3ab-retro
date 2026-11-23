/**
 * Le temps de jeu, au bout du panneau de commande (effet « chiffres »,
 * roulé par « compteur » ; 23 novembre 2026, chantier salle, étape 7).
 *
 * Il ne s'affiche qu'avec l'instant de lancement que la salle annonce
 * (`depuisS`, plan donnees D04, absent du worker aujourd'hui). Sans lui, il
 * ne rend rien : un temps compté depuis l'arrivée de la page, présenté comme
 * temps de jeu, mentirait à qui arrive en cours de partie.
 *
 * L'afficheur du socle (`retro/chiffres`) écrit ses chiffres hors de React,
 * une fois par seconde : la salle ne se redessine pas pour une horloge.
 */
import { useEffect, useRef } from "react";
import { ecrireChiffres, poserAfficheur } from "../retro/chiffres";
import { TEMPS } from "../lib/mots";

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
const MAINTENANT = () => Date.now() / 1000;

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
