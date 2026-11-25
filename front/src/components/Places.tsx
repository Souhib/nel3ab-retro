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
 * En petit, quand le panneau n'a pas la largeur de quatre places de 44 px,
 * un seul bouton les montre toutes (`#placesToutes`, quatre lampes) et
 * ouvre la salle (`onToutes`). La bascule est une requête de conteneur
 * (`places.css`) : la largeur vient du cadre, et React ne la lit pas.
 *
 * `id` et `data-state` sont lus par les pilotes de navigateur ;
 * `data-ancre="start-N"` par Aïn, sur le rond START : il s'y pose, à côté du
 * nom et non dessus. Le planificateur ne fait pas un mur du bouton qui porte
 * l'ancre, mais de ses mots, qui portent `data-texte` (le numéro, le nom ou
 * « libre », « toi », « 3P prêt ! »). Posée sur le bouton entier, l'ancre
 * mettait Aïn au milieu de la place, sur le nom écrit au ras de son haut, et
 * l'étiquette de « depart » couvrait « 2P libre » (intégration B1, 24
 * novembre 2026). Une seule ancre par place VISIBLE : en petit, quand
 * `#placesToutes` remplace la rangée, les places cachées n'en portent pas
 * (`useRangeeVisible`), ni les lampes ; sans ancre, la scène se replie en
 * version courte, comme le contrat le prévoit.
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
  type Place,
} from "../lib/places";
import { useRangeeVisible } from "../lib/usePlaces";
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
  onToutes,
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
  /** En petit, le bouton qui montre les quatre places ouvre la salle. Sans
   * lui, la rangée reste la seule. */
  onToutes?: () => void;
}) {
  const places = lesPlaces(entree);
  const libres = places.filter((p) => p.etat === "free").length;
  const toutes = forme === "petite" && onToutes !== undefined;
  const [rangee, ancrees] = useRangeeVisible(toutes);
  return (
    <div className="n3-places" data-forme={forme}>
      <div id="ports" ref={rangee} className="n3-places-rangee">
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
                // L'ancre d'Aïn (contrat de la mascotte) : son arrivée et son
                // départ se posent sur le haut de ce rond.
                data-ancre={ancrees ? `start-${p.port}` : undefined}
                data-libre={eteinte ? "" : undefined}
              >
                <span data-texte="">{pastille(p.port)}</span>
              </span>
              <span className="n3-place-texte">
                {p.nom !== null ? (
                  <Etiquette nom={p.nom} place={p.port} lettres={p.lettres} mot />
                ) : (
                  <span className="n3-place-vide" data-texte="">
                    {libre ? PLACES.vide : PLACES.sansNom}
                  </span>
                )}
                {p.etat === "mine" ? (
                  <span className="n3-place-toi" data-texte="">
                    {PLACES.toi}
                  </span>
                ) : null}
              </span>
              {libre ? null : (
                <span className="n3-place-signes">
                  {p.chef ? <Crown muette /> : null}
                  <MicBadge open={p.micro} />
                </span>
              )}
              {vient.has(p.port) ? (
                <span className="rt-pret" aria-hidden="true" data-texte="">
                  {`${pastille(p.port)} ${PLACES.pret}`}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {toutes ? (
        <button
          type="button"
          id="placesToutes"
          data-rend-le-jeu=""
          data-joue={vient.size > 0 ? "" : undefined}
          aria-label={PLACES.toutes(places.map(direPlace).join(", "))}
          className="n3-places-toutes"
          onClick={onToutes}
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
          {vient.size > 0 ? (
            <span className="rt-pret" aria-hidden="true">
              {`${[...vient].map(pastille).join(" ")} ${PLACES.pret}`}
            </span>
          ) : null}
        </button>
      ) : null}
      <p className="n3-places-role">{phraseDuRole(entree.mienne, libres)}</p>
    </div>
  );
}

/** Une place dite dans le bouton qui les montre toutes : son numéro, puis
 * « toi », le nom, « libre » ou « tenue ». */
function direPlace(p: Place): string {
  const qui =
    p.etat === "mine" ? PLACES.toi : p.etat === "free" ? PLACES.vide : (p.nom ?? PLACES.sansNom);
  return `${pastille(p.port)} ${qui}`;
}

const VIDE: ReadonlySet<number> = new Set();
