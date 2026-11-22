/**
 * Le micro, pour mêler sa voix aux clips. Il enregistre seulement: rien n'est
 * rejoué.
 *
 * Sorti d'`App.tsx`, dont la fonction `Room` faisait 2600 lignes
 * (vérification finale du 22 novembre 2026). Le comportement est le même.
 */
import { useEffect, useState } from "react";
import type { Session } from "../media/session";

export function useMicro(session: Session | null) {
  const [micDevice, setMicDevice] = useState<string>("");
  const [micDevices, setMicDevices] = useState<{ id: string; label: string }[]>([]);
  const refreshMics = () => {
    void session?.mic.devices().then(setMicDevices);
  };
  useEffect(() => {
    refreshMics();
    // Les noms ne se révèlent qu'APRÈS l'autorisation du micro; on ne relance
    // pas la liste ici, seulement quand le micro s'ouvre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);
  const toggleMic = () => {
    const mic = session?.mic;
    if (!mic) return;
    // L'état VIVANT, pas l'instantané: celui-ci peut être en retard d'une
    // demi-seconde, et décider « couper » sur un état périmé ne coupe rien.
    if (mic.status() === "on") {
      mic.stop();
      session?.refresh();
      return;
    }
    void mic.start(micDevice === "" ? null : micDevice).then((ok) => {
      if (ok) refreshMics();
      session?.refresh();
    });
  };
  const pickMic = (id: string) => {
    setMicDevice(id);
    if (session?.mic.status() === "on") {
      void session?.mic.start(id === "" ? null : id).then(() => session?.refresh());
    }
  };
  return { micDevice, micDevices, toggleMic, pickMic };
}
