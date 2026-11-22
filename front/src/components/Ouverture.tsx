/**
 * Ce qu'on voit pendant que le site dit qui on est, au lieu d'une page blanche.
 *
 * La page attend deux réponses avant d'ouvrir la salle: l'identité et les
 * réglages de manette (voir `App`). Le 22 novembre 2026, l'audit des états a
 * laissé un site muet douze secondes: aucun texte, le seul fond sombre, et
 * rien pour dire s'il fallait attendre ou recharger (E8). Cet écran le dit
 * tout de suite, puis a une FIN: passé la limite, il propose de réessayer, ou
 * d'entrer quand même avec le nom gardé dans ce navigateur.
 */
import { useEffect, useState } from "react";
import { Bobine } from "../bobine/Bobine";
import "./etat-salle.css";

/** Au-delà, le site ne répond pas, en millisecondes.
 *
 * Huit secondes. Sur le lien lent émulé de l'audit (22 novembre 2026), les
 * trois requêtes du premier écran prenaient 2,4 s à elles trois, et 1,1 s en
 * relais Tailscale: huit secondes, c'est plus de trois fois le pire mesuré. */
export const OUVERTURE_LIMITE_MS = 8000;

export function Ouverture({
  salle,
  onReessayer,
  onEntrer,
}: {
  salle: number;
  onReessayer: () => void;
  /** Entrer sans attendre: le nom gardé dans ce navigateur, ou le formulaire. */
  onEntrer: () => void;
}) {
  const [longue, setLongue] = useState(false);
  useEffect(() => {
    const fin = window.setTimeout(() => setLongue(true), OUVERTURE_LIMITE_MS);
    return () => window.clearTimeout(fin);
  }, []);
  return (
    <div id="ouverture" className="n3-etat-rideau regie-nuit" data-perdue={longue}>
      <span className="n3-marque">nel3ab</span>
      <section className="n3-etat-carte" aria-labelledby="ouvertureTitre">
        <div className="n3-etat-bob">
          <Bobine
            pose={longue ? "loupe" : "marche"}
            tenue={longue ? "loupe" : undefined}
            taille={96}
          />
        </div>
        <div className="n3-etat-bulle" role="status" aria-atomic="true">
          <p id="ouvertureTitre" className="n3-etat-titre">
            {longue ? "Le site ne répond pas." : `On ouvre la salle ${salle}.`}
          </p>
          {longue ? (
            <>
              <p className="n3-etat-detail">
                Entrer sans attendre ouvre la salle avec le nom gardé dans ce navigateur.
              </p>
              <div className="n3-etat-actions">
                <button type="button" className="n3-action primary" onClick={onReessayer}>
                  Réessayer
                </button>
                <button type="button" className="n3-action" onClick={onEntrer}>
                  Entrer quand même
                </button>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
