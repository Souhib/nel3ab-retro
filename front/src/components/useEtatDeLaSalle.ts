/**
 * Les états de la salle, tels qu'`App.tsx` les tient (ADR D40).
 *
 * La partition du chantier rétro ne laisse à `App.tsx` que le câblage : les
 * imports, le montage des pièces dans les emplacements du cadre, et le
 * retrait des avis d'avant. La relecture du 24 novembre 2026 y a trouvé de la
 * logique des états écrite dans six commits : le chemin de la pastille au
 * geste de sa fiche, la mémoire d'une salle fermée, ce que font les gestes.
 * Elle vit ici, et ses essais la voient sans monter la salle.
 *
 * - `useModeleDeLEtat` : le modèle (`lib/etat-modele`) et sa couverture ;
 * - `rappelsDeLEtat` : ce que fait chaque geste d'une fiche ou du plein
 *   cadre, avec les moyens que la salle lui donne ;
 * - `useAllerAuGeste` : la pastille mène au geste de sa fiche, et la feuille
 *   qu'elle a ouverte lui rend le focus en se fermant ;
 * - `useAvantLaFermeture` : ce qu'une salle montrait avant de fermer.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { modeleEtat, type Entree, type Modele } from "../lib/etat-modele";
import type { GardeSignalement } from "../lib/garde-signalement";
import { useCouverture, type Rappels } from "./EtatSalle";

/** Le modèle de l'état, et ce qu'il pose sur l'image : armé sur les images
 * que l'état avait vues (`Snapshot.couvertureVue`), levé par la première
 * image peinte (`media/couverture`). */
export function useModeleDeLEtat(e: Entree & { vues: number }): Modele {
  const modele = modeleEtat(e);
  useCouverture(modele.couverture, e.vues);
  return modele;
}

/** Ce que la salle donne aux gestes des états : ses moyens, sans leur
 * enchaînement, qui est ici. */
export type MoyensDeLaSalle = {
  /** La session de la page, `null` avant l'entrée. */
  session: {
    relancerImage(): void;
    input: { reste(): boolean };
    video: { setHalf(half: boolean): void };
  } | null;
  quitter: () => void;
  /** Poser un repère au journal, avec les deux dernières minutes. */
  signaler: () => Promise<void>;
  garde: GardeSignalement;
  /** Passer en image légère (« Passer en image légère »). */
  reduire: () => void;
  /** Le suivi d'une liaison qui cale : une proposition tranchée le calme. */
  cale: { settled(): void };
  /** Le journal de la qualité, que la salle envoie au salon. */
  qualite: (mot: "refusé") => void;
  /** La proposition de l'image légère n'est plus à faire. */
  sansProposition: () => void;
  /** L'image légère de cette page, allumée ou non. */
  legere: (oui: boolean) => void;
  /** L'avis d'une image légère passée d'elle-même, montré ou non. */
  avisLegere: (montre: boolean) => void;
  /** La personne a refusé l'image légère : elle ne revient plus d'elle-même. */
  refuserLegere: () => void;
};

/** Ce que fait chaque geste d'une fiche ou du plein cadre. */
export function rappelsDeLEtat(m: MoyensDeLaSalle): Rappels {
  return {
    onRelancer: () => m.session?.relancerImage(),
    onReessayer: () => m.session?.relancerImage(),
    onQuitter: m.quitter,
    onSignaler: m.signaler,
    garde: m.garde,
    onReduire: m.reduire,
    // « Non merci » : la liaison qui calait est tenue pour calmée, la
    // proposition part, et le salon apprend le refus.
    onGarder: () => {
      m.cale.settled();
      m.sansProposition();
      m.qualite("refusé");
    },
    // « Je reste » part en un octet sur la socket de la place (D16) ; le
    // compte revient à zéro au message de salle suivant.
    onRester: () => void m.session?.input.reste(),
    // « Revenir en image complète » : refusée pour la suite, l'image légère
    // s'éteint, et son avis avec elle.
    onRevenir: () => {
      m.refuserLegere();
      m.session?.video.setHalf(false);
      m.legere(false);
      m.avisLegere(false);
    },
    onGarderLegere: () => m.avisLegere(false),
  };
}

/** Le premier geste d'une fiche, où la pastille mène le focus. */
export const GESTE_DE_LA_FICHE = ":is(#liaison, #rough) :is(.n3-geste, #signalerEtat)";

/**
 * La pastille mène au geste de sa fiche : le focus sur son premier geste,
 * après avoir ouvert la feuille quand la fiche y vit (`lieuDeLaFiche`).
 *
 * La feuille ouverte ainsi rend le focus à la pastille en se fermant, quand
 * il est retombé sur le document et qu'aucun menu ne s'ouvre à la place,
 * plutôt qu'au bouton « La salle » (pilote etats, pastille-mene-au-geste,
 * 24 novembre 2026). Dans un effet de mise en page : il passe avant celui
 * de la salle, qui ne trouve alors plus de focus perdu et laisse faire.
 */
export function useAllerAuGeste(e: {
  lieu: "colonne" | "feuille";
  feuilleOuverte: boolean;
  menu: boolean;
  ouvrirFeuille: () => void;
}): () => void {
  const parLaPastille = useRef(false);
  const avant = useRef(e.feuilleOuverte);
  useLayoutEffect(() => {
    const fermee = avant.current && !e.feuilleOuverte;
    avant.current = e.feuilleOuverte;
    if (!fermee) return;
    const elle = parLaPastille.current;
    parLaPastille.current = false;
    if (!elle || e.menu) return;
    const ici = document.activeElement;
    if (ici !== null && ici !== document.body) return;
    document.getElementById("pastilleEtat")?.focus({ preventScroll: true });
  }, [e.feuilleOuverte, e.menu]);
  return () => {
    if (e.lieu === "feuille") {
      parLaPastille.current = true;
      e.ouvrirFeuille();
    }
    requestAnimationFrame(() => document.querySelector<HTMLElement>(GESTE_DE_LA_FICHE)?.focus());
  };
}

/**
 * Ce qu'une salle montrait avant de fermer : ses places et sa soirée. Une
 * salle fermée les garde au passé, parce que ce qu'elle publie ensuite ne
 * dit plus qui a joué, et que ceux qui arrivent après la fermeture n'ont
 * pas regardé (plan des états, salle fermée). Écrite après chaque rendu
 * d'une salle ouverte, lue au rendu d'une salle fermée.
 */
export function useAvantLaFermeture<T>(fermee: boolean, maintenant: T): T {
  const gardee = useRef(maintenant);
  useEffect(() => {
    if (!fermee) gardee.current = maintenant;
  });
  return fermee ? gardee.current : maintenant;
}
