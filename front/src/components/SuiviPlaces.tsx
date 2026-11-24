/**
 * Le suivi des arrivées et des départs, monté sous le `Cadre` pour lire son
 * arbitre des scènes (`useArbitre`, K10). Il ne peint rien : il appelle
 * `usePlaces` et rend à la salle les places qui s'allument et s'éteignent.
 *
 * Toujours monté, et non dans la rangée des places : au téléphone, la rangée
 * change de parent quand la feuille s'agrandit, et un suivi démonté avec elle
 * oubliait l'état d'avant, donc l'arrivée qui tombait pendant ce temps.
 */
import { useEffect } from "react";
import { usePlaces, type SuiviDesPlaces } from "../lib/usePlaces";
import { useArbitre } from "./Cadre";

export function SuiviPlaces({
  onVu,
  ...suivi
}: Omit<SuiviDesPlaces, "arbitre"> & {
  onVu: (vu: { vient: ReadonlySet<number>; part: ReadonlySet<number> }) => void;
}) {
  const arbitre = useArbitre();
  const { vient, part } = usePlaces({ ...suivi, arbitre });
  useEffect(() => onVu({ vient, part }), [vient, part, onVu]);
  return null;
}
