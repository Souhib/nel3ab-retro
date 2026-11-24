/**
 * La nouvelle des places, de l'invitation ou du signalement, écrite lettre
 * par lettre sur l'ancre de l'annonce du socle (effet « lettres », plan
 * personnes). L'ancre (`ANCRE_ANNONCE`) est posée par le cadre de la salle :
 * le fronton au bureau, l'en-tête de la colonne sans fronton, la barre au
 * téléphone, jamais l'image.
 *
 * Le lecteur d'écran n'entend pas cette ancre : la ligne parlée de la salle
 * (`LigneParlee`) dit la même phrase, et elle reste la seule région parlée.
 * `annoncerLettres` veut une région pour écrire lettre par lettre (sans
 * elle, il affiche d'un coup) ; on lui donne un élément détaché, que personne
 * ne lit. Réécrire `#ligneParlee` ici le disputerait à React, qui tient son
 * texte.
 *
 * Une erreur s'affiche d'un coup (`nature` « urgente »), comme le veut le
 * socle. La phrase s'efface `ANNONCE_RESTE_MS` après avoir été finie : le
 * fronton redevient le titre du jeu.
 */
import { useEffect } from "react";
import { ANCRE_ANNONCE } from "../lib/cadre";
import type { Nature } from "../lib/usePlaces";
import { annoncerLettres } from "../retro/lettres";
import "./places.css";

/** Le temps qu'une phrase finie reste écrite sur l'ancre. Six secondes :
 * assez pour lire « Lina prend la place 3. » d'un coup d'oeil après la fin
 * de l'écriture, sans laisser une vieille nouvelle dans le fronton. */
export const ANNONCE_RESTE_MS = 6000;

export function AnnonceEnLettres({
  nouvelle,
}: {
  nouvelle: { texte: string; cle: number; nature?: Nature } | null;
}) {
  useEffect(() => {
    if (nouvelle === null || nouvelle.texte === "") return;
    const ancre = document.querySelector<HTMLElement>(ANCRE_ANNONCE);
    if (ancre === null) return;
    const personne = document.createElement("span");
    const annonce = annoncerLettres(ancre, nouvelle.texte, {
      region: personne,
      erreur: nouvelle.nature === "urgente",
    });
    let vivante = true;
    let efface = 0;
    void annonce.fini.then(() => {
      if (!vivante) return;
      efface = window.setTimeout(() => {
        ancre.textContent = "";
        ancre.removeAttribute("data-fini");
      }, ANNONCE_RESTE_MS);
    });
    return () => {
      vivante = false;
      window.clearTimeout(efface);
      annonce.finir();
      ancre.textContent = "";
      ancre.removeAttribute("data-fini");
    };
    // La clé seule décide : le texte et la nature voyagent avec elle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nouvelle?.cle]);
  return null;
}
