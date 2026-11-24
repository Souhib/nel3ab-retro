/**
 * Les places d'une salle fermée, au passé (plan des états, salle fermée).
 *
 * Les quatre START éteints, chacun avec l'étiquette de qui tenait la place,
 * sans « toi », sans couronne ni micro, et aucun geste : la salle n'existe
 * plus, prendre une place n'y ferait rien. Le groupe se lit « Ils ont joué ».
 * L'entrée est celle d'avant la fermeture (`useAvantLaFermeture`) : ce que la
 * salle publie ensuite ne dit plus qui a joué.
 *
 * La rangée reprend le dessin des places de personnes (`Places.tsx`, ses
 * classes de `places.css`) sans modifier leur fichier : la partition du
 * chantier rétro le leur laisse. La variante au passé est demandée à
 * personnes ; quand `Places` la portera, ce composant partira.
 */
import type { CSSProperties } from "react";
import { aplatDuJoueur } from "../lib/etiquette";
import { ETAT, pastille, PLACES } from "../lib/mots";
import { lesPlaces, type EntreePlaces, type FormePlaces, type Place } from "../lib/places";
import { Etiquette } from "./Etiquette";
import "./places.css";
import "./etat-salle.css";

export function PlacesAuPasse({ forme, entree }: { forme: FormePlaces; entree: EntreePlaces }) {
  const places = lesPlaces(entree);
  return (
    <div className="n3-places" data-forme={forme} data-passe="">
      <div id="ports" className="n3-places-rangee" role="group" aria-label={ETAT.ontJoue}>
        {places.map((p) => (
          <button
            key={p.port}
            type="button"
            id={`port${p.port}`}
            // Les mêmes ancres d'Aïn que les places d'une salle ouverte.
            data-ancre={`start-${p.port}`}
            data-state={p.etat}
            disabled
            aria-label={
              p.nom !== null ? PLACES.aQuelquun(p.port, p.nom) : ETAT.restaitLibre(p.port)
            }
            className="n3-place"
          >
            <span className="rt-bouton-start n3-place-start" data-libre="">
              {pastille(p.port)}
            </span>
            <span className="n3-place-texte">
              {p.nom !== null ? (
                <Etiquette nom={p.nom} place={p.port} lettres={p.lettres} />
              ) : (
                <span className="n3-place-vide">
                  {p.etat === "free" ? PLACES.vide : PLACES.sansNom}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
      {forme === "petite" ? (
        <button
          type="button"
          id="placesToutes"
          disabled
          // Sans « Les voir dans la salle » : ce bouton ne mène nulle part.
          aria-label={`${ETAT.ontJoue} : ${places.map(direPlace).join(", ")}`}
          className="n3-places-toutes"
        >
          {places.map((p) => (
            <span
              key={p.port}
              className="n3-places-lampe"
              data-libre={p.etat === "free" ? "" : undefined}
              style={
                p.etat === "free"
                  ? undefined
                  : ({ "--rt-joueur": aplatDuJoueur(p.port) } as CSSProperties)
              }
              aria-hidden="true"
            >
              {p.port}
            </span>
          ))}
        </button>
      ) : null}
    </div>
  );
}

/** Une place dite dans le bouton qui les montre toutes : son numéro, puis le
 * nom de qui la tenait, ou « libre ». */
function direPlace(p: Place): string {
  const qui = p.etat === "free" ? PLACES.vide : (p.nom ?? PLACES.sansNom);
  return `${pastille(p.port)} ${qui}`;
}
