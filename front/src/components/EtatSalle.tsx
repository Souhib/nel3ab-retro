/**
 * L'état de la salle, à UN seul endroit: sur l'image.
 *
 * Avant le 22 novembre 2026, trois écrans se partageaient le sujet et aucun ne
 * voyait le gel: « Récupération de l'image » couvrait toute la page, colonne
 * comprise; « connexion à la salle » racontait un démarrage qui n'avait pas eu
 * lieu; la proposition de format réduit vivait dans la colonne, que le
 * téléphone replie d'office. L'état se décide maintenant dans la couche média
 * (`media/liaison.ts`), ses mots dans `lib/liaison-mots.ts`, et ce composant ne
 * fait que les poser dans `<main>`.
 *
 * Bobine porte le message, comme le propriétaire l'a voulu: une interface
 * portée par un personnage, présent aussi dans les moments durs.
 */
import { useEffect, useRef } from "react";
import { Bobine } from "../bobine/Bobine";
import type { GardeSignalement } from "../lib/garde-signalement";
import { dire, type Action } from "../lib/liaison-mots";
import { SORTIES } from "../lib/mots";
import type { Liaison } from "../media/liaison";
import { Signaler } from "./Signaler";
import "./etat-salle.css";

const horloge = (secondes: number) =>
  `${String(Math.floor(secondes / 60)).padStart(2, "0")}:${String(secondes % 60).padStart(2, "0")}`;

/** Où l'image est posée dans `<main>`, en pixels: le bandeau se pose SUR
 * elle, jamais sur les bandes noires où vit la manette à l'écran. */
export type Cadre = { top: number; left: number; width: number; height: number };

