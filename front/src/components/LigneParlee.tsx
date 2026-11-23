/**
 * La ligne d'état parlée de la salle: une seule, montée dès le départ.
 *
 * Un lecteur d'écran n'annonce une région vivante que si elle EXISTAIT avant
 * que son texte change; monter le message avec la région ne dit rien. La ligne
 * est donc là dès l'entrée, vide, et seul son texte change. Atomique, pour
 * qu'une phrase se lise en entier.
 *
 * Elle dit la DERNIÈRE nouvelle: un changement d'état de la liaison, une
 * demande de place, ou une nouvelle des places et de l'invitation (`nouvelle`,
 * depuis le 23 novembre 2026: Inviter, la reprise et Signaler avaient chacun
 * leur région, audit A11Y-18). Jamais une durée qui avance, qui la ferait relire deux
 * fois par seconde (audit A11Y-03, A11Y-07, A11Y-09). Bobine fait le geste à
 * l'écran, cette ligne le dit en mots.
 */
import { useEffect, useRef, useState } from "react";
import { phraseDemande, phraseLiaison } from "../lib/liaison-mots";
import type { Liaison } from "../media/liaison";

/** Le temps qu'une nouvelle garde la ligne : une phrase d'état qui arrive
 * avant s'ajoute à elle au lieu de la remplacer. Un lecteur d'écran lit une
 * région polie quand elle se calme ; une arrivée remplacée 90 ms plus tard
 * par « La salle 1 redémarre. » n'était jamais lue (plan personnes,
 * places-demande 14, A11Y-18). 1,5 s couvre une phrase courte dite par une
 * synthèse vocale ; au-delà, la phrase d'état remplace, comme avant. */
export const TENUE_NOUVELLE_MS = 1500;

export function LigneParlee({
  liaison,
  salle,
  demande,
  delai,
  peintes,
  nouvelle = null,
}: {
  liaison: Liaison;
  salle: number;
  demande: { from: string; port: number; chemin?: "reprise" | "ancienne" } | null;
  /** Le délai de réponse à une demande, en secondes. */
  delai: number;
  /** Les images peintes par la page, lues quand l'état change (`phraseLiaison`). */
  peintes: number;
  /** Une nouvelle d'un autre chantier (une arrivée, « Lien copié. », un
   * signalement), dite une fois. `cle` change à chaque nouvelle : la même
   * phrase deux fois de suite se redit. */
  nouvelle?: { texte: string; cle: number } | null;
}) {
  const [dit, setDit] = useState("");
  const avant = useRef<Liaison>({ etat: "ok" });
  // Lu au changement d'état, jamais en dépendance: il avance à chaque image.
  const images = useRef(peintes);
  images.current = peintes;
  // La clé de l'état sans ses durées: c'est elle qui décide s'il y a du neuf.
  const cle = JSON.stringify({ ...liaison, depuisMs: undefined, niveau: undefined });
  /** La dernière nouvelle dite et son heure, pour `TENUE_NOUVELLE_MS`. */
  const derniere = useRef<{ texte: string; a: number } | null>(null);
  useEffect(() => {
    const phrase = phraseLiaison(avant.current, liaison, salle, images.current);
    avant.current = liaison;
    if (phrase === "") return;
    const tenue = derniere.current;
    derniere.current = null;
    setDit(tenue && Date.now() - tenue.a < TENUE_NOUVELLE_MS ? `${tenue.texte} ${phrase}` : phrase);
    // `liaison` change deux fois par seconde par ses durées; seule sa clé
    // compte ici.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, salle]);
  const demandee = phraseDemande(demande, delai);
  useEffect(() => {
    if (demandee === "") return;
    // La demande a remplacé la nouvelle : une phrase d'état ne la ramène pas.
    derniere.current = null;
    setDit(demandee);
  }, [demandee]);
  useEffect(() => {
    if (nouvelle === null || nouvelle.texte === "") return;
    setDit(nouvelle.texte);
    derniere.current = { texte: nouvelle.texte, a: Date.now() };
    // La clé seule décide : le texte voyage avec elle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nouvelle?.cle]);
  return (
    <p id="ligneParlee" role="status" aria-atomic="true" className="sr-only">
      {dit}
    </p>
  );
}
