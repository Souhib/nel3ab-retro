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
import { CARTE, PLACE } from "../lib/mots";
import type { MenuAction } from "../media/menupad";
import { useReste } from "../lib/usePlaces";
import { echapFermeLaCarte, type Reprise } from "../lib/places";
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
  /** La reprise en cours, venue du salon. La carte ne lit que celle où je
   * demande (`asking`) ; celle qui vise ma place est à `DemandeRecue`. */
  notice: Reprise | null;
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
  const boite = useRef<HTMLElement>(null);
  /* La demande, seulement quand c'est la mienne. Le salon envoie la même
     raison (refus, annulation, expiration, reprise faite) à qui demande ET à
     qui tient la place (`recovery.py`, `notify`). Montée pour qui tient la
     place, la carte prenait le focus à la zone de jeu et proposait « Prendre
     la place 3 » d'une place libre (relecture du 24 novembre 2026) : pour
     lui, la ligne parlée dit la fin (`useDireLaReprise`), sans carte. */
  const demande = notice !== null && notice.asking ? notice : null;
  const attente = demande !== null && demande.reason === null;
  const reste = useReste(attente ? demande.remaining : 0, demande?.id ?? "");
  const ouverte = sujet !== null || demande !== null || erreur !== "";
  const port = demande?.port ?? sujet?.port ?? null;
  /* « Fermer » et Échap rendent le focus à la place qui a ouvert la carte,
     « Prendre » le pose sur la place prise (plan personnes, places-demande
     1, A11Y-09). La place reste montée (clé stable par numéro) : le focus
     posé avant que la carte se démonte ne tombe pas sur le corps de page. */
  const fermer = () => {
    onFermer();
    if (port !== null) placeDe(port)?.focus();
  };
  const prendre = (n: number) => {
    onPrendre(n);
    placeDe(n)?.focus();
  };
  const fermerParEchap = useRef(fermer);
  fermerParEchap.current = fermer;

  useEffect(() => {
    if (ouverte && focus) titre.current?.focus();
    // Le focus se pose à l'ouverture, pas à chaque seconde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouverte, sujet?.port, demande?.id]);

  // Seul le geste qui ne coûte rien passe par la manette : A confirme une
  // reprise devenue possible. Demander ou rendre reste un geste délibéré.
  useEffect(() => {
    if (!pad || !attente) return;
    pad((action) => {
      if (action === "confirm" && reste === 0) onAction({ action: "finish", id: demande.id });
    });
    return () => pad(null);
  }, [pad, attente, reste, demande, onAction]);

  /* Échap ferme la carte quand le focus est dedans ou sur sa place ;
     ailleurs il garde son sens, le menu du jeu, que la salle ouvre depuis
     `window` : on l'arrête au document pour qu'il n'y arrive pas. Pendant une
     demande en attente, la carte n'a pas de « Fermer » : Échap n'y annule
     rien, il faut le geste « Annuler ». */
  useEffect(() => {
    if (!ouverte || attente) return;
    const touche = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const place = port === null ? null : placeDe(port);
      if (!echapFermeLaCarte(document.activeElement, boite.current, place)) return;
      event.preventDefault();
      event.stopPropagation();
      fermerParEchap.current();
    };
    document.addEventListener("keydown", touche);
    return () => document.removeEventListener("keydown", touche);
  }, [ouverte, attente, port]);

  if (!ouverte) return null;
  const qui = demande?.to ?? (sujet?.type === "autre" ? sujet.nom : "");

  let corps: ReactNode;
  let entete: string;
  if (demande !== null && demande.reason !== null) {
    entete = demande.reason;
    corps = (
      <Actions>
        {libre !== null ? (
          <Bouton plein onClick={() => prendre(libre)}>
            {CARTE.prendre(libre)}
          </Bouton>
        ) : null}
        <Bouton onClick={fermer}>{CARTE.fermer}</Bouton>
      </Actions>
    );
  } else if (attente) {
    /* Trois lectures d'un reste à 0, et une seule est un silence : le
       compte local fini alors que le salon donnait encore du temps. Un
       « Donner ma place » arrive avec `remaining` 0 et `accepted` ; sans ce
       champ (salon d'avant le 24 novembre 2026), la carte ne prétend ni
       l'un ni l'autre. */
    entete =
      reste > 0
        ? CARTE.chezLui(qui)
        : demande.accepted === true
          ? CARTE.laisse(qui, port)
          : demande.remaining > 0
            ? CARTE.silence(qui)
            : CARTE.peux(port);
    corps = (
      <>
        {reste > 0 ? <Piste secondes={demande.remaining} /> : null}
        {reste > 0 && port !== null ? (
          <p className="n3-carte-phrase">
            {CARTE.delai(qui, Math.ceil(demande.remaining), port)}
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
            onClick={() => onAction({ action: "finish", id: demande.id })}
          >
            {port === null ? CARTE.choisir : CARTE.prendre(port)}
          </Bouton>
          <Bouton
            id="annulerDemande"
            inactif={occupe}
            onClick={() => onAction({ action: "cancel", id: demande.id })}
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
          <Bouton onClick={fermer}>{CARTE.fermer}</Bouton>
        </Actions>
      </>
    );
  } else if (sujet?.type === "sans-nom") {
    entete = CARTE.tenue(sujet.port);
    corps = (
      <>
        <p className="n3-carte-phrase">{CARTE.personne}</p>
        <Actions>
          <Bouton id="reprendrePlace" plein onClick={() => prendre(sujet.port)}>
            {CARTE.reprendre(sujet.port)}
          </Bouton>
          <Bouton onClick={fermer}>{CARTE.fermer}</Bouton>
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
          <Bouton onClick={fermer}>{CARTE.fermer}</Bouton>
        </Actions>
      </>
    );
  } else {
    entete = "";
    corps = (
      <Actions>
        <Bouton onClick={fermer}>{CARTE.fermer}</Bouton>
      </Actions>
    );
  }

  return (
    <section
      ref={boite}
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

/** La place START d'un numéro, montée par `Places` (`#portN`). */
function placeDe(n: number): HTMLElement | null {
  return document.getElementById(`port${n}`);
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
