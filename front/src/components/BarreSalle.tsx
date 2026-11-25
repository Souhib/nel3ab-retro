/**
 * La barre d'une salle tenue en main : la tête de la mascotte, le nom de la
 * salle et celui du jeu, et « La salle ».
 *
 * Elle remplace deux choses. Le « ••• » posé parmi les touches, ou seul en
 * haut à droite, qui ouvrait la feuille du bas (22 novembre 2026) : un signe
 * sans nom, sur l'image. Et le fronton du bureau : au téléphone, le nom du
 * jeu est une ligne de la barre, au-dessus de l'image, jamais dessus.
 *
 * Elle se pose où le cadre la met (`geo.barre`), dans la zone sûre. Quand
 * l'écran est trop court pour elle, le cadre la retire avant de toucher à
 * l'image, et « La salle » passe parmi les touches (`salleDansLaManette`).
 *
 * Elle a une place pour la pastille d'état (chantier etats), entre le nom de
 * la salle et « La salle » : le nom se lit alors entier, le nom du jeu se
 * coupe sous lui, et la pastille prend le reste. Jusqu'au 24 novembre 2026,
 * la pastille se posait par-dessus le nom (décision du chef de chantier).
 */
import type { ReactNode } from "react";
import type { Rect } from "../lib/cadre";
import { nomDeLaSalle } from "../lib/feuille";
import { Mascotte } from "../mascotte/Mascotte";
import { placeDe } from "./Cadre";
import { RoomIcon } from "./XmbIcons";
import "./telephone.css";

export function BarreSalle({
  rect,
  nomSalle,
  jeu,
  sonCoupe,
  onSalle,
  pastille = null,
}: {
  rect: Rect;
  nomSalle: string;
  /** Le jeu en cours, `null` sans jeu ou pour une manette seule qui le dit
   * ailleurs. */
  jeu: string | null;
  /** Le son ne joue pas : « La salle » le montre, sa première entrée le
   * rallume. */
  sonCoupe: boolean;
  onSalle: () => void;
  /** La pastille d'état quand `montageDeLaPastille` la pose dans la barre. */
  pastille?: ReactNode;
}) {
  return (
    <header
      id="barreSalle"
      className="n3-barre"
      style={placeDe(rect)}
      data-pastille={pastille ? "" : undefined}
    >
      {/* L'hôte de la mascotte au téléphone (`ouEstLaMascotte`) : l'arbitre
          des scènes le trouve par son attribut. */}
      <Mascotte scene={null} className="n3-barre-tete" hote="barre" />
      <div className="n3-barre-noms">
        <p className="n3-barre-salle">{nomSalle}</p>
        {jeu ? (
          <p id="jeuDeLaBarre" className="n3-barre-jeu">
            {jeu}
          </p>
        ) : null}
        <span data-ancre="annonce" />
      </div>
      {pastille ? <div className="n3-barre-pastille">{pastille}</div> : null}
      <BoutonSalle id="laSalle" sonCoupe={sonCoupe} onSalle={onSalle} />
    </header>
  );
}

/** « La salle », partout où il se pose : la barre, la bande gauche en
 * travers. Celui de la manette est une pièce de la pose (`TouchPad`). */
export function BoutonSalle({
  id,
  sonCoupe,
  onSalle,
  style,
  libelle,
  tete = false,
}: {
  id: string;
  sonCoupe: boolean;
  onSalle: () => void;
  style?: React.CSSProperties;
  /** Le bouton porte la tête de la mascotte (`data-hote="barre"`) : posé
   * seul en travers, il remplace la barre, et `ouEstLaMascotte` y envoie
   * les scènes. Dans la barre, la tête est déjà à gauche du nom. */
  tete?: boolean;
  /** Ce que le bouton dit à la place de « La salle » : l'emplacement du
   * chantier personnes (« Lina · ta place »), dit aussi en tête du nom
   * accessible. */
  libelle?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      className="n3-salle-bouton"
      data-geste="feuille"
      data-alerte={sonCoupe ? "" : undefined}
      aria-haspopup="dialog"
      // Le nom dit le son coupé : la pastille rouge seule ne se lit pas.
      aria-label={nomDeLaSalle(sonCoupe, libelle)}
      style={style}
      // Un appui de souris n'enlève pas le clavier au jeu (`TouchPad`).
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSalle}
    >
      {tete ? <Mascotte scene={null} className="n3-salle-tete" hote="barre" /> : null}
      <span className="n3-salle-icone" aria-hidden="true">
        <RoomIcon className="h-full w-full" />
      </span>
      <span className="n3-salle-libelle">{libelle ?? "La salle"}</span>
    </button>
  );
}
