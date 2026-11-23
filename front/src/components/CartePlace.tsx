/**
 * La carte d'une place, ouverte par un toucher sur une place START tenue ou
 * sur la sienne. Elle vit dans la colonne au bureau, dans la bande au
 * téléphone, jamais sur l'image : le panneau fixe de `Recovery`, posé en haut
 * de la page par-dessus le jeu, s'en va (23 novembre 2026).
 *
 * Elle suit la vraie règle du salon (`api/ws/recovery.py`) : la personne qui
 * tient la place a 20 s pour répondre ; sans réponse, celle qui demande
 * PEUT prendre la place, d'un geste. Le silence seul ne prend rien. La
 * proposition promettait 10 s et « la place te reste » : l'écrire ferait dire
 * à la page le contraire du salon.
 *
 * La piste du temps est une animation CSS posée une fois, réglée sur le
 * temps restant que le salon donne ; le chiffre bat à 1 Hz dans la seule
 * carte ouverte, caché au lecteur d'écran (une durée qui avance serait relue).
 * Aucune région vivante ici : la ligne parlée de la salle dit les nouvelles.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { RecoveryNotice } from "../lib/room";
import { CARTE, PLACE } from "../lib/mots";
import type { MenuAction } from "../media/menupad";
import { useReste } from "../lib/usePlaces";
import { CARTE_PLACE } from "./Places";
import "./places.css";

/** Ce que la carte montre quand aucune demande n'est en cours. */
export type SujetCarte =
  | { type: "autre"; port: number; nom: string; delai: number }
  | { type: "sans-nom"; port: number }
  | { type: "mienne"; port: number; comment: string };

