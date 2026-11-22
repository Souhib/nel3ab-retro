/**
 * Le temps que le chef attend un absent, pour les deux panneaux de lancement.
 *
 * La règle est dans `lancement.ts` (`retenirArrivees`, `attenteDesAbsents`);
 * ce crochet ne fait que la nourrir: il note qui arrive quand, et fait avancer
 * l'horloge une fois par seconde tant que la page est celle du chef et qu'un
 * joueur n'a pas répondu. Pour les autres pages, aucune horloge.
 */
import { useEffect, useState } from "react";
import type { Preparation } from "../client";
import { attenteDesAbsents, retenirArrivees, type Arrivees } from "./lancement";

export function useAttente(pending: Preparation | null, moi: string | null): number {
  const [arrivees, setArrivees] = useState<Arrivees | null>(() =>
    pending ? retenirArrivees(null, pending, Date.now()) : null,
  );
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    if (pending) setArrivees((avant) => retenirArrivees(avant, pending, Date.now()));
  }, [pending]);
  const attend =
    pending !== null &&
    pending.starter === moi &&
    pending.players.some((one) => one.claim !== pending.starter && !one.ready);
  useEffect(() => {
    if (!attend) return;
    const tic = window.setInterval(() => setMaintenant(Date.now()), 1000);
    return () => window.clearInterval(tic);
  }, [attend]);
  if (!pending || !arrivees) return 0;
  // Une arrivée que l'effet n'a pas encore notée compte comme arrivée
  // maintenant: au pire la page propose plus tard que le salon, jamais plus tôt.
  return attenteDesAbsents(pending, retenirArrivees(arrivees, pending, maintenant), maintenant);
}
