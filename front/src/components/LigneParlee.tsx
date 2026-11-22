/**
 * La ligne d'état parlée de la salle: une seule, montée dès le départ.
 *
 * Un lecteur d'écran n'annonce une région vivante que si elle EXISTAIT avant
 * que son texte change; monter le message avec la région ne dit rien. La ligne
 * est donc là dès l'entrée, vide, et seul son texte change. Atomique, pour
 * qu'une phrase se lise en entier.
 *
 * Elle dit la DERNIÈRE nouvelle: un changement d'état de la liaison, ou une
 * demande de manette. Jamais une durée qui avance, qui la ferait relire deux
 * fois par seconde (audit A11Y-03, A11Y-07, A11Y-09). Bobine fait le geste à
 * l'écran, cette ligne le dit en mots.
 */
import { useEffect, useRef, useState } from "react";
import { phraseDemande, phraseLiaison } from "../lib/liaison-mots";
import type { Liaison } from "../media/liaison";

export function LigneParlee({
  liaison,
  salle,
  demande,
  delai,
  peintes,
}: {
  liaison: Liaison;
  salle: number;
  demande: { from: string; port: number } | null;
  /** Le délai de réponse à une demande, en secondes. */
  delai: number;
  /** Les images peintes par la page, lues quand l'état change (`phraseLiaison`). */
  peintes: number;
}) {
  const [dit, setDit] = useState("");
  const avant = useRef<Liaison>({ etat: "ok" });
  // Lu au changement d'état, jamais en dépendance: il avance à chaque image.
  const images = useRef(peintes);
  images.current = peintes;
  // La clé de l'état sans ses durées: c'est elle qui décide s'il y a du neuf.
  const cle = JSON.stringify({ ...liaison, depuisMs: undefined, niveau: undefined });
  useEffect(() => {
    const phrase = phraseLiaison(avant.current, liaison, salle, images.current);
    avant.current = liaison;
    if (phrase !== "") setDit(phrase);
    // `liaison` change deux fois par seconde par ses durées; seule sa clé
    // compte ici.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, salle]);
  const demandee = phraseDemande(demande, delai);
  useEffect(() => {
    if (demandee !== "") setDit(demandee);
  }, [demandee]);
  return (
    <p id="ligneParlee" role="status" aria-atomic="true" className="sr-only">
      {dit}
    </p>
  );
}
