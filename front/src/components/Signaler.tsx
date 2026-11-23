/**
 * Le bouton qui pose un repère dans le journal : un seul composant, au
 * premier rang de la colonne, dans la feuille d'un téléphone, ou dans la fiche
 * d'un état (K25). Jamais deux à l'écran : la colonne cache son rang pendant
 * une fiche.
 *
 * Il DIT qu'il a compris, et c'est la moitié de son intérêt : un bouton de
 * signalement sans retour se presse cinq fois de suite par quelqu'un qui n'est
 * pas sûr d'avoir cliqué, et le journal reçoit cinq repères là où il en fallait
 * un. Depuis le 23 novembre 2026, il dit aussi QUAND (« C'est noté, à 21 h 42 »,
 * l'heure de l'accusé du salon) et pourquoi il ne repart pas (« Déjà signalé il
 * y a 12 s », « dans 8 s ») : un bouton grisé sans raison se lisait comme une
 * panne (audit A11Y-11). Il reste focalisable (`aria-disabled`), pour que ces
 * mots se lisent au clavier ; un clic tenu n'envoie rien.
 *
 * Le garde de vingt secondes n'est PAS ici : il vit dans
 * `lib/garde-signalement`, un par page, et tous les boutons le lisent. Tenu
 * dans chaque bouton, il laissait la colonne armée après un clic sur le
 * bandeau, et le bandeau se réarmait à chaque remontage (relecture adverse).
 *
 * Un échec ne suppose pas sa cause (audit E7) : sans accusé, « le site ne
 * répond pas » et « Réessayer » ; un refus du salon se dit avec ses mots.
 * L'erreur passe par la ligne parlée de la salle (`annoncer`, urgente) ; sans
 * elle, le paragraphe d'erreur se dit lui-même (`role="alert"`).
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { rate, type GardeSignalement, type Rate } from "../lib/garde-signalement";
import { heureDite, SIGNALER } from "../lib/mots";
import type { Annoncer } from "../lib/usePlaces";
import { IconeRang } from "./Colonne";
import "./places.css";

/** Où vit le bouton. `bandeau` est le nom d'avant de la fiche courte, que le
 * bandeau d'état monte encore. */
export type VarianteSignaler = "colonne" | "fiche" | "bandeau" | "feuille";

const maintenant = () => new Date();

export function Signaler({
  onComplain,
  garde,
  id = "complain",
  variante = "colonne",
  court = false,
  annoncer,
  horloge = maintenant,
  detail,
  icone,
}: {
  onComplain: () => Promise<void>;
  /** Le garde de la page, partagé par tous les boutons « Signaler ». */
  garde: GardeSignalement;
  id?: string;
  variante?: VarianteSignaler;
  /** Dans une fiche, à côté d'un autre geste : « Signaler » seul. */
  court?: boolean;
  /** La ligne parlée de la salle. */
  annoncer?: Annoncer;
  /** L'heure de l'accusé, remplacée dans un essai. */
  horloge?: () => Date;
  /** La ligne sous le titre, dans la feuille du bas seulement. */
  detail?: string;
  /** Le dessin de l'entrée, dans la feuille du bas seulement. */
  icone?: ReactNode;
}) {
  /** Vrai depuis un repère accepté, d'ici ou d'un autre bouton, et jusqu'à ce
   * que le salon en accepte un autre. */
  const tenu = useSyncExternalStore(garde.abonner, garde.tenu);
  const [, battre] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<Rate | null>(null);

  // « il y a 12 s » avance une fois par seconde, tant que le garde tient.
  useEffect(() => {
    if (!tenu) return;
    const minuteur = window.setInterval(() => battre((n) => n + 1), 1000);
    return () => window.clearInterval(minuteur);
  }, [tenu]);

  const envoyer = async () => {
    if (tenu || envoi) return;
    setEnvoi(true);
    setEchec(null);
    try {
      await onComplain();
      const dite = SIGNALER.note(heureDite(horloge()));
      setNote(dite);
      garde.tenir();
      annoncer?.(dite, "ordinaire");
    } catch (erreur) {
      const lu = rate(erreur);
      setEchec(lu);
      annoncer?.(lu.sansReponse ? SIGNALER.sansReponse : lu.message, "urgente");
    } finally {
      setEnvoi(false);
    }
  };

  const depuis = garde.depuis();
  const titre = envoi
    ? SIGNALER.envoi
    : tenu && depuis !== null
      ? SIGNALER.tenu(depuis)
      : court || variante === "bandeau"
        ? SIGNALER.court
        : SIGNALER.pret;
  const reste = tenu ? SIGNALER.reste(garde.reste()) : null;

  const bouton = (
    <button
      type="button"
      id={id}
      onClick={() => void envoyer()}
      aria-disabled={tenu || envoi}
      data-entree={variante === "feuille" ? "signaler" : undefined}
      className={
        variante === "feuille"
          ? "n3-feuille-entree"
          : variante === "colonne"
            ? "n3-rang"
            : "n3-action"
      }
    >
      {variante === "feuille" ? (
        <>
          <span className="n3-feuille-icone" aria-hidden="true">
            {icone}
          </span>
          <span className="n3-feuille-texte">
            <span className="n3-feuille-titre">{titre}</span>
            {(reste ?? detail) ? (
              <span className="n3-feuille-detail">{reste ?? detail}</span>
            ) : null}
          </span>
        </>
      ) : variante === "colonne" ? (
        <>
          <IconeRang nom="drapeau" />
          {titre}
        </>
      ) : (
        titre
      )}
    </button>
  );
  const lignes = (
    <>
      {note && tenu ? <p className="text-corps text-muted">{note}</p> : null}
      {reste && variante !== "feuille" ? <p className="text-note text-faint">{reste}</p> : null}
      {echec ? (
        <p role={annoncer ? undefined : "alert"} className="text-corps text-alerte">
          {echec.sansReponse ? SIGNALER.sansReponse : echec.message}
        </p>
      ) : null}
      {echec?.sansReponse ? (
        <button
          type="button"
          id={`${id}Reessayer`}
          onClick={() => void envoyer()}
          className={variante === "colonne" ? "n3-rang" : "n3-action"}
        >
          {SIGNALER.reessayer}
        </button>
      ) : null}
    </>
  );
  // Le bandeau pose ses gestes en ligne : le bouton et ses lignes y restent
  // frères. Ailleurs, ils forment un bloc.
  return variante === "bandeau" ? (
    <>
      {bouton}
      {lignes}
    </>
  ) : (
    <div className="flex w-full flex-col gap-1">
      {bouton}
      {lignes}
    </div>
  );
}
