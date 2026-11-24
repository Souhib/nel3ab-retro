/**
 * L'état d'un champ du nom (`components/ChampNom`) : ce qui est tapé, la
 * raison d'un refus, et la soumission.
 *
 * Avant le 23 novembre 2026, « entrer » restait grisé tant que le champ était
 * vide, sans dire pourquoi, et le libellé n'existait que pour un lecteur
 * d'écran (audits A11Y-10 et A11Y-17). Le bouton est maintenant toujours
 * actif : un nom vide est refusé AVEC sa raison, le champ se dit invalide
 * (`aria-invalid`) et reprend le focus.
 *
 * L'écran « Qui joue ? » (`Entrance`) et le renommage de l'avant-salle
 * appartiennent au chantier salon (K03) ; ils montent ce champ et ce crochet.
 */
import { useRef, useState } from "react";
import { NOM } from "./mots";
import { verifierNom } from "./name";

export type ChampDuNom = {
  valeur: string;
  changer: (valeur: string) => void;
  erreur: string | null;
  champ: React.RefObject<HTMLInputElement | null>;
  /** Appelle `fait` avec le nom gardé, ou refuse : raison dite, focus rendu. */
  soumettre: (fait: (nom: string) => void) => void;
};

export function useNom(initial = ""): ChampDuNom {
  const [valeur, setValeur] = useState(initial);
  const [erreur, setErreur] = useState<string | null>(null);
  const champ = useRef<HTMLInputElement | null>(null);
  return {
    valeur,
    changer: (v) => {
      setValeur(v);
      // La raison disparaît dès qu'on tape : elle a été lue.
      if (erreur !== null) setErreur(null);
    },
    erreur,
    champ,
    soumettre: (fait) => {
      const nom = verifierNom(valeur);
      if (nom === null) {
        setErreur(NOM.vide);
        champ.current?.focus();
        return;
      }
      setErreur(null);
      fait(nom);
    },
  };
}
