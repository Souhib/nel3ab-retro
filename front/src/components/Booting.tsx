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
import { useEffect, useRef, useState } from "react";
import {
  attenteDemarrage,
  habitudeMesuree,
  seuilLong,
  soireeDe,
  STEPS,
  versionDuChargement,
  type Habitude,
  type Step,
} from "../lib/booting";
import { CHARGEMENT } from "../lib/mots";
import { useArbitre } from "./Cadre";

/** La soirée du dernier chargement vu dans ce navigateur (C11). */
const CLE_SOIREE = "nel3ab:chargement-soiree";

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
  habitude,
  onGiveUp,
}: {
  game: string;
  /** Combien de temps ce jeu met d'habitude (D05), ou rien avant cinq
   * démarrages réussis. */
  habitude?: Habitude | null;
  save?: string;
  step: Step;
  /** Vrai quand la page a cessé d'attendre: plus rien n'arrivera tout seul. */
  stalled?: boolean;
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
  const mesuree = habitudeMesuree(habitude);
  const attente = attenteDemarrage(waited, stalled, seuilLong(habitude));
  const perdu = attente !== undefined;

  /* Aïn cherche le jeu (C11), une fois par jeu demandé : en entier au premier
     chargement de la soirée dans ce navigateur, en court ensuite. Puis, une
     fois, l'attente d'un chargement long. Par l'arbitre de la salle (K10) :
     une panne ou une scène plus haute les refuse, et la première image coupe
     le plateau (K06). */
  const arbitre = useArbitre();
  /** Le jeu pour lequel Aïn a déjà cherché : une fois par jeu demandé, même
   * si l'arbitre change d'identité entre deux rendus. */
  const cherche = useRef<string | null>(null);
  useEffect(() => {
    if (!arbitre || cherche.current === game) return;
    cherche.current = game;
    let vu: string | null = null;
    try {
      vu = localStorage.getItem(CLE_SOIREE);
      localStorage.setItem(CLE_SOIREE, soireeDe(new Date()));
    } catch {
      // Sans stockage, chaque chargement est le premier de la soirée.
    }
    arbitre.demander({
      scene: "chercher",
      par: "menus",
      hote: "plateau",
      version: versionDuChargement(vu, new Date()),
    });
  }, [arbitre, game]);
  const longDit = useRef(false);
  useEffect(() => {
    longDit.current = false;
  }, [game]);
  useEffect(() => {
    if (attente !== "long" || longDit.current || !arbitre) return;
    longDit.current = true;
    arbitre.demander({ scene: "attente-chargement", par: "menus", hote: "plateau" });
  }, [attente, arbitre]);

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
        {/* Le titre dit le fait, en casse de phrase (C12) : plus de
            sur-titre « chargement » en capitales espacées. */}
        <h2 className="n3-ecran-titre max-w-[70vw] truncate text-center">
          {CHARGEMENT.titre(game)}
        </h2>
        {/* Sur quelle sauvegarde on part. Le choix se fait juste avant, puis
            l'écran devient noir pour une dizaine de secondes: sans ce rappel, la
            seule façon de savoir ce qu'on a choisi est d'attendre le jeu et de
            regarder. */}
        {save ? <p className="text-corps text-faint">sur « {save} »</p> : null}
        {/* L'habitude, seulement mesurée (D05) : une valeur non mesurée ne
            s'affiche pas comme une mesure. */}
        {mesuree ? (
          <p className="text-corps text-faint">{CHARGEMENT.habitude(mesuree.mediane_s)}</p>
        ) : null}
      </div>

      {/* Le plateau d'Aïn pendant le chargement. Cet écran couvre celui de
          la salle sans jeu : son plateau vient avant dans la page, et
          l'arbitre prend le premier `[data-hote="plateau"]` qu'il trouve.
          La bobine de Bobine y était jusqu'au 24 novembre 2026. */}
      <div className="n3-plateau" data-hote="plateau" aria-hidden="true" style={{ height: 96 }} />

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
            : mesuree
              ? CHARGEMENT.plusLong
              : CHARGEMENT.encore(waited)}
        </p>
      ) : null}
      {/* Plus de bouton de menu ici (C2, 24 novembre 2026) : « Menu du jeu »
          de la colonne ouvre le menu à côté de cet écran, jamais dessus. */}
      {/* « arrêter d'attendre » et non « annuler »: ce bouton n'annule rien
          dans la salle, il retire cet écran d'ici (audit T08). */}
      {perdu && onGiveUp ? (
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" id="bootingGiveUp" className="n3-action" onClick={onGiveUp}>
            arrêter d&apos;attendre
          </button>
        </div>
      ) : null}
    </div>
  );
}
