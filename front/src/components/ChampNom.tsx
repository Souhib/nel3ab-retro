/**
 * Le champ du nom, tapé seulement : l'écriture à la main de la proposition
 * « Scotch et feutre » est abandonnée (23 novembre 2026), le nom reste ce que
 * la personne tape.
 *
 * - un libellé VISIBLE, « Ton nom », et son aide : le placeholder seul
 *   nommait le champ et disparaissait à la première lettre (audit A11Y-10) ;
 * - 16 px, pour qu'un téléphone iOS ne zoome pas sur le champ ;
 * - `autocomplete="nickname"` : le navigateur propose le nom déjà tapé ;
 * - un refus dit sa raison sous le champ (`useNom`).
 *
 * Sous le champ, l'aperçu de l'étiquette telle que les autres la verront, sur
 * une place START. Quand le nom y est coupé, la page le dit (« Ton nom sera
 * coupé sur ta place. ») : la coupe se MESURE dans le navigateur (largeur de
 * défilement contre largeur visible), jsdom n'ayant pas de mise en page. La
 * case de l'aperçu a la largeur d'une case de la rangée sous une image de
 * 768 px (`--apercu-place`) ; une rangée plus étroite coupe plus tôt.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { NAME_MAX } from "../lib/name";
import { NOM } from "../lib/mots";
import type { ChampDuNom } from "../lib/useNom";
import { Etiquette } from "./Etiquette";
import "./places.css";

export function ChampNom({
  id = "name",
  nom,
  autoFocus = false,
  apercu = true,
}: {
  id?: string;
  nom: ChampDuNom;
  autoFocus?: boolean;
  /** L'aperçu de l'étiquette sous le champ. */
  apercu?: boolean;
}) {
  const aide = `${id}Aide`;
  const raison = `${id}Erreur`;
  const montre = nom.valeur.trim().slice(0, NAME_MAX);
  return (
    <div className="n3-champ-nom flex flex-col gap-1">
      <label htmlFor={id} className="n3-champ-libelle">
        {NOM.libelle}
      </label>
      <input
        id={id}
        ref={nom.champ}
        name="nickname"
        autoComplete="nickname"
        autoFocus={autoFocus}
        // Pas `required` : la bulle du navigateur bloquerait l'envoi avant
        // que la page dise SA raison, et sa phrase change d'un navigateur à
        // l'autre (ChampNom.test, rouge avec `required`).
        aria-required="true"
        maxLength={NAME_MAX}
        value={nom.valeur}
        onChange={(event) => nom.changer(event.target.value)}
        aria-invalid={nom.erreur !== null}
        aria-describedby={nom.erreur === null ? aide : `${raison} ${aide}`}
        className="n3-champ"
      />
      <p id={aide} className="text-note text-muted">
        {NOM.aide}
      </p>
      {nom.erreur !== null ? (
        <p id={raison} className="text-corps text-alerte">
          {nom.erreur}
        </p>
      ) : null}
      {apercu && montre ? <Apercu nom={montre} /> : null}
    </div>
  );
}

/** L'étiquette sur une place START, et l'avis quand le nom y est coupé. */
function Apercu({ nom }: { nom: string }) {
  const boite = useRef<HTMLDivElement>(null);
  const [coupe, setCoupe] = useState(false);
  useLayoutEffect(() => {
    const texte = boite.current?.querySelector(".n3-etiquette-nom");
    setCoupe(texte !== null && texte !== undefined && texte.scrollWidth > texte.clientWidth);
  }, [nom]);
  return (
    <div className="n3-apercu flex flex-col gap-1">
      <p className="text-note text-faint">{NOM.apercu}</p>
      <div ref={boite} className="n3-apercu-place" aria-hidden="true">
        <span className="rt-bouton-start n3-apercu-start" data-libre="" />
        <Etiquette nom={nom} />
      </div>
      {coupe ? <p className="text-corps text-muted">{NOM.coupe}</p> : null}
    </div>
  );
}
