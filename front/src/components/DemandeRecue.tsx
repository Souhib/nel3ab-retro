/**
 * Une demande reçue : quelqu'un demande ma place. Elle remplace le bandeau
 * `Swap` posé sur l'image et la moitié « cible » du panneau `Recovery`
 * (23 novembre 2026). Elle vit dans la colonne au bureau, dans la bande au
 * téléphone, jamais sur l'image, et ne prend jamais le focus : on peut être
 * en train de jouer.
 *
 * Deux chemins du salon, deux règles, chacune dite telle qu'elle est :
 * - la reprise (`recover`) : sans réponse dans 20 s, l'autre PEUT prendre
 *   la place ;
 * - l'ancienne demande (`ask`, que la page n'émet plus mais écoute encore) :
 *   sans réponse dans 10 s, je la garde.
 *
 * « Garder ma place » est le premier bouton et le seul plein : le geste qui
 * ne coûte rien. « Donner ma place » s'annule pendant 4 s : la réponse ne
 * part qu'après (`useDonDiffere`, tenu par le parent, car la carte se
 * remonte quand elle passe au-dessus du menu ouvert). La manette répond A
 * pour garder, et ne peut jamais donner la place : c'est le geste qu'on fait
 * sans regarder.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DEMANDE } from "../lib/mots";
import type { MenuAction } from "../media/menupad";
import { Actions, Bouton, Piste, useReste } from "./CartePlace";
import { Etiquette } from "./Etiquette";
import "./places.css";

/** Combien de temps « Donner ma place » reste annulable. */
export const DON_ANNULABLE_MS = 4000;

export type DemandeEnCours = {
  from: string;
  port: number;
  /** Le temps de réponse que le salon donne, en secondes. */
  lasts: number;
  chemin: "reprise" | "ancienne";
  /** La place de qui demande, pour la couleur de son étiquette. */
  sa?: number | null;
};

/** La réponse « oui » différée de 4 s, annulable. « Garder » part tout de
 * suite et annule un don en attente. */
export function useDonDiffere(envoyer: (ok: boolean) => void): {
  donne: boolean;
  donner: () => void;
  annuler: () => void;
  garder: () => void;
} {
  const [donne, setDonne] = useState(false);
  const minuteur = useRef<number | null>(null);
  const envoi = useRef(envoyer);
  envoi.current = envoyer;
  const arreter = () => {
    if (minuteur.current !== null) window.clearTimeout(minuteur.current);
    minuteur.current = null;
  };
  useEffect(() => arreter, []);
  return {
    donne,
    donner: useCallback(() => {
      arreter();
      setDonne(true);
      minuteur.current = window.setTimeout(() => {
        minuteur.current = null;
        setDonne(false);
        envoi.current(true);
      }, DON_ANNULABLE_MS);
    }, []),
    annuler: useCallback(() => {
      arreter();
      setDonne(false);
    }, []),
    garder: useCallback(() => {
      arreter();
      setDonne(false);
      envoi.current(false);
    }, []),
  };
}

export function DemandeRecue({
  demande,
  donne = false,
  fin = null,
  pad,
  onGarder,
  onDonner,
  onAnnulerDon,
  onExpire,
  onRedemander,
}: {
  demande: DemandeEnCours | null;
  /** « Donner » a été choisi et attend ses 4 s. */
  donne?: boolean;
  /** Ma place a été prise : la fin, dite une fois. */
  fin?: { nom: string; port: number } | null;
  pad?: (handler: ((action: MenuAction) => void) | null) => void;
  onGarder: () => void;
  onDonner: () => void;
  onAnnulerDon: () => void;
  /** L'ancienne demande arrive à son terme sans réponse. */
  onExpire?: () => void;
  onRedemander?: () => void;
}) {
  const reste = useReste(demande?.lasts ?? 0, demande ? `${demande.from}:${demande.port}` : "");
  const expire = useRef(onExpire);
  expire.current = onExpire;
  useEffect(() => {
    if (demande?.chemin === "ancienne" && reste === 0) expire.current?.();
  }, [demande, reste]);

  // A garde la place ; rien sur la manette ne la donne.
  useEffect(() => {
    if (!pad || demande === null) return;
    pad((action) => {
      if (action === "confirm") onGarder();
    });
    return () => pad(null);
  }, [pad, demande, onGarder]);

  if (fin !== null && demande === null) {
    return (
      <section id="demandeRecue" className="n3-carte rt-boite" aria-labelledby="demandeTitre">
        <i className="rt-ombre" aria-hidden="true" />
        <h2 id="demandeTitre" className="n3-carte-titre">
          {DEMANDE.prise(fin.nom, fin.port)}
        </h2>
        {onRedemander ? (
          <Actions>
            <Bouton id="redemanderPlace" onClick={onRedemander}>
              {DEMANDE.redemander}
            </Bouton>
          </Actions>
        ) : null}
      </section>
    );
  }
  if (demande === null) return null;
  const reprise = demande.chemin === "reprise";
  const secondes = Math.ceil(demande.lasts);
  return (
    <section
      id="demandeRecue"
      className="n3-carte rt-boite"
      aria-labelledby="demandeTitre"
      data-chemin={demande.chemin}
    >
      <i className="rt-ombre" aria-hidden="true" />
      <Etiquette nom={demande.from} place={demande.sa ?? null} />
      <h2 id="demandeTitre" className="n3-carte-titre">
        {donne
          ? DEMANDE.donne(demande.port, demande.from)
          : DEMANDE.titre(demande.from, demande.port)}
      </h2>
      {donne ? (
        <Actions>
          <Bouton id="annulerDon" plein onClick={onAnnulerDon}>
            {DEMANDE.annuler}
          </Bouton>
        </Actions>
      ) : (
        <>
          <Piste secondes={demande.lasts} />
          <p className="n3-carte-phrase">
            {reprise ? DEMANDE.reprise(secondes, demande.from) : DEMANDE.ancienne(secondes)}{" "}
            {DEMANDE.manette}
          </p>
          <Actions>
            <Bouton id={reprise ? "keepRecovery" : "keepSeat"} plein onClick={onGarder}>
              {DEMANDE.garder}
            </Bouton>
            <Bouton id={reprise ? "giveRecovery" : "giveSeat"} onClick={onDonner}>
              {DEMANDE.donner}
            </Bouton>
          </Actions>
        </>
      )}
    </section>
  );
}