export function EtatSalle({
  liaison,
  salle,
  moteur = null,
  cadre = null,
  onRelancer,
  onReessayer,
  onQuitter,
  onSignaler,
  garde,
  onReduire,
  onGarder,
  onPropositionVue,
}: {
  liaison: Liaison;
  salle: number;
  /** Le moteur de la console du jeu: le prix de l'image légère n'est un
   * chiffre que là où il a été mesuré (`mots.prixImageLegere`). */
  moteur?: string | null;
  /** Le rectangle de l'image, ou `null` quand elle n'a pas encore de taille:
   * l'état prend alors toute la zone. Mesuré sur un téléphone en portrait le
   * 22 novembre 2026: posé en haut de `<main>`, le bandeau couvrait la rangée
   * des gâchettes de la manette à l'écran; en paysage, il débordait sur LB et
   * RB. */
  cadre?: Cadre | null;
  /** Une socket vidéo neuve, la place gardée. */
  onRelancer: () => void;
  /** Réessayer tout de suite, sans attendre la prochaine tentative. */
  onReessayer: () => void;
  /** Quitter la salle, comme le bouton de la colonne. */
  onQuitter: () => void;
  /** Poser un repère au journal, avec les deux dernières minutes. */
  onSignaler: () => Promise<void>;
  /** Le garde de vingt secondes de la page, le même que celui de la colonne. */
  garde: GardeSignalement;
  onReduire: () => void;
  onGarder: () => void;
  /** La proposition de format réduit vient d'être AFFICHÉE. C'est le seul
   * moment où le journal peut écrire « proposé » (audit E3). */
  onPropositionVue: () => void;
}) {
  const dit = dire(liaison, salle, moteur);
  if (dit.niveau === "rien") return null;

  const geste = (action: Action) => {
    switch (action) {
      case "relancer":
        return (
          <button
            key={action}
            type="button"
            id="relancerImage"
            className="n3-action primary"
            onClick={onRelancer}
          >
            Relancer l&apos;image
          </button>
        );
      case "signaler":
        return (
          <Signaler
            key={action}
            id="signalerEtat"
            variante="bandeau"
            garde={garde}
            onComplain={onSignaler}
          />
        );
      case "reessayer":
        return (
          <button
            key={action}
            type="button"
            id="reessayer"
            className="n3-action primary"
            onClick={onReessayer}
          >
            Réessayer
          </button>
        );
      case "quitter":
        return (
          <button
            key={action}
            type="button"
            id="quitterSalle"
            className="n3-action"
            onClick={onQuitter}
          >
            {SORTIES.quitter}
          </button>
        );
      case "salles":
        // Vers la liste, à la racine du domaine: le salon sert toutes les
        // salles depuis là (voir `lib/base`).
        return (
          <a key={action} href="/" id="lesSalles" className="n3-action primary">
            Les salles
          </a>
        );
      case "reduire":
        return (
          <button
            key={action}
            type="button"
            id="takeHalf"
            className="n3-action primary"
            onClick={onReduire}
          >
            Passer en réduit
          </button>
        );
      case "garder":
        return (
          <button key={action} type="button" id="keepFull" className="n3-action" onClick={onGarder}>
            Non merci
          </button>
        );
    }
  };

  /** Le cadre de l'image: tout ce qui n'est pas le rideau s'y pose. */
  const surImage = (contenu: React.ReactNode) => (
    <div className="n3-etat-cadre" style={cadre ?? { inset: 0 }}>
      {contenu}
    </div>
  );

  if (dit.niveau === "pastille")
    return surImage(
      <div id="liaison" data-etat={liaison.etat} className="n3-etat-pastille regie-nuit">
        <span>{dit.titre}</span>
        {dit.compteur !== undefined ? (
          <span className="n3-etat-horloge">{horloge(dit.compteur)}</span>
        ) : null}
      </div>,
    );

  if (dit.niveau === "proposition")
    return surImage(
      <Proposition onVue={onPropositionVue}>
        <p className="n3-etat-titre">{dit.titre}</p>
        {dit.detail ? <p className="n3-etat-detail">{dit.detail}</p> : null}
        <div className="n3-etat-actions">{dit.actions.map(geste)}</div>
      </Proposition>,
    );

  const carte = (taille: number) => (
    <section className="n3-etat-carte" aria-labelledby="liaisonTitre">
      <div className="n3-etat-bob">
        <Bobine
          pose={dit.pose}
          taille={taille}
          tenue={dit.pose === "loupe" ? "loupe" : undefined}
        />
      </div>
      <div className="n3-etat-bulle">
        <p id="liaisonTitre" className="n3-etat-titre">
          {dit.titre}
        </p>
        {dit.etapes ? (
          <ol className="n3-etat-etapes">
            {dit.etapes.map((etape) => (
              <li key={etape.texte} data-fait={etape.fait}>
                <span className="n3-etat-marque" aria-hidden="true">
                  {etape.fait ? "✓" : "·"}
                </span>
                {etape.texte}
              </li>
            ))}
          </ol>
        ) : null}
        {dit.detail ? <p className="n3-etat-detail">{dit.detail}</p> : null}
        {dit.actions.length ? (
          <div className="n3-etat-actions">{dit.actions.map(geste)}</div>
        ) : null}
      </div>
    </section>
  );

  if (dit.niveau === "rideau")
    return (
      <div
        id="arrivee"
        data-etat={liaison.etat}
        data-perdue={
          liaison.etat === "arrivee"
            ? liaison.perdue
            : liaison.etat === "injoignable"
              ? true
              : undefined
        }
        className="n3-etat-rideau regie-nuit"
      >
        {carte(96)}
      </div>
    );

  return surImage(
    <div id="liaison" data-etat={liaison.etat} className="n3-etat regie-nuit">
      {carte(64)}
    </div>,
  );
}

/** La proposition, et le seul endroit où elle se dit « vue ». Un effet au
 * montage et pas au rendu: un rendu peut être jeté, un montage a eu lieu. */
function Proposition({ onVue, children }: { onVue: () => void; children: React.ReactNode }) {
  const vue = useRef(onVue);
  vue.current = onVue;
  useEffect(() => vue.current(), []);
  return (
    <div id="rough" data-etat="irreguliere" className="n3-etat-proposition regie-nuit">
      {children}
    </div>
  );
}
