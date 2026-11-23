/**
 * Les places START 1P à 4P, posées par le cadre dans le panneau de commande
 * (sous l'image, au pied de la colonne, debout ou en petit au téléphone).
 *
 * Chaque place est UN bouton entier : le rond START allumé à la couleur du
 * joueur quand elle est prise (effet « places », `.rt-bouton-start`), son
 * étiquette tapée, la couronne de qui choisit le jeu et le micro, tous DANS
 * `#portN`. Le numéro reste écrit, effet allumé ou non. La logique vit dans
 * `lib/places` ; ici, l'affichage.
 *
 * La rangée est mise à jour en place : une clé stable par numéro, aucun
 * démontage, pour que le focus reste sur la même place quand l'état change
 * deux fois par seconde.
 *
 * Une arrivée pose `data-joue` sur la place le temps de l'effet « arrive »
 * (`lib/usePlaces`), et « 3P prêt ! » saute SUR la place, jamais au-dessus :
 * le panneau coupe ce qui dépasse, et rien ne monte sur l'image. Un départ
 * pose `data-part` : la place s'éteint en trois paliers.
 *
 * `id` et `data-state` sont lus par les pilotes de navigateur.
 */
import type { CSSProperties } from "react";
import { aplatDuJoueur } from "../lib/etiquette";
import { pastille, PLACES } from "../lib/mots";
import {
  gesteDe,
  lesPlaces,
  nomDePlace,
  phraseDuRole,
  type EntreePlaces,
  type FormePlaces,
} from "../lib/places";
import { Crown } from "./Crown";
import { Etiquette } from "./Etiquette";
import { MicBadge } from "./MicBadge";
import "./places.css";

/** L'identifiant de la carte qu'une place ouvre (`CartePlace`). */
export const CARTE_PLACE = "cartePlace";

export function Places({
  forme,
  entree,
  vient = VIDE,
  part = VIDE,
  carte = null,
  onPrendre,
  onCarte,
}: {
  forme: FormePlaces;
  entree: EntreePlaces;
  /** Les places qui viennent de s'allumer (effet « arrive »). */
  vient?: ReadonlySet<number>;
  /** Les places qui viennent de s'éteindre. */
  part?: ReadonlySet<number>;
  /** La place dont la carte est ouverte. */
  carte?: number | null;
  onPrendre: (port: number) => void;
  onCarte: (port: number) => void;
}) {
  const places = lesPlaces(entree);
  const libres = places.filter((p) => p.etat === "free").length;
  return (
    <div className="n3-places" data-forme={forme}>
      <div id="ports" className="n3-places-rangee">
        {places.map((p) => {
          const libre = p.etat === "free";
          // Une place qui vient de se libérer reste allumée le temps de
          // s'éteindre en trois paliers (`data-part`), puis devient libre.
          const eteinte = libre && !part.has(p.port);
          const ouvre = gesteDe(p) === "carte";
          return (
            <button
              key={p.port}
              type="button"
              id={`port${p.port}`}
              // Ponctuel : un clic de souris rend le clavier au jeu
              // (`lib/focus-jeu`, `rendreAuJeuApresClic`).
              data-rend-le-jeu=""
              data-state={p.etat}
              data-joue={vient.has(p.port) ? "" : undefined}
              data-part={part.has(p.port) ? "" : undefined}
              aria-label={nomDePlace(p)}
              aria-expanded={ouvre ? carte === p.port : undefined}
              aria-controls={ouvre && carte === p.port ? CARTE_PLACE : undefined}
              className="n3-place"
              style={
                eteinte ? undefined : ({ "--rt-joueur": aplatDuJoueur(p.port) } as CSSProperties)
              }
              onClick={() => (ouvre ? onCarte(p.port) : onPrendre(p.port))}
            >
              <span
                className="rt-bouton-start n3-place-start"
                data-libre={eteinte ? "" : undefined}
              >
                {pastille(p.port)}
              </span>
              <span className="n3-place-texte">
                {p.nom !== null ? (
                  <Etiquette nom={p.nom} place={p.port} lettres={p.lettres} />
                ) : (
                  <span className="n3-place-vide">{libre ? PLACES.vide : PLACES.sansNom}</span>
                )}
                {p.etat === "mine" ? <span className="n3-place-toi">{PLACES.toi}</span> : null}
              </span>
              {libre ? null : (
                <span className="n3-place-signes">
                  {p.chef ? <Crown muette /> : null}
                  <MicBadge open={p.micro} />
                </span>
              )}
              {vient.has(p.port) ? (
                <span className="rt-pret" aria-hidden="true">
                  {`${pastille(p.port)} ${PLACES.pret}`}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="n3-places-role">{phraseDuRole(entree.mienne, libres)}</p>
    </div>
  );
}

const VIDE: ReadonlySet<number> = new Set();
