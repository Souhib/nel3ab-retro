/** Le panneau « Touches et manettes » : une région de la salle, plus un
 * dialogue modal. Au bureau et en fenêtre étroite, il prend la place des
 * rangs de la colonne et ne passe pas devant l'image (D2) : pendant le
 * réglage, les autres jouent.
 *
 * Tenu en main, il a sa place depuis le 24 novembre 2026 : sous l'image
 * tenu droit, à droite d'elle en travers (`Geometrie.reglage`, `lib/cadre`).
 * Il vivait avant dans la feuille agrandie de la salle, qui couvrait l'image
 * (constat 4 de la relecture des manettes) ; l'étape `place-tenu` de
 * `reglage.mjs` le mesure.
 *
 * Le jeu de cette place reçoit un état neutre tant qu'il est ouvert (c'est la
 * salle qui le demande à la boucle d'entrée). Échap annule d'abord ce qui est
 * en cours, puis ferme. Le conteneur prend le focus (`tabIndex` -1) : un clic
 * sur un texte du panneau le garde dans le panneau, et les flèches qui
 * suivent ne partent pas au jeu (C12). */
import { useEffect, useReducer, useRef, useState } from "react";
import type { Hote } from "../../lib/cadre";
import { REGLAGE } from "../../lib/mots";
import { identify } from "../../media/families";
import { useArbitre } from "../../components/Cadre";
import type { Onglet } from "../entree";
import { ClavierDolphin, ManetteDolphin, ProfilsDolphin, type TrameDolphin } from "./Dolphin";
import type { Moment } from "./marques";
import { Onglets } from "./Onglets";
import { Bouton } from "./PasAPas";
import { ClavierPro, ManettePro, ProfilsPro, usePro, type TramePro } from "./Pro";
import { sonnerReglage } from "./sons";
import { suivreTenues } from "./tenues";
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
  /** Quand la salle ne vit pas : la phrase de l'état et son action, posées
   * par la salle (groupe états). L'action prend alors le seul bouton plein. */
  bande?: Bande | null;
};

export type Bande = { phrase: string; action?: { nom: string; faire: () => void } };

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

/** La scène « fier » à la fin d'un pas à pas, et les sons du socle qui a retenu quelque chose,
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
    const abonner = (ecoute: (evenement: Moment) => void) =>
      source ? source.surLecon(ecoute) : (input?.surReglage(ecoute) ?? (() => {}));
    const sans = sonnerReglage(abonner);
    const fin = abonner(surFin);
    return () => {
      sans();
      fin();
    };
  }, [source, input]);
}

/** La première manette que la page voit pendant que le panneau est ouvert :
 * une phrase, jamais une scène (K09, « arrivee » appartient aux personnes). */
function useArrivee(trame: TrameDolphin | TramePro): string | null {
  const [nom, setNom] = useState<string | null>(null);
  const input = trame.input;
  useEffect(
    () =>
      input.surReglage((evenement) => {
        if (evenement.type === "premiere-manette") setNom(identify(evenement.id, "").name);
      }),
    [input],
  );
  return nom;
}

/** Fait défiler le premier ancêtre qui défile pour que la tête du panneau
 * soit visible : en fenêtre étroite, la colonne sous l'image gardait le
 * défilement de la vue des touches, et le titre du panneau s'ouvrait caché
 * sous l'image (reglage.mjs, étape place, 860 × 900). */
export function montrerLaTete(panneau: HTMLElement): void {
  for (let el = panneau.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY !== "auto" && overflowY !== "scroll") continue;
    const ecart = panneau.getBoundingClientRect().top - el.getBoundingClientRect().top;
    if (ecart < 0) el.scrollTop += ecart;
    return;
  }
}

export function Reglage({
  onglet,
  onOnglet,
  onFermer,
  autres,
  vit,
  hote = "coin",
  trame,
  bande = null,
}: ReglageProps) {
  const racine = useRef<HTMLElement>(null);
  // Échap qui arrête un pas à pas Pro relit le panneau aussitôt : la trame
  // change sans le rendre, et la suite du focus doit exister à l'image
  // d'après.
  const [, relire] = useReducer((n: number) => n + 1, 0);
  usePro(trame.genre === "pro" ? trame : null);
  useFier(trame, vit, hote);
  const occupe = occupeDe(trame);
  const arrivee = useArrivee(trame);
  const place = trame.genre === "pro" ? trame.place : trame.state.port;
  // La ligne d'une commande tenue, posée hors de React (`tenues.ts`).
  useEffect(() => (racine.current ? suivreTenues(racine.current) : undefined), []);
  // Le focus entre par l'onglet ouvert : c'est lui qu'on lit en premier. Le
  // panneau prend la place d'une vue que la colonne avait pu faire défiler :
  // sa tête revient en haut de ce qu'on voit (`montrerLaTete`).
  useEffect(() => {
    document.getElementById(`onglet-${onglet}`)?.focus({ preventScroll: true });
    if (racine.current) montrerLaTete(racine.current);
    // À l'ouverture seulement : changer d'onglet garde le focus où il est.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const plein = !bande?.action;
  const contenu =
    trame.genre === "dolphin" ? (
      onglet === "manette" ? (
        <ManetteDolphin trame={trame} plein={plein} />
      ) : onglet === "clavier" ? (
        <ClavierDolphin trame={trame} />
      ) : (
        <ProfilsDolphin trame={trame} />
      )
    ) : onglet === "manette" ? (
      <ManettePro trame={trame} plein={plein} />
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
      data-place={place ?? undefined}
      tabIndex={-1}
      aria-labelledby="reglageTitre"
      className="n3-reglage"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        // Lu au moment de la touche : la trame Pro change sans rendre le
        // panneau, qui ne se relit que deux fois par seconde (`usePro`).
        if (!occupeDe(trame)) return onFermer();
        const retour = annuler(trame);
        relire();
        requestAnimationFrame(() => (document.getElementById(retour) ?? racine.current)?.focus());
      }}
    >
      <header className="n3-reglage-tete">
        <h2 id="reglageTitre">{REGLAGE.titre}</h2>
        <Bouton
          id="fermerReglage"
          onClick={() => {
            if (occupeDe(trame)) annuler(trame);
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
      {bande ? (
        <div className="n3-reglage-avis n3-bande" role="status" data-bande="">
          <p>{bande.phrase}</p>
          {bande.action ? (
            <div className="n3-reglage-gestes">
              <Bouton plein onClick={bande.action.faire}>
                {bande.action.nom}
              </Bouton>
            </div>
          ) : null}
        </div>
      ) : null}
      <Onglets onglet={onglet} inactifs={occupe} onChoisir={onOnglet} />
      {arrivee ? (
        <p role="status" data-arrivee="" className="n3-arrivee">
          {REGLAGE.arrivee(arrivee)}
        </p>
      ) : null}
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
