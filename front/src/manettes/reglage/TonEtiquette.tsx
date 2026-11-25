/** Ton étiquette tapée dans la légende de « Ta manette » (D7 du plan
 * manettes) : le numéro de ta place à son encre, puis le ruban de
 * `Etiquette` (chantier personnes), avec tes initiales sous l'effet
 * « initiales ». Posée à côté du dessin, pas collée sur la coque : elle ne
 * cache aucune pièce. Rien pour qui regarde, qui n'a pas de place. */
import type { CSSProperties } from "react";
import { Etiquette } from "../../components/Etiquette";
import { encreDuJoueur } from "../../lib/etiquette";
import { pastille } from "../../lib/mots";

/** Ce que la salle sait de toi : ton nom, et tes initiales dans la salle. */
export type NomDeLaPlace = { nom: string; lettres?: string | null };

export function TonEtiquette({
  place,
  qui,
}: {
  place: 1 | 2 | 3 | 4 | null;
  qui: NomDeLaPlace | null | undefined;
}) {
  if (place === null || !qui) return null;
  return (
    <span className="n3-legende-etiquette" data-etiquette-manette="">
      <span
        className="n3-legende-numero"
        aria-hidden="true"
        style={{ "--etiquette-encre": encreDuJoueur(place) } as CSSProperties}
      >
        {pastille(place)}
      </span>
      <Etiquette nom={qui.nom} place={place} lettres={qui.lettres} />
    </span>
  );
}
