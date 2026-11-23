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
 */
import type { Rect } from "../lib/cadre";
import { nomDeLaSalle } from "../lib/feuille";
import { placeDe } from "./Cadre";
import { RoomIcon } from "./XmbIcons";
import "./telephone.css";

export function BarreSalle({
  rect,
  nomSalle,
  jeu,
  sonCoupe,
  onSalle,
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
}) {
  return (
    <header id="barreSalle" className="n3-barre" style={placeDe(rect)}>
      {/* L'hôte de la mascotte au téléphone (`ouEstLaMascotte`) : l'arbitre
          des scènes le trouve par son attribut. */}
      <span className="n3-barre-tete" data-hote="barre" aria-hidden="true" />
      <div className="n3-barre-noms">
        <p className="n3-barre-salle">{nomSalle}</p>
        {jeu ? (
          <p id="jeuDeLaBarre" className="n3-barre-jeu">
            {jeu}
          </p>
        ) : null}
        <span data-ancre="annonce" />
      </div>
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
}: {
  id: string;
  sonCoupe: boolean;
  onSalle: () => void;
  style?: React.CSSProperties;
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
      <span className="n3-salle-icone" aria-hidden="true">
        <RoomIcon className="h-full w-full" />
      </span>
      <span className="n3-salle-libelle">{libelle ?? "La salle"}</span>
    </button>
  );
}
