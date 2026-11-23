/**
 * L'étiquette tapée d'une personne : son nom en Pixelify, à l'encre de sa
 * place, sur un ruban du creux de la régie. C'était un bout de scotch écrit
 * au feutre dans la proposition « Scotch et feutre » ; l'écriture manuscrite
 * est abandonnée (23 novembre 2026), le ruban reste tapé.
 *
 * Avec l'effet « initiales », les trois lettres d'arcade remplacent le nom
 * (`retro/effets.css`, `.rt-initiales`) ; le nom entier reste dans le texte
 * caché, que le lecteur d'écran lit dans les deux cas. Les capitales viennent
 * de la feuille : le nom s'écrit comme la personne l'a tapé.
 */
import type { CSSProperties } from "react";
import { aplatDuJoueur, encreDuJoueur, troisLettres } from "../lib/etiquette";
import { cn } from "../lib/cn";
import "./places.css";

export function Etiquette({
  nom,
  place = null,
  lettres,
  className,
  id,
}: {
  nom: string;
  /** La place de la personne, 1 à 4, pour sa couleur ; `null` pour qui regarde. */
  place?: number | null;
  /** Ses initiales dans la salle (`initialesDeLaSalle`) ; sinon les siennes. */
  lettres?: string | null;
  className?: string;
  id?: string;
}) {
  const style =
    place === null
      ? undefined
      : ({
          "--etiquette-encre": encreDuJoueur(place),
          "--rt-joueur": aplatDuJoueur(place),
        } as CSSProperties);
  return (
    <span
      id={id}
      className={cn("n3-etiquette", className)}
      data-place={place ?? undefined}
      style={style}
    >
      <span className="sr-only">{nom}</span>
      <span className="rt-nom-plein n3-etiquette-nom" aria-hidden="true">
        {nom}
      </span>
      <span className="rt-initiales" aria-hidden="true">
        {lettres ?? troisLettres(nom)}
      </span>
    </span>
  );
}
