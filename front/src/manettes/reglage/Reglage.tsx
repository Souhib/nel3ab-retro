/** Le panneau « Touches et manettes » : une région de la salle, plus un
 * dialogue modal. Il prend la place des rangs de la colonne et ne passe
 * jamais devant l'image (D2) : pendant le réglage, les autres jouent.
 *
 * Le jeu de cette place reçoit un état neutre tant qu'il est ouvert (c'est la
 * salle qui le demande à la boucle d'entrée). Échap annule d'abord ce qui est
 * en cours, puis ferme. Le conteneur prend le focus (`tabIndex` -1) : un clic
 * sur un texte du panneau le garde dans le panneau, et les flèches qui
 * suivent ne partent pas au jeu (C12). */
import { useEffect, useRef } from "react";
import type { Hote } from "../../lib/cadre";
import { REGLAGE } from "../../lib/mots";
import { useArbitre } from "../../components/Cadre";
import type { Onglet } from "../entree";
import { ClavierDolphin, ManetteDolphin, ProfilsDolphin, type TrameDolphin } from "./Dolphin";
import { Onglets } from "./Onglets";
import { Bouton } from "./PasAPas";
import { ClavierPro, ManettePro, ProfilsPro, usePro, type TramePro } from "./Pro";
import "./reglage.css";

export type ReglageProps = {
  onglet: Onglet;
  onOnglet: (onglet: Onglet) => void;
  onFermer: () => void;
  /** Une partie tourne et une autre place est tenue. */
  autres: boolean;
  /** La salle vit : la scène de fin ne joue jamais pendant une panne, au
   * repos ou au démarrage. */
  vit: boolean;
  /** Où la mascotte joue la fin du pas à pas (`ouEstLaMascotte`). */
  hote?: Hote | null;
  trame: TrameDolphin | TramePro;
};

/** Un pas à pas ou un changement en cours. */
export const occupeDe = (trame: TrameDolphin | TramePro): boolean =>
  trame.genre === "dolphin"
    ? trame.state.capturing !== null || trame.state.lesson !== null
    : Boolean(trame.source.capturing || trame.source.lecon);

/** Annule ce qui est en cours et rend l'identifiant du bouton qui reprend le
 * focus : « Changer » de la ligne attendue, ou « Régler pas à pas ». */
function annuler(trame: TrameDolphin | TramePro): string {
  if (trame.genre === "dolphin") {
    const capture = trame.state.capturing;
    trame.input.cancelCapture();
    trame.refresh();
    if (!capture) return "learnPad";
    return `${capture.source}-${capture.control}${capture.source === "key" && capture.sign === -1 ? "-" : ""}`;
  }
  const capture = trame.source.capturing;
  trame.source.cancel();
  trame.source.arreterLecon();
  return capture ? `${capture.source}-${capture.target}` : "learnPad";
}

/** La scène « fier » à la fin d'un pas à pas qui a retenu quelque chose,
 * seulement quand la salle vit (K07). Une manette qui arrive ne joue rien :
 * « arrivee » appartient aux personnes (K09). */
function useFier(trame: TrameDolphin | TramePro, vit: boolean, hote: Hote | null) {
  const arbitre = useArbitre();
  const vivant = useRef({ vit, hote, arbitre });
  vivant.current = { vit, hote, arbitre };
  const source = trame.genre === "pro" ? trame.source : null;
  const input = trame.genre === "dolphin" ? trame.input : null;
  useEffect(() => {
    const surFin = (evenement: { type: string; resultat?: { retenues: number } }) => {
      const { vit: enVie, hote: ou, arbitre: juge } = vivant.current;
      if (evenement.type !== "fin" || !evenement.resultat?.retenues || !enVie || !ou) return;
      juge?.demander({ scene: "fier", par: "manettes", hote: ou });
    };
    if (source) return source.surLecon(surFin);
    return input?.surReglage(surFin);
  }, [source, input]);
}

export function Reglage({
  onglet,
  onOnglet,
  onFermer,
  autres,
  vit,
  hote = "coin",
  trame,
}: ReglageProps) {
  const racine = useRef<HTMLElement>(null);
  usePro(trame.genre === "pro" ? trame : null);
  useFier(trame, vit, hote);
  const occupe = occupeDe(trame);
  // Le focus entre par l'onglet ouvert : c'est lui qu'on lit en premier.
  useEffect(() => {
    document.getElementById(`onglet-${onglet}`)?.focus();
    // À l'ouverture seulement : changer d'onglet garde le focus où il est.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const contenu =
    trame.genre === "dolphin" ? (
      onglet === "manette" ? (
        <ManetteDolphin trame={trame} />
      ) : onglet === "clavier" ? (
        <ClavierDolphin trame={trame} />
      ) : (
        <ProfilsDolphin trame={trame} />
      )
    ) : onglet === "manette" ? (
      <ManettePro trame={trame} />
    ) : onglet === "clavier" ? (
      <ClavierPro trame={trame} />
    ) : (
      <ProfilsPro trame={trame} />
    );
  return (
    <section
      ref={racine}
      id="reglage"
      data-reglage=""
      data-occupe={occupe ? "oui" : "non"}
      tabIndex={-1}
      aria-labelledby="reglageTitre"
      className="n3-reglage"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (!occupe) return onFermer();
        const retour = annuler(trame);
        requestAnimationFrame(() => (document.getElementById(retour) ?? racine.current)?.focus());
      }}
    >
      <header className="n3-reglage-tete">
        <h2 id="reglageTitre">{REGLAGE.titre}</h2>
        <Bouton
          id="fermerReglage"
          onClick={() => {
            if (occupe) annuler(trame);
            onFermer();
          }}
        >
          {REGLAGE.fermer}
        </Bouton>
        <p>
          {REGLAGE.tete(trame.genre === "pro" ? trame.console : null)}
          {autres ? ` ${REGLAGE.autres}` : ""}
        </p>
      </header>
      <Onglets onglet={onglet} inactifs={occupe} onChoisir={onOnglet} />
      <div
        role="tabpanel"
        id={`page-${onglet}`}
        aria-labelledby={`onglet-${onglet}`}
        className="n3-reglage-page"
      >
        {contenu}
      </div>
    </section>
  );
}
