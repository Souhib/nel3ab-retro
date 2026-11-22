/**
 * Le bouton qui pose un repère dans le journal.
 *
 * Il DIT qu'il a compris, et c'est la moitié de son intérêt: un bouton de
 * signalement sans retour se presse cinq fois de suite par quelqu'un qui n'est
 * pas sûr d'avoir cliqué, et le journal reçoit cinq repères là où il en fallait
 * un. Le retour dure trois secondes, assez pour être lu sans rester en travers
 * de la partie.
 *
 * Sorti de la colonne le 22 novembre 2026: le bandeau d'une image figée porte
 * aussi « Signaler », et une seule copie de ce garde vaut mieux que deux qui
 * finiraient par ne pas désarmer au même moment.
 */
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";

/** Combien de temps le bouton reste désarmé, en millisecondes.
 *
 * La même valeur que le garde du salon, qui refuse un deuxième repère avant
 * vingt secondes. Deux repères si rapprochés porteraient de toute façon presque
 * la même trace: chacun emporte les deux minutes qui précèdent.
 */
export const COMPLAIN_EVERY = 20_000;

/** Les mots du bouton, selon où il vit: la colonne garde les siens, le
 * bandeau parle en casse de phrase, comme ses autres actions. */
const MOTS = {
  colonne: {
    pret: "signaler un problème",
    envoi: "envoi…",
    fait: "signalement enregistré",
    tenu: "déjà signalé",
  },
  bandeau: { pret: "Signaler", envoi: "Envoi…", fait: "Signalé", tenu: "Déjà signalé" },
} as const;

export function Signaler({
  onComplain,
  id = "complain",
  variante = "colonne",
}: {
  onComplain: () => Promise<void>;
  id?: string;
  variante?: keyof typeof MOTS;
}) {
  /** Vrai depuis le clic, remis à faux quand le salon accepterait un autre
   * repère. Deux durées et pas une: le remerciement est court parce qu'il ne
   * doit pas rester en travers de la partie, mais le bouton reste désarmé
   * aussi longtemps que le serveur refuse.
   *
   * Sans ça, le bouton dit « noté » à quatre secondes alors que le salon vient
   * de jeter le repère, et un contrôle qui annonce ce qu'il n'a pas fait est
   * pire qu'un contrôle absent. */
  const [said, setSaid] = useState(false);
  const [held, setHeld] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const mots = MOTS[variante];

  useEffect(() => {
    if (!said) return;
    const thanks = window.setTimeout(() => setSaid(false), 3000);
    return () => window.clearTimeout(thanks);
  }, [said]);

  useEffect(() => {
    if (!held) return;
    const guard = window.setTimeout(() => setHeld(false), COMPLAIN_EVERY);
    return () => window.clearTimeout(guard);
  }, [held]);

  return (
    <>
      <button
        type="button"
        id={id}
        onClick={async () => {
          setPending(true);
          setError("");
          try {
            await onComplain();
            setSaid(true);
            setHeld(true);
          } catch (reason) {
            setError(
              reason instanceof Error ? reason.message : "Signalement non confirmé. Réessaie.",
            );
          } finally {
            setPending(false);
          }
        }}
        disabled={held || pending}
        className={
          variante === "bandeau"
            ? "n3-action"
            : cn(
                "border px-2 py-1 text-corps uppercase tracking-[0.14em] transition-colors",
                said && "border-good text-good",
                held && !said && "border-rule text-faint",
                !held && "border-rule text-faint hover:border-alert hover:text-alert",
              )
        }
      >
        {pending ? mots.envoi : said ? mots.fait : held ? mots.tenu : mots.pret}
      </button>
      {error ? (
        <p role="alert" className="text-corps text-alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
