import { useEffect, useState } from "react";
import type { RecoveryNotice } from "../lib/room";

/** Le silence autorise une confirmation, il ne déclenche aucune prise. */
export function Recovery({
  notice,
  error,
  onAction,
  onClose,
}: {
  notice: RecoveryNotice | null;
  error: string;
  onAction: (action: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
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
  if (!notice && !error) return null;
  const subject = notice?.port ? `la manette ${notice.port}` : "le rôle de chef";
  const run = (action: string, ok?: boolean) => {
    setBusy(true);
    void onAction({ action, id: notice?.id, ok }).finally(() => setBusy(false));
  };
  const button =
    "border border-indigo/60 px-3 py-2 text-[13px] text-indigo hover:bg-indigo/10 disabled:opacity-50";
  return (
    <section
      id="recovery"
      role="alert"
      aria-label="reprise de la salle"
      className="fixed inset-x-3 top-6 z-[100] mx-auto flex max-w-lg flex-col gap-3 border border-indigo bg-panel p-5 text-[14px] text-text shadow-xl"
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
                className={button}
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
                className={button}
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