export function CartePlace({
  sujet,
  notice,
  erreur = "",
  occupe = false,
  libre = null,
  pad,
  focus = true,
  onDemander,
  onPrendre,
  onAction,
  onFermer,
  onRendre,
}: {
  sujet: SujetCarte | null;
  /** La demande en cours, venue du salon, quand c'est moi qui demande. */
  notice: RecoveryNotice | null;
  erreur?: string;
  /** Une réponse est en vol : tenu par le parent, la carte peut se remonter. */
  occupe?: boolean;
  /** Une place libre à proposer après un refus. */
  libre?: number | null;
  /** La manette répond à la carte : A confirme la reprise après le délai. */
  pad?: (handler: ((action: MenuAction) => void) | null) => void;
  /** La carte prend le focus sur son titre en s'ouvrant (pas une demande reçue). */
  focus?: boolean;
  onDemander: (port: number | null) => void;
  onPrendre: (port: number) => void;
  onAction: (action: Record<string, unknown>) => void;
  onFermer: () => void;
  onRendre?: () => void;
}) {
  const titre = useRef<HTMLHeadingElement>(null);
  const attente = notice !== null && notice.asking && notice.reason === null;
  const reste = useReste(attente ? notice.remaining : 0, notice?.id ?? "");
  const ouverte = sujet !== null || notice !== null || erreur !== "";

  useEffect(() => {
    if (ouverte && focus) titre.current?.focus();
    // Le focus se pose à l'ouverture, pas à chaque seconde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouverte, sujet?.port, notice?.id]);

  // Seul le geste qui ne coûte rien passe par la manette : A confirme une
  // reprise devenue possible. Demander ou rendre reste un geste délibéré.
  useEffect(() => {
    if (!pad || !attente) return;
    pad((action) => {
      if (action === "confirm" && reste === 0) onAction({ action: "finish", id: notice.id });
    });
    return () => pad(null);
  }, [pad, attente, reste, notice, onAction]);

  if (!ouverte) return null;
  const qui = notice?.to ?? (sujet?.type === "autre" ? sujet.nom : "");
  const port = notice?.port ?? sujet?.port ?? null;

  let corps: ReactNode;
  let entete: string;
  if (notice !== null && notice.reason !== null) {
    entete = notice.reason;
    corps = (
      <Actions>
        {libre !== null ? (
          <Bouton plein onClick={() => onPrendre(libre)}>
            {CARTE.prendre(libre)}
          </Bouton>
        ) : null}
        <Bouton onClick={onFermer}>{CARTE.fermer}</Bouton>
      </Actions>
    );
  } else if (attente) {
    entete = reste > 0 ? CARTE.chezLui(qui) : CARTE.silence(qui);
    corps = (
      <>
        {reste > 0 ? <Piste secondes={notice.remaining} /> : null}
        {reste > 0 && port !== null ? (
          <p className="n3-carte-phrase">
            {CARTE.delai(qui, Math.ceil(notice.remaining), port)}
            <span className="n3-carte-reste" aria-hidden="true">
              {" "}
              {CARTE.restant(reste)}
            </span>
          </p>
        ) : null}
        <Actions>
          <Bouton
            id="confirmRecovery"
            plein
            inactif={occupe || reste > 0}
            onClick={() => onAction({ action: "finish", id: notice.id })}
          >
            {port === null ? CARTE.choisir : CARTE.prendre(port)}
          </Bouton>
          <Bouton
            id="annulerDemande"
            inactif={occupe}
            onClick={() => onAction({ action: "cancel", id: notice.id })}
          >
            {CARTE.annuler}
          </Bouton>
        </Actions>
      </>
    );
  } else if (sujet?.type === "autre") {
    entete = CARTE.estA(sujet.port, sujet.nom);
    corps = (
      <>
        <p className="n3-carte-phrase">{CARTE.delai(sujet.nom, sujet.delai, sujet.port)}</p>
        <Actions>
          <Bouton id="demanderPlace" plein onClick={() => onDemander(sujet.port)}>
            {CARTE.demander}
          </Bouton>
          <Bouton onClick={onFermer}>{CARTE.fermer}</Bouton>
        </Actions>
      </>
    );
  } else if (sujet?.type === "sans-nom") {
    entete = CARTE.tenue(sujet.port);
    corps = (
      <>
        <p className="n3-carte-phrase">{CARTE.personne}</p>
        <Actions>
          <Bouton id="reprendrePlace" plein onClick={() => onPrendre(sujet.port)}>
            {CARTE.reprendre(sujet.port)}
          </Bouton>
          <Bouton onClick={onFermer}>{CARTE.fermer}</Bouton>
        </Actions>
      </>
    );
  } else if (sujet?.type === "mienne") {
    entete = CARTE.ta(sujet.port);
    corps = (
      <>
        <p className="n3-carte-phrase">
          {CARTE.tuJoues(sujet.comment)} {CARTE.nom}
        </p>
        <Actions>
          {onRendre ? (
            <Bouton id="rendreMaPlace" onClick={onRendre}>
              {PLACE.rendre}
            </Bouton>
          ) : null}
          <Bouton onClick={onFermer}>{CARTE.fermer}</Bouton>
        </Actions>
      </>
    );
  } else {
    entete = "";
    corps = (
      <Actions>
        <Bouton onClick={onFermer}>{CARTE.fermer}</Bouton>
      </Actions>
    );
  }

  return (
    <section
      id={CARTE_PLACE}
      className="n3-carte rt-boite"
      aria-labelledby={entete ? "cartePlaceTitre" : undefined}
      data-port={port ?? undefined}
    >
      <i className="rt-ombre" aria-hidden="true" />
      {entete ? (
        <h2 id="cartePlaceTitre" ref={titre} tabIndex={-1} className="n3-carte-titre">
          {entete}
        </h2>
      ) : null}
      {corps}
      {erreur ? <p className="n3-carte-erreur">{erreur}</p> : null}
    </section>
  );
}

/** La piste du temps : une barre qui se vide, posée une fois en CSS. */
export function Piste({ secondes }: { secondes: number }) {
  return (
    <span className="n3-piste" aria-hidden="true">
      <i style={{ animationDuration: `${Math.max(0, secondes)}s` } as CSSProperties} />
    </span>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return <div className="n3-carte-actions">{children}</div>;
}

/** Un bouton de carte : la boîte du socle, pleine pour le geste principal.
 * `aria-disabled` plutôt que `disabled` : le bouton reste lisible et dans la
 * tabulation, le clic l'ignore. */
export function Bouton({
  id,
  plein = false,
  inactif = false,
  onClick,
  children,
}: {
  id?: string;
  plein?: boolean;
  inactif?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      className={
        plein
          ? "n3-carte-bouton rt-boite rt-bouton rt-bouton-plein"
          : "n3-carte-bouton rt-boite rt-bouton"
      }
      aria-disabled={inactif ? "true" : undefined}
      onClick={() => {
        if (!inactif) onClick();
      }}
    >
      <i className="rt-ombre" aria-hidden="true" />
      {children}
    </button>
  );
}
