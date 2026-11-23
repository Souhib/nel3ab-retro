/**
 * Une vraie manette dans la salle : ce qu'on en dit, et où.
 *
 * Jusqu'au 23 novembre 2026, un avis de cinq secondes se posait en haut de
 * l'image, puis dans la pile des avis. Au téléphone, il couvrait L pendant
 * ces cinq secondes (audit N1). Il ne reste rien de visible : le branchement
 * est dit une fois au lecteur d'écran, le rang « Ta manette » de la colonne
 * dit « à configurer » au bureau, et la bande dit quelle manette joue au
 * téléphone (en-jeu-manette.2).
 */
import { useEffect, useRef, useState } from "react";
import { PlugHistory, type PlugNotice } from "../lib/plug";
import { BRANCHEE, TOUCHES } from "../lib/mots";
import type { InputState } from "../media/input";
import { IconeRang } from "./Colonne";

// Cinq secondes pour dire le branchement (choix du 7 septembre 2026). Les
// relevés deux fois par seconde ne prolongent pas un ancien message.
const NOTICE_MS = 5000;

/** Le branchement, dit une fois : un `role="status"` monté vide dès que la
 * salle a un instantané, dont seul le texte change. Rien n'est peint. */
export function ControllerStatus({
  state,
}: {
  state: Pick<InputState, "padId" | "padLayout" | "profile">;
}) {
  const history = useRef(new PlugHistory());
  const [notice, setNotice] = useState<PlugNotice | null>(null);
  const [dit, setDit] = useState<PlugNotice | null>(null);
  useEffect(() => {
    setNotice(history.current.observe(state));
  }, [state]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setDit(notice), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return (
    <p id="controller-status" role="status" className="sr-only">
      {notice && dit !== notice ? `${notice.title}. ${notice.detail}` : ""}
    </p>
  );
}

/** Au téléphone, dans la bande : quelle manette joue et à quelle place, avec
 * deux gestes, vérifier ses boutons et montrer les touches à l'écran. Tenu
 * droit sans touches à l'écran, le conseil de tourner le téléphone : en
 * travers, l'image prend toute la hauteur. */
export function ManetteDansLaBande({
  nom,
  place,
  aConfigurer,
  tactile,
  conseil,
  onVerifier,
  onTactile,
}: {
  nom: string;
  place: number;
  aConfigurer: boolean;
  /** Les touches à l'écran sont montrées. */
  tactile: boolean;
  /** Tenu droit, sans touches à l'écran. */
  conseil: boolean;
  onVerifier: () => void;
  onTactile: () => void;
}) {
  return (
    <div id="manetteBande" className="flex flex-col gap-2">
      <p className="text-corps text-text">
        {BRANCHEE.joue(nom, place)}
        {aConfigurer ? <span className="text-alert"> {TOUCHES.aConfigurer}</span> : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          id="verifierManette"
          className="rt-bouton n3-rang-bouton"
          onClick={onVerifier}
        >
          {BRANCHEE.verifier}
        </button>
        <button
          type="button"
          id="manetteTactile"
          aria-pressed={tactile}
          className="rt-bouton n3-rang-bouton"
          onClick={onTactile}
        >
          {BRANCHEE.tactile}
        </button>
      </div>
      {conseil ? (
        <p id="tourneTelephone" className="flex items-center gap-2 text-corps text-muted">
          <IconeRang nom="tourne" />
          {BRANCHEE.tourne}
        </p>
      ) : null}
    </div>
  );
}
