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
import { Socket } from "./Socket";

export type Step = "asked" | "waiting" | "painting";

const SAID: Record<Step, string> = {
  asked: "la salle a reçu la demande",
  waiting: "le jeu démarre",
  painting: "première image",
};

export function Booting({ game, save, step }: { game: string; save?: string; step: Step }) {
  const steps: Step[] = ["asked", "waiting", "painting"];
  const reached = steps.indexOf(step);

  return (
    <div
      id="booting"
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-ink"
    >
      <div className="flex flex-col items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-faint">
          chargement
        </span>
        <h2 className="max-w-[70vw] truncate text-center text-[22px] text-text">{game}</h2>
        {/* Sur quelle sauvegarde on part. Le choix se fait juste avant, puis
            l'écran devient noir pour une dizaine de secondes: sans ce rappel, la
            seule façon de savoir ce qu'on a choisi est d'attendre le jeu et de
            regarder. */}
        {save ? <p className="text-[12px] text-faint">sur « {save} »</p> : null}
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

      <ol className="flex flex-col gap-1 text-[12px]">
        {steps.map((name, index) => (
          <li
            key={name}
            className={index <= reached ? "text-text" : "text-faint"}
            aria-current={index === reached ? "step" : undefined}
          >
            <span className="font-mono text-[10px] text-faint">
              {index < reached ? "✓" : index === reached ? "·" : " "}{" "}
            </span>
            {SAID[name]}
          </li>
        ))}
      </ol>
    </div>
  );
}
