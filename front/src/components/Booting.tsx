/**
 * L'écran de chargement, quand la salle change de jeu.
 *
 * Changer de jeu arrête l'émulateur, redémarre le worker et fait se reconnecter
 * toutes les pages. Ça prend une dizaine de secondes, pendant lesquelles il ne
 * se passait rien à l'écran sauf une petite ligne dans la colonne: on ne savait
 * pas si on avait cliqué, si ça marchait, ou si c'était cassé.
 *
 * Ce qu'il montre est ce que la page SAIT: le nom du jeu demandé, et l'étape où
 * elle en est. Pas une barre qui avance toute seule, parce qu'aucun des deux
 * services ne dit où il en est et qu'une barre inventée est un mensonge poli.
 */
import { useEffect, useState } from "react";
import { Socket } from "./Socket";
import { STEPS, type Step } from "../lib/booting";

/* Le type et la liste vivent avec la fonction qui les CALCULE, pas avec l'écran
   qui les affiche. Deux listes d'étapes finiraient par ne plus être d'accord,
   et c'est précisément ce que cet écran doit garantir: un ordre. */
export type { Step };

const SAID: Record<Step, string> = {
  asked: "la salle a reçu la demande",
  waiting: "le jeu démarre",
  painting: "première image",
};

export function Booting({
  game,
  save,
  step,
  label = "chargement",
  stalled = false,
  onMenu,
  onGiveUp,
}: {
  game: string;
  save?: string;
  step: Step;
  /** Ce qu'on attend. « chargement » pour un changement de jeu, autre chose
   * pour une première arrivée: les étapes sont les mêmes, la raison non. */
  label?: string;
  /** Vrai quand la page a cessé d'attendre: plus rien n'arrivera tout seul. */
  stalled?: boolean;
  onMenu?: () => void;
  onGiveUp?: () => void;
}) {
  const reached = STEPS.indexOf(step);
  /** Depuis combien de secondes on attend.
   *
   * Compté ICI, et pas reçu de la page: quand plus rien n'arrive, la page ne se
   * redessine plus, et c'est EXACTEMENT le cas où cet écran doit proposer une
   * sortie. Remis à zéro quand le jeu demandé change. */
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    setWaited(0);
    const depuis = performance.now();
    const battement = window.setInterval(
      () => setWaited(Math.round((performance.now() - depuis) / 1000)),
      1000,
    );
    return () => window.clearInterval(battement);
  }, [game]);
  const perdu = stalled || waited >= 20;

  return (
    <div
      id="booting"
      /* Au-dessus du menu, qui est en z-50. Un chargement en cours est ce
         qu'il y a de plus important à l'écran: le menu ouvert par-dessus
         annonçait « aucun jeu » pendant que le jeu demandé démarrait. */
      className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-ink"
    >
      <div className="flex flex-col items-center gap-2">
        <span className="font-mono text-note uppercase tracking-[0.3em] text-faint">{label}</span>
        <h2 className="max-w-[70vw] truncate text-center text-large text-text">{game}</h2>
        {/* Sur quelle sauvegarde on part. Le choix se fait juste avant, puis
            l'écran devient noir pour une dizaine de secondes: sans ce rappel, la
            seule façon de savoir ce qu'on a choisi est d'attendre le jeu et de
            regarder. */}
        {save ? <p className="text-corps text-faint">sur « {save} »</p> : null}
      </div>

      {/* Quatre prises qui s'allument l'une après l'autre. Ce n'est pas une
          barre de progression: c'est une animation d'attente, et elle ne
          prétend pas savoir combien de temps il reste. */}
      <div className="flex gap-3">
        {[1, 2, 3, 4].map((port) => (
          <span
            key={port}
            className="w-12 animate-pulse"
            style={{ animationDelay: `${port * 180}ms`, animationDuration: "1.4s" }}
          >
            <Socket port={port} state="busy" />
          </span>
        ))}
      </div>

      <ol className="flex flex-col gap-1 text-corps">
        {STEPS.map((name, index) => (
          <li
            key={name}
            className={index <= reached ? "text-text" : "text-faint"}
            aria-current={index === reached ? "step" : undefined}
          >
            <span className="font-mono text-mini text-faint">
              {index < reached ? "✓" : index === reached ? "·" : " "}{" "}
            </span>
            {SAID[name]}
          </li>
        ))}
      </ol>

      {/* Une sortie, et seulement quand elle devient utile.
          Dix secondes de noir sont supportables quand on sait qu'on attend.
          Soixante sans rien à toucher sont indiscernables d'une panne, et la
          seule action possible depuis le canapé devient alors de recharger la
          page — ce qui rend sa place et relance l'attente pour la personne qui
          vient justement de lancer le jeu. */}
      {perdu ? (
        <p className="max-w-[44ch] text-center text-corps text-muted">
          {stalled
            ? "La salle n’a pas rendu d’image. Le jeu n’a pas démarré."
            : "Le jeu met plus longtemps que d’habitude."}
        </p>
      ) : null}
      {(perdu || waited >= 8) && (onMenu ?? onGiveUp) ? (
        <div className="flex flex-wrap justify-center gap-2">
          {onMenu ? (
            <button type="button" id="bootingMenu" className="n3-action" onClick={onMenu}>
              ouvrir le menu
            </button>
          ) : null}
          {onGiveUp && perdu ? (
            <button type="button" id="bootingGiveUp" className="n3-action" onClick={onGiveUp}>
              annuler et revenir au menu
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
