/**
 * « Inviter quelqu'un » (audit P11) : un panneau déplié dans la colonne, ou
 * dans la colonne de la feuille au téléphone.
 *
 * Replié, ce n'est qu'un bouton (`#inviter`, `aria-expanded`). Déplié :
 *
 * - « Le lien ouvre la salle » pour jouer ou pour regarder. « Pour jouer » est
 *   désactivé quand aucune place n'est libre, et le lien passe alors à
 *   « regarder » : un lien qui promet une place pleine ment ;
 * - la place libre que l'invité prendra, en bouton START éteint (« 4P ») ;
 * - le code QR, dessiné à l'ouverture seulement (`CodeQR`) ;
 * - le lien ENTIER, qui passe à la ligne et se sélectionne d'un geste ;
 * - « Copier le lien » (`#copierLien`) ; là où le navigateur sait partager,
 *   « Envoyer le lien » d'abord, puis « Copier » ;
 * - la condition du réseau privé, toujours dite.
 *
 * Ce panneau ne parle pas lui-même : « Lien copié. » passe par la seule ligne
 * parlée de la salle (`annoncer`). Le 22 novembre, Inviter, la reprise et
 * Signaler avaient chacun leur région, et un lecteur d'écran entendait trois
 * voix (audit A11Y-18). Quand la copie échoue, le lien est sélectionné et une
 * phrase visible le dit : rien n'échoue en silence.
 */
import { useId, useRef, useState } from "react";
import type { Entree } from "../lib/entree";
import { copier, envoyer, outilsDuNavigateur, selectionner, type Outils } from "../lib/invitation";
import { INVITER, pastille } from "../lib/mots";
import type { Annoncer } from "../lib/usePlaces";
import { CodeQR, type ModuleQR } from "./CodeQR";
import "./places.css";

const rien: Annoncer = () => {};

export function Inviter({
  lien,
  libre = null,
  annoncer = rien,
  outils,
  chargerQR,
}: {
  /** Le lien pour jouer ou pour regarder (`lienDInvitation`). Une chaîne seule
   * est le lien pour jouer de la page d'avant le câblage : pas de choix. */
  lien: string | ((entree: Entree) => string);
  /** La place libre que l'invité prendrait, ou `null` quand la salle est pleine. */
  libre?: number | null;
  /** La ligne parlée de la salle. */
  annoncer?: Annoncer;
  outils?: Outils;
  /** L'encodeur du code QR, remplacé dans un essai. */
  chargerQR?: () => Promise<ModuleQR>;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [voulue, setVoulue] = useState<Entree>("play");
  const [aLaMain, setALaMain] = useState(false);
  const bouton = useRef<HTMLButtonElement>(null);
  const sortie = useRef<HTMLOutputElement>(null);
  const panneau = useId();
  const nomRadios = useId();
  // Les outils sont lus au rendu : un essai les passe, la page lit le navigateur.
  const lesOutils = outils ?? outilsDuNavigateur();
  const unSeul = typeof lien === "string";
  const entree: Entree = unSeul ? "play" : libre === null ? "watch" : voulue;
  const adresse = typeof lien === "string" ? lien : lien(entree);

  const apres = (fait: Awaited<ReturnType<typeof copier>>) => {
    if (fait === "copiee") {
      setALaMain(false);
      annoncer(INVITER.copie, "ordinaire");
    } else if (fait === "envoyee") {
      setALaMain(false);
      annoncer(INVITER.envoye, "ordinaire");
    } else if (fait === "a-copier") {
      setALaMain(true);
      if (sortie.current) selectionner(sortie.current);
      annoncer(INVITER.nonCopie, "ordinaire");
    }
  };

  return (
    <section aria-label={INVITER.bouton} className="n3-inviter flex flex-col gap-2">
      <button
        type="button"
        id="inviter"
        ref={bouton}
        aria-expanded={ouvert}
        aria-controls={panneau}
        onClick={() => setOuvert(!ouvert)}
        className="n3-rang"
      >
        {INVITER.bouton}
      </button>
      {ouvert ? (
        <div id={panneau} className="n3-invitation flex flex-col gap-2">
          {unSeul ? null : (
            <fieldset className="flex flex-col gap-1">
              <legend className="text-corps text-muted">{INVITER.legende}</legend>
              <label className="n3-invitation-choix">
                <input
                  type="radio"
                  name={nomRadios}
                  value="play"
                  checked={entree === "play"}
                  disabled={libre === null}
                  onChange={() => setVoulue("play")}
                />
                {INVITER.pourJouer}
              </label>
              <label className="n3-invitation-choix">
                <input
                  type="radio"
                  name={nomRadios}
                  value="watch"
                  checked={entree === "watch"}
                  onChange={() => setVoulue("watch")}
                />
                {INVITER.pourRegarder}
              </label>
            </fieldset>
          )}
          {entree === "play" && libre !== null ? (
            <p className="flex items-center gap-2 text-corps text-muted">
              <span
                className="rt-bouton-start n3-invitation-start"
                data-libre=""
                aria-hidden="true"
              >
                {pastille(libre)}
              </span>
              {INVITER.attend(libre)}
            </p>
          ) : libre === null && !unSeul ? (
            <p className="text-corps text-muted">{INVITER.pleine}</p>
          ) : null}
          <CodeQR
            texte={adresse}
            titre={INVITER.code(entree === "play" ? INVITER.pourJouer : INVITER.pourRegarder)}
            charger={chargerQR}
          />
          <p className="flex flex-col gap-0.5">
            <span className="text-note text-faint">{INVITER.lien}</span>
            <output
              id="lienInvitation"
              ref={sortie}
              className="n3-invitation-lien"
              htmlFor={panneau}
            >
              {adresse}
            </output>
          </p>
          {aLaMain ? <p className="text-corps text-alerte">{INVITER.aLaMain}</p> : null}
          <div className="flex flex-wrap gap-2">
            {lesOutils.partager ? (
              <button
                type="button"
                id="envoyerLien"
                onClick={() => void envoyer(adresse, lesOutils).then(apres)}
                className="rt-boite rt-bouton rt-bouton-plein n3-rang-bouton"
              >
                <i className="rt-ombre" aria-hidden="true" />
                {INVITER.envoyer}
              </button>
            ) : null}
            <button
              type="button"
              id="copierLien"
              onClick={() => void copier(adresse, lesOutils).then(apres)}
              className={
                lesOutils.partager
                  ? "rt-boite rt-bouton n3-rang-bouton"
                  : "rt-boite rt-bouton rt-bouton-plein n3-rang-bouton"
              }
            >
              <i className="rt-ombre" aria-hidden="true" />
              {lesOutils.partager ? INVITER.copierCourt : INVITER.copier}
            </button>
          </div>
          <p className="text-note text-faint">{INVITER.reseau}</p>
          <button
            type="button"
            id="replierInvitation"
            onClick={() => {
              setOuvert(false);
              bouton.current?.focus();
            }}
            className="n3-rang-lien self-start"
          >
            {INVITER.replier}
          </button>
        </div>
      ) : null}
    </section>
  );
}
