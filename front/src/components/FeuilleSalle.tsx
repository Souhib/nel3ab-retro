/**
 * La feuille « La salle » d'une salle tenue en main, à deux hauteurs.
 *
 * Jusqu'au 23 novembre 2026, un téléphone avait deux couches pour une même
 * salle : la feuille du bas (son, menu, cacher, plein écran, signaler), et le
 * tiroir de la colonne (places, spectateurs, quitter), ouvert depuis elle. Il
 * fallait savoir laquelle tenait quoi. Il n'en reste qu'une :
 *
 * - à mi-hauteur, les gestes de la partie (`lib/feuille`). Elle couvre la
 *   manette et la bande, jamais l'image : son haut est sous le panneau de
 *   commande (`geo.feuille.mi`), et son fond ne s'assombrit plus ;
 * - agrandie par « Toute la salle » ou par Ctrl, la colonne entière, sous la
 *   barre (`geo.feuille.agrandie`). C'est un geste choisi : elle peut alors
 *   couvrir l'image, et « Fermer » la rend.
 *
 * Un seul `<dialog>` ouvert par `showModal()` pour les deux hauteurs : le
 * focus reste dedans quand elle grandit, et un toucher hors d'elle, Échap ou
 * le geste retour la ferment. Le focus revient ensuite au bouton « La salle »
 * qui l'a ouverte (le navigateur le fait ; la salle prend le relais quand ce
 * bouton a été démonté, `focusApresFermeture`).
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { Rect } from "../lib/cadre";
import type { HauteurFeuille } from "../lib/disposition";
import type { EntreeFeuille, IdEntree } from "../lib/feuille";
import { placeDe } from "./Cadre";
import { PlaceDesSurcouches } from "./Surcouche";
import {
  ExpandIcon,
  GameIcon,
  HomeScreenIcon,
  PadIcon,
  RoomIcon,
  ScreenIcon,
  SoundIcon,
} from "./XmbIcons";
import "./telephone.css";

const ICONES: Record<IdEntree, React.ReactNode> = {
  son: <SoundIcon className="h-full w-full" />,
  menu: <GameIcon className="h-full w-full" />,
  clip: <ScreenIcon className="h-full w-full" />,
  manette: <PadIcon className="h-full w-full" />,
  "plein-ecran": <ExpandIcon className="h-full w-full" />,
  "ecran-accueil": <HomeScreenIcon className="h-full w-full" />,
  "toute-la-salle": <RoomIcon className="h-full w-full" />,
};

export function FeuilleSalle({
  hauteur,
  rect,
  titre,
  entrees,
  onEntree,
  onFermer,
  children,
}: {
  hauteur: HauteurFeuille;
  /** Où elle se pose à cette hauteur, en pixels de la fenêtre. */
  rect: Rect;
  /** « Salle N », en tête. */
  titre: string;
  entrees: EntreeFeuille[];
  /** Une entrée choisie. L'écran d'accueil reste ici ; « Toute la salle »
   * remonte aussi, pour que la salle agrandisse la feuille. */
  onEntree: (id: Exclude<IdEntree, "ecran-accueil">) => void;
  onFermer: () => void;
  /** La colonne de la salle, montrée agrandie. */
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  /** Le conseil de l'écran d'accueil, déplié sous son entrée. */
  const [accueil, setAccueil] = useState(false);
  useLayoutEffect(() => {
    const boite = ref.current;
    if (boite && !boite.open) boite.showModal();
    return () => {
      if (boite?.open) boite.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      id="feuilleSalle"
      className="n3-feuille"
      data-hauteur={hauteur}
      aria-labelledby="feuilleTitre"
      style={placeDe(rect)}
      // Échap et le geste retour : le navigateur ferme, la page suit.
      onCancel={(event) => {
        event.preventDefault();
        onFermer();
      }}
      // Seulement si le dialogue est VRAIMENT fermé : l'événement part plus
      // tard que `close()`, et un démontage suivi d'un remontage (le double
      // passage des effets de React en développement) le laissait fermer une
      // feuille qu'on venait de rouvrir. Vu par `salle-telephone.mjs`.
      onClose={(event) => {
        if (!event.currentTarget.open) onFermer();
      }}
      // Un appui à côté de la feuille tombe sur le dialogue lui-même : il ne
      // couvre que son rectangle, mais son fond transparent s'étend dessous.
      onClick={(event) => {
        if (event.target === event.currentTarget) onFermer();
      }}
    >
      <div className="n3-feuille-boite">
        <header className="n3-feuille-tete">
          <p id="feuilleTitre" className="n3-feuille-nom">
            {titre}
          </p>
          <button type="button" id="fermerFeuille" className="n3-action" onClick={onFermer}>
            Fermer
          </button>
        </header>
        {hauteur === "mi" ? (
          <div className="n3-feuille-entrees">
            {entrees.map((entree) => (
              <button
                key={entree.id}
                type="button"
                className="n3-feuille-entree"
                data-entree={entree.id}
                data-alerte={entree.alerte ? "" : undefined}
                disabled={entree.inactif}
                aria-expanded={entree.id === "ecran-accueil" ? accueil : undefined}
                onClick={() => {
                  if (entree.id === "ecran-accueil") setAccueil(!accueil);
                  else onEntree(entree.id);
                }}
              >
                <span className="n3-feuille-icone" aria-hidden="true">
                  {ICONES[entree.id]}
                </span>
                <span className="n3-feuille-texte">
                  <span className="n3-feuille-titre">{entree.titre}</span>
                  <span className="n3-feuille-detail">{entree.detail}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="n3-feuille-salle">{children}</div>
        )}
        {hauteur === "mi" && accueil
          ? /* Une vraie suite d'étapes : d'où la liste numérotée. Sans nommer
             Safari : Chrome et Firefox sur iPhone ont le même « Sur l'écran
             d'accueil », et Partager peut vivre dans la barre ou sous un
             « ••• » selon la version d'iOS. Non vérifié sur un vrai iPhone. */
            ACCUEIL
          : null}
      </div>
      <PlaceDesSurcouches />
    </dialog>
  );
}

/** L'aide de l'écran d'accueil, reprise de la feuille du bas. */
const ACCUEIL = (
  <ol id="aideEcranAccueil" className="n3-feuille-aide">
    <li>
      Touche Partager, le carré avec une flèche, dans la barre du navigateur ou sous son
      «&nbsp;•••&nbsp;».
    </li>
    <li>Choisis «&nbsp;Sur l&apos;écran d&apos;accueil&nbsp;», puis «&nbsp;Ajouter&nbsp;».</li>
    <li>Ouvre la salle depuis sa nouvelle icône : la barre du navigateur n&apos;y est plus.</li>
  </ol>
);
