import { useEffect, useState } from "react";
import type { RecoveryNotice } from "../lib/room";
import type { MenuAction } from "../media/menupad";

/** Le silence autorise une confirmation, il ne déclenche aucune prise. */
export function Recovery({
  notice,
  error,
  onAction,
  onClose,
  pad,
}: {
  notice: RecoveryNotice | null;
  error: string;
  onAction: (action: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  /** De quoi recevoir la manette pendant qu'une demande attend une réponse.
   *
   * Ce panneau se répond depuis le CANAPÉ: il arrive pendant une partie, à deux
   * mètres de l'écran, chez quelqu'un qui tient une manette et pas une souris.
   * Sans ça, la seule façon de dire « je suis là » était de trouver un pointeur. */
  pad?: (handler: ((action: MenuAction) => void) | null) => void;
}) {
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!notice || notice.reason) return;
    const until = performance.now() + (notice?.remaining ?? 0) * 1000;
    const tick = () => setLeft(Math.max(0, Math.ceil((until - performance.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [notice]);
  /* Seul le geste qui ne COÛTE rien est câblé sur la manette.
   *
   * « A » confirme la reprise quand c'est toi qui la demandes, et répond « je
   * suis là » quand c'est toi qu'on réclame. Céder sa place, elle, reste un
   * clic délibéré: une pression sur la manette qu'on tient déjà en main est
   * exactement le geste qu'on fait sans regarder, et il ne doit pas pouvoir
   * donner sa place à quelqu'un d'autre par accident. */
  useEffect(() => {
    if (!pad || !notice || notice.reason) return;
    pad((action) => {
      if (action !== "confirm") return;
      if (notice.asking && left > 0) return;
      void onAction(
        notice.asking
          ? { action: "finish", id: notice.id }
          : { action: "answer", id: notice.id, ok: false },
      );
    });
    return () => pad(null);
  }, [pad, notice, left, onAction]);
  if (!notice && !error) return null;
  const subject = notice?.port ? `la manette ${notice.port}` : "le rôle de chef";
  const run = (action: string, ok?: boolean) => {
    setBusy(true);
    void onAction({ action, id: notice?.id, ok }).finally(() => setBusy(false));
  };
  /* DEUX habillages, et c'est tout le sujet: « je suis là, garder » et « lui
     passer » étaient deux rectangles de même taille, même couleur et même
     graisse, côte à côte — alors que l'un ne fait rien et que l'autre te coûte
     ta place. La paire existe déjà dans `Swap.tsx`, qui pose exactement la même
     question: l'action qui coûte la place prend l'accent, celle qui ne fait
     rien reste neutre. La règle était dans le projet, pas dans ce panneau.

     Les classes partagées apportent en prime le plancher de 42 px sur
     téléphone (index.css), que ces boutons de 33 px n'avaient pas. */
  const button = "n3-action disabled:opacity-50";
  const accent = "n3-action primary disabled:opacity-50";
  return (
    <section
      id="recovery"
      role="alert"
      aria-label="reprise de la salle"
      className="fixed inset-x-3 top-6 z-[100] mx-auto flex max-w-lg flex-col gap-3 border border-indigo bg-panel p-5 text-fort text-text shadow-xl"
    >
      <strong>
        {notice?.asking
          ? `Reprendre ${subject}`
          : `${notice?.from ?? "Reprise"} ${notice ? `demande ${subject}` : ""}`}
      </strong>
      {notice?.reason ? (
        <p>{notice.reason}</p>
      ) : notice ? (
        <>
          <p>
            {notice.asking
              ? `${notice.to} est prévenu. Sans réponse, tu pourras confirmer la reprise. Rien ne se ferme.`
              : `Sans réponse, ${notice.from} pourra reprendre ${subject}. Tu peux garder ta place ou la lui passer.`}
          </p>
          <p aria-live="off">
            {left > 0
              ? `Temps pour répondre : ${left} s`
              : "La reprise peut maintenant être confirmée."}
          </p>
        </>
      ) : null}
      {error ? <p className="text-alert">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {notice && !notice.reason ? (
          notice.asking ? (
            <>
              <button
                id="confirmRecovery"
                type="button"
                className={accent}
                disabled={busy || left > 0}
                onClick={() => run("finish")}
              >
                reprendre maintenant
              </button>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => run("cancel")}
              >
                annuler
              </button>
            </>
          ) : (
            <>
              <button
                id="keepRecovery"
                type="button"
                className={button}
                disabled={busy}
                onClick={() => run("answer", false)}
              >
                je suis là, garder
              </button>
              <button
                id="giveRecovery"
                type="button"
                className={accent}
                disabled={busy}
                onClick={() => run("answer", true)}
              >
                lui passer
              </button>
            </>
          )
        ) : (
          <button type="button" className={button} onClick={onClose}>
            fermer
          </button>
        )}
      </div>
    </section>
  );
}
