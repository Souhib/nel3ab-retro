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
import { Chargement } from "../bobine/Chargement";
import { supportDe } from "../bobine/support";
import { attenteDemarrage, STEPS, type Step } from "../lib/booting";

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
  stalled = false,
  console: code,
  onMenu,
  onGiveUp,
}: {
  game: string;
  /** Le code de la console du jeu attendu, pour le geste de Bobine. */
  console?: string | null;
  save?: string;
  step: Step;
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
  const perdu = attenteDemarrage(waited, stalled) !== undefined;

  return (
    <div
      id="booting"
      /* SOUS le menu (z 50), dans la zone de l'image. Il a été au-dessus, en
         z 60, pour que le menu n'annonce pas « aucun jeu » pendant un
         démarrage; c'est réglé ailleurs depuis: un démarrage ferme le menu, et
         son pied dit « chargement ». Au-dessus, il cachait le menu que son
         propre bouton ouvrait, et ce menu invisible captait le clavier et la
         manette (audit P2 et E5, 22 novembre 2026). En style et non en classe:
         l'essai lit la couche, et jsdom ne lit pas Tailwind. */
      style={{ zIndex: 40 }}
      className="regie-nuit absolute inset-0 flex flex-col items-center justify-center gap-6 bg-ecran"
    >
      <div className="flex flex-col items-center gap-2">
        <span className="font-mono text-note uppercase tracking-[0.3em] text-faint">
          {/* Un changement de jeu, seul cas restant: la première arrivée a son
              rideau (`EtatSalle`) depuis le 22 novembre 2026. */}
          chargement
        </span>
        <h2 className="max-w-[70vw] truncate text-center text-large text-text">{game}</h2>
        {/* Sur quelle sauvegarde on part. Le choix se fait juste avant, puis
            l'écran devient noir pour une dizaine de secondes: sans ce rappel, la
            seule façon de savoir ce qu'on a choisi est d'attendre le jeu et de
            regarder. */}
        {save ? <p className="text-corps text-faint">sur « {save} »</p> : null}
      </div>

      {/* Bobine prépare le jeu, l'insère quand l'émulateur démarre vraiment, et
          souffle dedans si rien ne vient. Ce n'est pas une barre de
          progression: les gestes suivent les étapes que la page connaît, pas
          une horloge, et ne prétendent pas savoir combien de temps il reste. */}
      <Chargement support={supportDe(code)} etape={step} perdu={perdu} />

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
          {/* « arrêter d'attendre » et non « annuler »: ce bouton n'annule
              rien dans la salle, il retire cet écran d'ici (audit T08). */}
          {onGiveUp && perdu ? (
            <button type="button" id="bootingGiveUp" className="n3-action" onClick={onGiveUp}>
              arrêter d&apos;attendre
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
