/**
 * Les mesures de la liaison, ouvertes depuis la ligne d'état du coin au
 * bureau (`#mesures`), ou depuis « Ta liaison » dans la feuille d'un
 * téléphone. Elles prennent la place des rangs de la colonne ; les onglets
 * « essentiel » et « mesures » sont partis.
 *
 * Deux niveaux (audit des textes, 22 novembre 2026) :
 *
 * - pour le joueur : l'état en une phrase, la même que la ligne d'état
 *   (`lib/diagnosis`, qui lit `liaison-mots`) ; trois chiffres avec leur sens
 *   écrit (`lib/mesures`), chacun « pas encore mesuré » tant qu'il ne l'est
 *   pas ; le trajet, la qualité de l'image, et « Passer en image légère »
 *   avec son prix quand le diagnostic le propose ;
 * - pour la maison : les mesures techniques, repliées, où les mots d'atelier
 *   ont le droit de vivre (`MesuresTechniques`, que `App` passe ici).
 *
 * Remplace `ConnectionDiagnostic`, dont le trajet est repris tel quel.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { readMyConnection } from "../client";
import { diagnostic } from "../lib/diagnosis";
import { cadence, chiffres, type Releve } from "../lib/mesures";
import { IMAGE, MESURES, prixImageLegere } from "../lib/mots";
import type { Liaison } from "../media/liaison";
import type { VideoStats } from "../media/video";
import "./places.css";

/** Le trajet jusqu'à la salle : direct, par un relais, ou pas encore lu. */
export type Trajet = "direct" | "relay" | "unknown";

/** La lecture du trajet, remplacée dans un essai. */
export type LireTrajet = (signal: AbortSignal) => Promise<Trajet>;

const lireLeTrajet: LireTrajet = async (signal) => {
  try {
    const { data } = await readMyConnection({
      signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
    });
    const kind = data?.kind;
    return kind === "direct" || kind === "relay" ? kind : "unknown";
  } catch {
    return "unknown";
  }
};

/** Le trajet, relu toutes les trente secondes : un rafraîchissement
 * d'affichage, pas un délai de santé, et jamais sur le chemin de l'image. */
function useTrajet(lire: LireTrajet): Trajet {
  const [trajet, setTrajet] = useState<Trajet>("unknown");
  useEffect(() => {
    let actif = true;
    const controle = new AbortController();
    const relire = () =>
      void lire(controle.signal).then((lu) => {
        if (actif) setTrajet(lu);
      });
    relire();
    const minuteur = window.setInterval(relire, 30_000);
    return () => {
      actif = false;
      controle.abort();
      window.clearInterval(minuteur);
    };
  }, [lire]);
  return trajet;
}

/** Les images peintes par seconde, sur des fenêtres d'une seconde au moins,
 * datées à l'horloge murale. `null` jusqu'à la première fenêtre complète.
 *
 * Un relevé par INSTANTANÉ (la salle en lit un deux fois par seconde), et non
 * par changement du compteur : celui d'une image figée ne bouge plus, et la
 * cadence gardait sa dernière valeur, « 60 images peintes par seconde » à
 * côté d'une image figée (relecture du 24 novembre 2026). Une fenêtre sans
 * image compte zéro : un nombre d'événements, pas une valeur de repli. */
function useCadence(video: VideoStats, horloge: () => number): number | null {
  const avant = useRef<Releve | null>(null);
  const [dite, setDite] = useState<number | null>(null);
  useEffect(() => {
    const maintenant = { a: horloge(), peintes: video.painted };
    const lue = cadence(avant.current, maintenant);
    if (avant.current === null) avant.current = maintenant;
    else if (lue !== null) {
      avant.current = maintenant;
      setDite(lue);
    }
  }, [video, horloge]);
  return dite;
}

const parDefaut = () => Date.now();

export function Mesures({
  video,
  allerRetourMs,
  liaison,
  salle,
  moteur = null,
  onReduce,
  technique,
  lireTrajet = lireLeTrajet,
  horloge = parDefaut,
}: {
  video: VideoStats;
  /** L'aller-retour des touches (`InputState.roundTripMs`), `null` sans écho. */
  allerRetourMs: number | null;
  liaison: Liaison;
  salle: number;
  moteur?: string | null;
  onReduce: () => void;
  /** Le pli des mesures techniques (`<MesuresTechniques>`), monté par App. */
  technique: ReactNode;
  lireTrajet?: LireTrajet;
  /** L'horloge murale des relevés, remplacée dans un essai. */
  horloge?: () => number;
}) {
  const trajet = useTrajet(lireTrajet);
  const peintes = useCadence(video, horloge);
  const c = chiffres(video, allerRetourMs, peintes);
  const dit = diagnostic(liaison, video, salle, moteur);
  return (
    <section id="panneauMesures" aria-labelledby="titreMesures" className="flex flex-col gap-2">
      <h2 id="titreMesures" className="n3-colonne-titre">
        {MESURES.titre}
      </h2>
      <p className="text-corps">
        {dit.title}. {dit.detail}
      </p>
      <dl className="n3-mesures">
        <dt className="sr-only">{MESURES.peintesSans}</dt>
        <dd data-mauvais={c.sousLeJeu ? "" : undefined}>
          {c.peintes === null ? (
            `${MESURES.peintesSans} : ${MESURES.pasEncore}`
          ) : (
            <>
              <strong>{MESURES.peintes(c.peintes)}</strong>
              {c.sousLeJeu ? ` · ${MESURES.sousLeJeu}` : null}
            </>
          )}
        </dd>
        <dt className="sr-only">{MESURES.jeuSans}</dt>
        <dd>{c.jeu === null ? `${MESURES.jeuSans} : ${MESURES.pasEncore}` : MESURES.jeu(c.jeu)}</dd>
        <dt className="sr-only">{MESURES.allerRetourSans}</dt>
        <dd>
          {c.allerRetour === null ? (
            `${MESURES.allerRetourSans} : ${MESURES.pasEncore}`
          ) : (
            <strong>{MESURES.allerRetour(c.allerRetour)}</strong>
          )}
        </dd>
        <dt className="sr-only">{MESURES.pireSans}</dt>
        <dd>
          {c.pire === null ? (
            `${MESURES.pireSans} : ${MESURES.pasEncore}`
          ) : (
            <strong>{MESURES.pire(c.pire)}</strong>
          )}
        </dd>
      </dl>
      <p className="text-corps text-muted">
        {trajet === "direct"
          ? MESURES.direct
          : trajet === "relay"
            ? MESURES.relais
            : MESURES.inconnu}
      </p>
      <p className="text-corps text-muted">
        {video.half ? IMAGE.legere : IMAGE.complete} · {video.picture.width} ×{" "}
        {video.picture.height}
      </p>
      {video.halfDenied ? <p className="text-corps text-muted">{MESURES.legereRefusee}</p> : null}
      {dit.reduce ? (
        <p className="flex flex-col items-start gap-1">
          <button type="button" className="n3-rang" onClick={onReduce}>
            {IMAGE.passer}
          </button>
          <span className="text-note text-faint">{prixImageLegere(moteur)}</span>
        </p>
      ) : null}
      <details className="n3-mesures-techniques">
        <summary className="n3-rang">{MESURES.technique}</summary>
        {technique}
      </details>
    </section>
  );
}
