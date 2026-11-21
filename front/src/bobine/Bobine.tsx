/**
 * Bobine, le machiniste de la salle.
 *
 * Une bobine de câble debout, deux flasques en bois, le fil enroulé au milieu,
 * et l'antenne du projet sur la tête. C'est lui qui vient brancher la manette
 * de quelqu'un qui entre, qui souffle dans la cartouche pendant un chargement
 * et qui débranche la télé quand la salle s'endort.
 *
 * Pourquoi un personnage et pas une icône: les moments qu'il joue sont ceux où
 * la salle change d'état pour TOUT LE MONDE (une arrivée, un changement de jeu,
 * une fermeture). Un geste visible dit « il s'est passé quelque chose » mieux
 * qu'une ligne de texte de plus dans la colonne.
 *
 * Le dessin est fait de groupes nommés (`bob-bras-d`, `bob-jambe-g`…) que la
 * feuille `bobine.css` anime selon `data-pose`. Aucun calcul par image: la page
 * ne fait que changer un attribut, le navigateur joue l'animation, et React
 * reste loin du chemin des images (AGENTS.md, règle 8).
 *
 * Les couleurs sont des variables CSS. `--bob-cable` prend la couleur du joueur
 * pendant un branchement: c'est SON fil que Bobine déroule.
 */
import "./bobine.css";

export type Pose =
  | "repos"
  | "marche"
  | "porte"
  | "pousse"
  | "salue"
  | "dort"
  | "souffle"
  | "essuie"
  | "loupe"
  | "tire";

export function Bobine({
  pose = "repos",
  cable,
  taille = 56,
  className,
  tenue,
}: {
  pose?: Pose;
  /** La couleur du fil enroulé, celle du joueur qu'il vient brancher. */
  cable?: string;
  /** Hauteur en pixels CSS. La largeur suit le dessin (64 sur 84). */
  taille?: number;
  className?: string;
  /** Ce qu'il tient dans la main droite. Rien par défaut. */
  tenue?: "fiche" | "cartouche" | "disque" | "carte" | "loupe" | "tampon";
}) {
  const style = cable ? ({ "--bob-cable": cable } as React.CSSProperties) : undefined;
  return (
    <svg
      viewBox="0 0 64 84"
      width={(taille * 64) / 84}
      height={taille}
      className={className ? `bob ${className}` : "bob"}
      data-pose={pose}
      style={style}
      aria-hidden="true"
      overflow="visible"
    >
      <g className="bob-tout">
        <g className="bob-antenne">
          <path d="M32 16 L35.5 5.5" />
          <circle className="bob-led" cx="36" cy="4.5" r="3" />
        </g>
        <g className="bob-jambe bob-jambe-g">
          <path d="M24.5 60 v8.5" />
          <ellipse cx="23" cy="69.5" rx="4" ry="2.3" />
        </g>
        <g className="bob-jambe bob-jambe-d">
          <path d="M39.5 60 v8.5" />
          <ellipse cx="41" cy="69.5" rx="4" ry="2.3" />
        </g>
        <g className="bob-corps">
          <rect className="bob-bois" x="9" y="15" width="46" height="8" rx="4" />
          <circle className="bob-trou" cx="32" cy="19" r="1.4" />
          <rect className="bob-enroule" x="15" y="23" width="34" height="29" />
          <g className="bob-spires">
            <path d="M15 27.5 q17 2.4 34 0" />
            <path d="M15 32 q17 2.4 34 0" />
            <path d="M15 36.5 q17 2.4 34 0" />
            <path d="M15 41 q17 2.4 34 0" />
            <path d="M15 45.5 q17 2.4 34 0" />
            <path d="M15 50 q17 2 34 0" />
          </g>
          <rect className="bob-bois" x="9" y="52" width="46" height="8" rx="4" />
          <g className="bob-visage">
            <g className="bob-yeux">
              <ellipse className="bob-blanc" cx="25" cy="34.5" rx="4.6" ry="5.4" />
              <ellipse className="bob-blanc" cx="39" cy="34.5" rx="4.6" ry="5.4" />
              <g className="bob-pupilles">
                <circle cx="25.8" cy="35.6" r="2.2" />
                <circle cx="39.8" cy="35.6" r="2.2" />
              </g>
            </g>
            <ellipse className="bob-joue" cx="19.6" cy="42.5" rx="2.6" ry="1.6" />
            <ellipse className="bob-joue" cx="44.4" cy="42.5" rx="2.6" ry="1.6" />
            <path className="bob-bouche" d="M28.5 44 q3.5 3.2 7 0" />
            <ellipse className="bob-bouche-o" cx="32" cy="45" rx="2.1" ry="2.4" />
          </g>
        </g>
        <g className="bob-bras bob-bras-g">
          <path d="M15.5 38 q-6 3 -8.5 9.5" />
          <circle cx="6.8" cy="48" r="2.4" />
        </g>
        <g className="bob-bras bob-bras-d">
          <path d="M48.5 38 q6.5 -2 8.5 -8.5" />
          <circle cx="57.2" cy="29.2" r="2.4" />
          {tenue === "fiche" ? (
            <g className="bob-tenue">
              <rect x="53.5" y="15" width="8.5" height="11" rx="2" className="bob-fiche" />
              <path d="M55.5 15 v-2.6 M60 15 v-2.6" className="bob-broches" />
            </g>
          ) : null}
          {tenue === "cartouche" ? (
            <g className="bob-tenue">
              <path d="M51 11 h13 v14 h-11 l-2 -2 Z" className="bob-cartouche" />
              <rect x="53.5" y="14" width="8" height="5" className="bob-etiquette" />
            </g>
          ) : null}
          {tenue === "disque" ? (
            <g className="bob-tenue">
              <circle cx="58" cy="20" r="8" className="bob-disque" />
              <circle cx="58" cy="20" r="2" className="bob-trou-disque" />
            </g>
          ) : null}
          {tenue === "carte" ? (
            <g className="bob-tenue">
              <path d="M53.5 14 h9 v12 h-9 Z" className="bob-carte" />
              <path d="M55 16 h6" className="bob-broches" />
            </g>
          ) : null}
          {tenue === "loupe" ? (
            <g className="bob-tenue">
              <circle cx="58" cy="21" r="6" className="bob-verre" />
              <path d="M57.4 27 l-1 5" className="bob-manche" />
            </g>
          ) : null}
          {tenue === "tampon" ? (
            <g className="bob-tenue">
              <rect x="53" y="12" width="9" height="7" rx="1.5" className="bob-bois" />
              <rect x="51.5" y="19" width="12" height="4" rx="1" className="bob-encre" />
            </g>
          ) : null}
        </g>
        <g className="bob-zzz">
          <text x="48" y="12">
            z
          </text>
          <text x="53" y="6">
            z
          </text>
        </g>
        <g className="bob-souffle">
          <circle cx="40" cy="47" r="1.4" />
          <circle cx="45" cy="48.5" r="1" />
          <circle cx="49.5" cy="50" r="0.7" />
        </g>
      </g>
    </svg>
  );
}
