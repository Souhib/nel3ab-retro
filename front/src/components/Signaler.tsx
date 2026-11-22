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
 * aussi « Signaler ». Le garde de vingt secondes n'est PAS ici: il vit dans
 * `lib/garde-signalement`, un par page, et les deux boutons le lisent. Tenu
 * dans chaque bouton, il laissait la colonne armée après un clic sur le
 * bandeau, et le bandeau se réarmait à chaque remontage (relecture adverse).
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "../lib/cn";
import type { GardeSignalement } from "../lib/garde-signalement";

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
  /** La feuille du bas d'un téléphone: une entrée comme ses voisines. */
  feuille: {
    pret: "Signaler un problème",
    envoi: "Envoi…",
    fait: "Signalement enregistré",
    tenu: "Déjà signalé",
  },
} as const;

export function Signaler({
  onComplain,
  garde,
  id = "complain",
  variante = "colonne",
  detail,
  icone,
}: {
  onComplain: () => Promise<void>;
  /** Le garde de la page, partagé par tous les boutons « Signaler ». */
  garde: GardeSignalement;
  id?: string;
  variante?: keyof typeof MOTS;
  /** La ligne sous le titre, dans la feuille du bas seulement. */
  detail?: string;
  /** Le dessin de l'entrée, dans la feuille du bas seulement. */
  icone?: React.ReactNode;
}) {
  /** Vrai depuis un repère accepté, d'ici ou de l'autre bouton, et jusqu'à ce
   * que le salon en accepte un autre. Deux durées et pas une: le remerciement
   * est court parce qu'il ne doit pas rester en travers de la partie, mais le
   * bouton reste désarmé aussi longtemps que le serveur refuse.
   *
   * Sans ça, le bouton dit « noté » à quatre secondes alors que le salon vient
   * de jeter le repère, et un contrôle qui annonce ce qu'il n'a pas fait est
   * pire qu'un contrôle absent. */
  const held = useSyncExternalStore(garde.abonner, garde.tenu);
  const [said, setSaid] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const mots = MOTS[variante];

  useEffect(() => {
    if (!said) return;
    const thanks = window.setTimeout(() => setSaid(false), 3000);
    return () => window.clearTimeout(thanks);
  }, [said]);

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
            garde.tenir();
          } catch (reason) {
            setError(
              reason instanceof Error ? reason.message : "Signalement non confirmé. Réessaie.",
            );
          } finally {
            setPending(false);
          }
        }}
        disabled={held || pending}
        data-entree={variante === "feuille" ? "signaler" : undefined}
        className={
          variante === "feuille"
            ? "n3-feuille-entree"
            : variante === "bandeau"
              ? "n3-action"
              : cn(
                  // 44 px de haut au doigt: mesuré à 33 dans le tiroir d'un
                  // téléphone (`salle-telephone.mjs`, 22 novembre 2026).
                  "border px-2 py-1 text-corps uppercase tracking-[0.14em] transition-colors pointer-coarse:min-h-11",
                  said && "border-good text-good",
                  held && !said && "border-rule text-faint",
                  !held && "border-rule text-faint hover:border-alert hover:text-alert",
                )
        }
      >
        {variante === "feuille" ? (
          <>
            <span className="n3-feuille-icone" aria-hidden="true">
              {icone}
            </span>
            <span className="n3-feuille-texte">
              <span className="n3-feuille-titre">
                {pending ? mots.envoi : said ? mots.fait : held ? mots.tenu : mots.pret}
              </span>
              {detail ? <span className="n3-feuille-detail">{detail}</span> : null}
            </span>
          </>
        ) : pending ? (
          mots.envoi
        ) : said ? (
          mots.fait
        ) : held ? (
          mots.tenu
        ) : (
          mots.pret
        )}
      </button>
      {error ? (
        <p role="alert" className="text-corps text-alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
