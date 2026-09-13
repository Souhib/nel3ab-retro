import { useEffect, useRef, useState } from "react";
import { PlugHistory, type PlugNotice } from "../lib/plug";
import type { InputState } from "../media/input";

// Choix d'interface du 7 septembre 2026 : cinq secondes pour lire le message,
// puis libérer l'image. La configuration reste accessible depuis le menu.
const NOTICE_MS = 5000;

export function ControllerStatus({
  state,
  onConfigure,
  visible,
}: {
  state: Pick<InputState, "padId" | "padLayout" | "profile">;
  onConfigure: () => void;
  visible: boolean;
}) {
  const history = useRef(new PlugHistory());
  const [notice, setNotice] = useState<PlugNotice | null>(null);
  const [dismissed, setDismissed] = useState<PlugNotice | null>(null);
  useEffect(() => {
    setNotice(history.current.observe(state));
  }, [state]);
  useEffect(() => {
    if (!notice) return;
    // Une nouvelle notification reçoit son délai. Les relevés deux fois par
    // seconde et l'ouverture du menu ne prolongent pas un ancien message.
    const timer = window.setTimeout(() => setDismissed(notice), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (!visible || !notice || dismissed === notice) return null;
  return (
    <div
      id="controller-status"
      role="status"
      className="absolute left-3 right-3 top-3 z-30 max-w-sm rounded-xl border border-rule bg-ink/95 p-3 text-corps shadow-lg"
    >
      <button
        type="button"
        className="float-right px-2"
        aria-label="Masquer le message de branchement"
        onClick={() => setDismissed(notice)}
      >
        ×
      </button>
      <strong>{notice.title}</strong>
      <p className="mt-1 text-faint">{notice.detail}</p>
      <button type="button" className="mt-2 text-indigo underline" onClick={onConfigure}>
        {notice.configure ? "Configurer cette manette" : "Vérifier les commandes"}
      </button>
    </div>
  );
}
