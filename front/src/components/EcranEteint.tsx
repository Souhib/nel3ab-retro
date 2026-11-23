/**
 * L'écran éteint d'une salle sans jeu, posé à la place de l'image.
 *
 * Jusqu'au 23 novembre 2026, une salle au repos ouvrait son menu d'office, à
 * tout le monde, et cachait l'écran dessous. Rien ne s'ouvre plus : l'écran
 * dit « Pas encore de jeu. », celui qui choisit le jeu a le focus sur
 * « Choisir un jeu », le seul bouton plein de la vue, et les autres lisent qui
 * le choisit. Le menu reste à un geste : Échap, ou « Menu du jeu » dans la
 * colonne (K23).
 *
 * Sous le texte, le plateau : l'hôte de la mascotte quand il n'y a pas
 * d'image (`data-hote="plateau"`). La scène « attente » y joue trois fois au
 * plus, à 2,5 s, 8,5 s et 14,5 s, et plus jamais après un geste ou quand
 * l'onglet se cache (`lib/attention`). Elle passe par l'arbitre de la salle
 * (K10) : une scène plus haute ou une panne la refuse.
 */
import { useEffect, useRef } from "react";
import { demarrerAttention } from "../lib/attention";
import type { Role } from "../lib/chef";
import { ZONE_JEU } from "../lib/focus-jeu";
import { chefChoisit, REPOS } from "../lib/mots";
import { useArbitre } from "./Cadre";

/**
 * Ce que l'écran dit à qui ne choisit pas : `null` pour qui choisit.
 *
 * Qui ne décide pas lit qui choisit, et qu'il verra le jeu démarrer ici,
 * qu'il tienne une place ou regarde. Qui décide sans pouvoir choisir (le chef
 * ne joue plus) lit la raison de `pourquoiPasChoisir`, sans promesse.
 */
export function phraseDuRepos(role: Role, pourquoi: string | null): string | null {
  if (pourquoi === null) return null;
  if (role.mine) return pourquoi;
  return `${chefChoisit(role.chef ?? "Quelqu'un")} ${REPOS.verras}`;
}

/** La hauteur du plateau sous le texte. */
export const PLATEAU = 96;

export function EcranEteint({
  phrase,
  onChoisir,
}: {
  /** `null` pour qui choisit le jeu ; sinon pourquoi pas (`pourquoiPasChoisir`). */
  phrase: string | null;
  onChoisir: () => void;
}) {
  const arbitre = useArbitre();
  const bouton = useRef<HTMLButtonElement>(null);
  const decide = phrase === null;

  // Le focus d'entrée, une fois, et seulement si rien d'autre ne l'a pris :
  // un focus volé à la colonne ou au menu serait pire qu'aucun. La zone de
  // jeu ne compte pas : sans jeu, elle n'envoie rien, et la page la focalise
  // à l'entrée avant de savoir que la salle est au repos (`useFocusJeu`).
  useEffect(() => {
    if (!decide) return;
    const ici = document.activeElement;
    if (ici === null || ici === document.body || ici.closest(`[${ZONE_JEU}]`))
      bouton.current?.focus({ preventScroll: true });
  }, [decide]);

  useEffect(() => {
    if (!arbitre) return;
    return demarrerAttention({
      jouer: () => void arbitre.demander({ scene: "attente", par: "salle", hote: "plateau" }),
      cible: window,
      doc: document,
    });
  }, [arbitre]);

  return (
    <div id="idle-room" className="n3-ecran-eteint regie-nuit absolute inset-0 z-30">
      <h2 className="n3-ecran-titre">{REPOS.titre}</h2>
      {decide ? (
        <button
          ref={bouton}
          type="button"
          id="choisirJeu"
          onClick={onChoisir}
          className="rt-boite rt-bouton rt-bouton-plein n3-rang-bouton"
        >
          <i className="rt-ombre" aria-hidden="true" />
          {REPOS.choisir}
        </button>
      ) : (
        <p className="n3-ecran-phrase">{phrase}</p>
      )}
      <div
        className="n3-plateau"
        data-hote="plateau"
        aria-hidden="true"
        style={{ height: PLATEAU }}
      />
    </div>
  );
}
