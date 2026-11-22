/**
 * La feuille du bas: les gestes de la page d'un téléphone, à l'abri des pouces.
 *
 * Elle monte du bas de l'écran quand on touche « ••• », dans les zones sûres, et
 * porte ce que `lib/feuille` décide: le son, le menu du jeu, la salle, la
 * manette à l'écran, le plein écran ou l'écran d'accueil, le signalement. Elle
 * se ferme par « Fermer », par Échap, par le geste retour, ou en touchant à
 * côté.
 *
 * Un dialogue modal: tant qu'elle est ouverte, le reste de la page est inerte,
 * et la salle démonte la manette à l'écran, ce qui relâche tout ce qu'un doigt
 * tenait encore (`App`).
 */
import { useLayoutEffect, useRef, useState } from "react";
import { Bobine } from "../bobine/Bobine";
import type { EntreeFeuille, IdEntree } from "../lib/feuille";
import type { GardeSignalement } from "../lib/garde-signalement";
import { Signaler } from "./Signaler";
import {
  ExpandIcon,
  FlagIcon,
  GameIcon,
  HomeScreenIcon,
  PadIcon,
  RoomIcon,
  SoundIcon,
} from "./XmbIcons";
import "./telephone.css";

const ICONES: Record<IdEntree, React.ReactNode> = {
  son: <SoundIcon className="h-full w-full" />,
  menu: <GameIcon className="h-full w-full" />,
  salle: <RoomIcon className="h-full w-full" />,
  manette: <PadIcon className="h-full w-full" />,
  "plein-ecran": <ExpandIcon className="h-full w-full" />,
  "ecran-accueil": <HomeScreenIcon className="h-full w-full" />,
  signaler: <FlagIcon className="h-full w-full" />,
};

export function FeuilleDuBas({
  titre,
  entrees,
  onEntree,
  onFermer,
  garde,
  onComplain,
}: {
  /** La salle et son jeu, en tête de la feuille. */
  titre: string;
  entrees: EntreeFeuille[];
  /** Une entrée choisie. L'écran d'accueil et le signalement restent ici. */
  onEntree: (id: Exclude<IdEntree, "signaler" | "ecran-accueil">) => void;
  onFermer: () => void;
  garde: GardeSignalement;
  onComplain: () => Promise<void>;
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
      id="feuilleDuBas"
      className="n3-feuille regie-nuit"
      aria-labelledby="feuilleTitre"
      // Échap et le geste retour: le navigateur ferme, la page suit.
      onCancel={(event) => {
        event.preventDefault();
        onFermer();
      }}
      // Seulement si le dialogue est VRAIMENT fermé: l'événement part plus
      // tard que `close()`, et un démontage suivi d'un remontage (le double
      // passage des effets de React en développement) le laissait fermer une
      // feuille qu'on venait de rouvrir. Vu par `salle-telephone.mjs`.
      onClose={(event) => {
        if (!event.currentTarget.open) onFermer();
      }}
      // Un appui à côté de la feuille tombe sur le dialogue lui-même.
      onClick={(event) => {
        if (event.target === event.currentTarget) onFermer();
      }}
    >
      <div className="n3-feuille-boite">
        <header className="n3-feuille-tete">
          <span className="n3-feuille-bob" aria-hidden="true">
            <Bobine pose="repos" taille={36} />
          </span>
          <p id="feuilleTitre" className="n3-feuille-nom">
            {titre}
          </p>
          <button type="button" id="fermerFeuille" className="n3-action" onClick={onFermer}>
            Fermer
          </button>
        </header>
        <div className="n3-feuille-entrees">
          {entrees.map((entree) =>
            entree.id === "signaler" ? (
              <Signaler
                key={entree.id}
                id="signalerFeuille"
                variante="feuille"
                detail={entree.detail}
                icone={ICONES.signaler}
                garde={garde}
                onComplain={onComplain}
              />
            ) : (
              <button
                key={entree.id}
                type="button"
                className="n3-feuille-entree"
                data-entree={entree.id}
                data-alerte={entree.alerte ? "" : undefined}
                aria-expanded={entree.id === "ecran-accueil" ? accueil : undefined}
                onClick={() => {
                  if (entree.id === "ecran-accueil") setAccueil(!accueil);
                  else if (entree.id !== "signaler") onEntree(entree.id);
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
            ),
          )}
        </div>
        {accueil ? (
          /* Une vraie suite d'étapes: d'où la liste numérotée. Sans nommer
             Safari: Chrome et Firefox sur iPhone ont le même « Sur l'écran
             d'accueil », et Partager peut vivre dans la barre ou sous un
             « ••• » selon la version d'iOS. Non vérifié sur un vrai iPhone. */
          <ol id="aideEcranAccueil" className="n3-feuille-aide">
            <li>
              Touche Partager, le carré avec une flèche, dans la barre du navigateur ou sous son
              «&nbsp;•••&nbsp;».
            </li>
            <li>
              Choisis «&nbsp;Sur l&apos;écran d&apos;accueil&nbsp;», puis «&nbsp;Ajouter&nbsp;».
            </li>
            <li>
              Ouvre la salle depuis sa nouvelle icône: la barre du navigateur n&apos;y est plus.
            </li>
          </ol>
        ) : null}
      </div>
    </dialog>
  );
}
