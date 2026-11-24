/**
 * L'état de la salle, HORS de l'image (ADR D40).
 *
 * Jusqu'au 24 novembre 2026, Bobine disait l'état sur l'image : un bandeau
 * posé sur la dernière image, un rideau à l'arrivée, une proposition en bas.
 * Le thème rétro tient une règle plus dure : rien ne passe sur une image qui
 * bouge. L'état se dit donc en trois pièces, chacune à sa place :
 *
 * - la pastille (`EtatPastille`) : un voyant de borne dans une bande noire,
 *   sur le panneau de commande, dans la bande ou en haut de la manette ;
 * - la fiche (`FicheEtat`) : la phrase, le fait et le geste, en tête de la
 *   colonne, dans la bande du téléphone ou dans la feuille ;
 * - le plein cadre (`PleinCadre`) : l'écran noir de la borne quand il n'y a
 *   pas d'image du tout. Il ne se montre que sous le jeton « plein » de la
 *   couverture (`media/couverture.ts`), et la première image peinte le retire
 *   dans la boucle de peinture, sans attendre ce composant.
 *
 * Le modèle vient de `lib/etat-modele.ts`, les mots de `lib/liaison-mots.ts`,
 * la scène d'Aïn de `lib/etat-scene.ts` ; ici, on ne fait que poser.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import type { Hote } from "../lib/cadre";
import { effetActif, mouvementReduit } from "../lib/effets";
import type { Modele } from "../lib/etat-modele";
import { alerteDEntree, sceneDeTransition, type Moment } from "../lib/etat-scene";
import type { GardeSignalement } from "../lib/garde-signalement";
import type { Action } from "../lib/liaison-mots";
import { enBouton, ETAT, IMAGE, SORTIES } from "../lib/mots";
import { armer, retirer, vues, type Jeton } from "../media/couverture";
import { faireNeiger, mondeDe } from "../media/neige";
import { poserCalquesAttente } from "../retro/calques";
import { ecrireChiffres, poserAfficheur } from "../retro/chiffres";
import { iconePixelSVG } from "../retro/icones";
import { secouer } from "../retro/secousse";
import { sonMenu } from "../retro/sons";
import { useArbitre } from "./Cadre";
import { TitreColonne } from "./Colonne";
import { Etiquette } from "./Etiquette";
import { Signaler } from "./Signaler";
import "./etat-salle.css";

/** Ce que les gestes d'un état font. */
export type Rappels = {
  onRelancer: () => void;
  onReessayer: () => void;
  onQuitter: () => void;
  /** Poser un repère au journal, avec les deux dernières minutes. */
  onSignaler: () => Promise<void>;
  /** Le garde de vingt secondes de la page, le même que celui de la colonne. */
  garde: GardeSignalement;
  onReduire: () => void;
  /** « Non merci » à la proposition de l'image légère. */
  onGarder: () => void;
  /** « Je reste » : la salle compte la place comme active. */
  onRester: () => void;
  /** Revenir en image complète après un passage automatique. */
  onRevenir: () => void;
  /** Garder l'image légère passée d'elle-même. */
  onGarderLegere: () => void;
};

const classeGeste = (plein: boolean) =>
  `rt-boite rt-bouton n3-geste${plein ? " rt-bouton-plein" : ""}`;

/** Un bouton de borne : sa boîte, son ombre dure, son mot en Pixelify. */
function Bouton({
  id,
  plein,
  onClick,
  children,
}: {
  id: string;
  plein: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" id={id} onClick={onClick} className={classeGeste(plein)}>
      <i className="rt-ombre" aria-hidden="true" />
      {children}
    </button>
  );
}

/** Les gestes d'un état, et Signaler à côté quand le modèle l'y met. Le
 * premier geste est le plein, sauf quand Signaler le devient. */
function Gestes({ modele, rappels }: { modele: Modele; rappels: Rappels }) {
  const signalerPlein = modele.signaler === "plein";
  const geste = (action: Action, rang: number) => {
    const plein = rang === 0 && !signalerPlein;
    const bouton = (id: string, onClick: () => void, mot: string) => (
      <Bouton key={action} id={id} plein={plein} onClick={onClick}>
        {mot}
      </Bouton>
    );
    switch (action) {
      case "relancer":
        return bouton("relancerImage", rappels.onRelancer, ETAT.relancer);
      case "reessayer":
        return bouton("reessayer", rappels.onReessayer, ETAT.reessayer);
      case "quitter":
        return bouton("quitterSalle", rappels.onQuitter, SORTIES.quitter);
      case "salles":
        // Vers la liste, à la racine du domaine : le salon sert toutes les
        // salles depuis là (voir `lib/base`).
        return (
          <a key={action} href="/" id="lesSalles" className={classeGeste(plein)}>
            <i className="rt-ombre" aria-hidden="true" />
            {enBouton(SORTIES.autres)}
          </a>
        );
      case "carnet":
        // Le carnet du salon, au tableau des dernières parties (D12) : qui a
        // joué et qui a regardé ce soir.
        return (
          <a
            key={action}
            href="/profil#parties"
            id="dernieresParties"
            className={classeGeste(plein)}
          >
            <i className="rt-ombre" aria-hidden="true" />
            {enBouton(ETAT.parties)}
          </a>
        );
      case "reduire":
        return bouton("takeHalf", rappels.onReduire, IMAGE.passer);
      case "garder":
        return bouton("keepFull", rappels.onGarder, ETAT.nonMerci);
      case "rester":
        return bouton("jeReste", rappels.onRester, ETAT.rester);
      case "revenir":
        return bouton("undoReduced", rappels.onRevenir, ETAT.revenir);
      case "garder-legere":
        return bouton("keepReduced", rappels.onGarderLegere, ETAT.garder);
    }
  };
  const signaler =
    modele.signaler === "a-cote" || signalerPlein ? (
      <Signaler
        id="signalerEtat"
        variante="fiche"
        court
        garde={rappels.garde}
        onComplain={rappels.onSignaler}
      />
    ) : null;
  if (modele.actions.length === 0 && signaler === null) return null;
  return (
    <div className="n3-etat-gestes" data-signaler-plein={signalerPlein || undefined}>
      {signalerPlein ? signaler : null}
      {modele.actions.map(geste)}
      {signalerPlein ? null : signaler}
    </div>
  );
}

/** Une durée en secondes, en chiffres d'afficheur, qui avance sans être lue :
 * la ligne parlée dit l'état, pas son compteur. */
function Compteur({ secondes }: { secondes: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const valeur = useRef<HTMLElement | null>(null);
  const texte = `${secondes} s`;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (valeur.current === null) valeur.current = poserAfficheur(el, texte);
    else ecrireChiffres(valeur.current, texte);
  }, [texte]);
  return <span ref={ref} className="n3-pastille-compteur" aria-hidden="true" />;
}

/**
 * La pastille : un voyant de borne, hors de l'image peinte. Quand une fiche
 * existe, c'est un bouton qui mène à son geste (`onAller`) ; seule, c'est un
 * voyant. Le point porte l'ancre « prise » d'Aïn, qui s'y rebranche.
 */
export function EtatPastille({ modele, onAller }: { modele: Modele; onAller?: () => void }) {
  const p = modele.pastille;
  if (p === null) return null;
  const contenu = (
    <>
      <span className="n3-pastille-point" data-ancre="prise" aria-hidden="true" />
      <span
        className="n3-pastille-icone"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: iconePixelSVG(p.icone) }}
      />
      <span className="n3-pastille-texte">{p.texte}</span>
      {p.compteur !== undefined ? <Compteur secondes={p.compteur} /> : null}
    </>
  );
  const commun = {
    id: "pastilleEtat",
    "data-etat": modele.id,
    "data-offre": p.offre ? "" : undefined,
    className: "n3-pastille",
  };
  if (modele.niveau === "fiche" && onAller)
    return (
      <button type="button" {...commun} onClick={onAller}>
        {contenu}
      </button>
    );
  return <div {...commun}>{contenu}</div>;
}

/**
 * La fiche : une boîte de dialogue de jeu hors de l'image, avec la phrase, le
 * fait, le geste et ce qu'il coûte. `#rough` pour la proposition de l'image
 * légère, `#liaison` pour tout le reste.
 *
 * `onPropositionVue` : la proposition vient d'être MONTÉE, donc vue. C'est le
 * seul moment où le journal peut écrire « proposé » (audit E3) : en paysage,
 * quand la feuille s'ouvre sur elle, pas quand la pastille paraît.
 *
 * `onFocusPerdu` : un geste focalisé est parti avec la fiche (l'image est
 * revenue, l'état a changé) et le focus est retombé sur le document. La page
 * le rend au jeu ; ce que la personne a choisi ailleurs garde son focus.
 */
export function FicheEtat({
  modele,
  rappels,
  onPropositionVue,
  onFocusPerdu,
}: {
  modele: Modele;
  rappels: Rappels;
  onPropositionVue: () => void;
  onFocusPerdu?: () => void;
}) {
  if (modele.niveau !== "fiche") return null;
  return (
    <Fiche
      modele={modele}
      rappels={rappels}
      onPropositionVue={onPropositionVue}
      onFocusPerdu={onFocusPerdu}
    />
  );
}

function Fiche({
  modele,
  rappels,
  onPropositionVue,
  onFocusPerdu,
}: {
  modele: Modele;
  rappels: Rappels;
  onPropositionVue: () => void;
  onFocusPerdu?: () => void;
}) {
  const proposition = modele.id === "irreguliere";
  const ref = useRef<HTMLElement>(null);
  const perdu = useRef(onFocusPerdu);
  perdu.current = onFocusPerdu;
  // Avant que React ne retire un geste (ou la fiche entière), la boîte est
  // encore là : si elle tient le focus, on regarde après le retrait où il
  // est tombé. Sur le document, il retourne au jeu (focus.mjs,
  // fiche-focus-rendu, 24 novembre 2026 : il restait sur <body>).
  const gestes = modele.actions.join(" ");
  useLayoutEffect(() => {
    const boite = ref.current;
    return () => {
      if (boite === null || !boite.contains(document.activeElement)) return;
      queueMicrotask(() => {
        const ici = document.activeElement;
        if (ici === null || ici === document.body) perdu.current?.();
      });
    };
  }, [modele.id, gestes, modele.signaler]);
  // L'état d'avant, tant que la fiche est montée : une fiche montée plus
  // tard (la feuille qu'on ouvre) n'est pas une entrée dans la panne.
  const avant = useRef<string | null>(null);
  useEffect(() => {
    if (avant.current !== null && alerteDEntree(avant.current, modele.id) && ref.current)
      secouer(ref.current);
    avant.current = modele.id;
  }, [modele.id]);
  return (
    <section
      ref={ref}
      id={proposition ? "rough" : "liaison"}
      data-etat={modele.id}
      data-offre={modele.pastille?.offre ? "" : undefined}
      className="n3-fiche rt-boite"
      aria-labelledby="liaisonTitre"
    >
      <i className="rt-ombre" aria-hidden="true" />
      {proposition ? <Vue onVue={onPropositionVue} /> : null}
      <p id="liaisonTitre" className="n3-fiche-titre" data-texte="">
        {modele.titre}
      </p>
      {modele.detail ? (
        <p className="n3-fiche-fait" data-texte="">
          {modele.detail}
        </p>
      ) : null}
      <Gestes modele={modele} rappels={rappels} />
      {modele.cout ? (
        <p className="n3-fiche-cout" data-texte="">
          {modele.cout}
        </p>
      ) : null}
      {modele.voit ? (
        <details id="ceQueTaPageVoit" className="n3-fiche-voit">
          <summary>{ETAT.voit}</summary>
          <ul>
            {modele.voit.map((ligne) => (
              <li key={ligne.quoi}>{`${ligne.quoi} : ${ligne.vu}`}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {modele.signaler === "derniere-ligne" ? (
        <Signaler
          id="signalerEtat"
          variante="fiche"
          garde={rappels.garde}
          onComplain={rappels.onSignaler}
        />
      ) : null}
    </section>
  );
}

/** Un effet au montage et pas au rendu : un rendu peut être jeté, un montage
 * a eu lieu. */
function Vue({ onVue }: { onVue: () => void }) {
  const vue = useRef(onVue);
  vue.current = onVue;
  useEffect(() => vue.current(), []);
  return null;
}

/**
 * Le plein cadre de la borne : l'écran noir, dans les deux thèmes, quand il
 * n'y a pas d'image du tout. Le titre en Pixelify, les étapes de l'arrivée,
 * le fait, les gestes ; Aïn en grand sur son plateau ; les lignes du tube
 * selon le niveau d'effets.
 *
 * Il ne se montre que sous le jeton « plein » (`etat-salle.css`) : armé par
 * `useCouverture` dans le même rendu, levé par la première image peinte dans
 * la boucle de peinture. `Ouverture.tsx` (le salon) garde les classes de
 * l'ancien rideau jusqu'à ce qu'il le reprenne.
 */
export function PleinCadre({ modele, rappels }: { modele: Modele; rappels: Rappels }) {
  if (modele.niveau !== "plein") return null;
  return <PleinCadreMonte modele={modele} rappels={rappels} />;
}

function PleinCadreMonte({ modele, rappels }: { modele: Modele; rappels: Rappels }) {
  // L'état à l'apparition du plein cadre, et lui seul, décide de la coupure :
  // une salle qui répond de nouveau après une panne ne change pas de chaîne.
  const premier = useRef(modele.id);
  return (
    <div
      id="arrivee"
      data-etat={modele.id}
      data-perdue={modele.actions.length > 0 || undefined}
      className="n3-plein regie-nuit"
    >
      {premier.current === "arrivee" ? <Coupure /> : null}
      <EcranNoir>
        {modele.id === "fermee" ? <i className="n3-extinction" aria-hidden="true" /> : null}
        <h2 className="n3-plein-titre" data-texte="">
          {modele.titre}
        </h2>
        {modele.etapes ? (
          <ol className="n3-plein-etapes">
            {modele.etapes.map((etape) => (
              <li key={etape.texte} data-fait={etape.fait}>
                <span className="n3-plein-marque" aria-hidden="true" />
                {etape.texte}
                <span className="sr-only">, {etape.fait ? ETAT.fait : ETAT.enCours}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {modele.detail ? (
          <p className="n3-plein-fait" data-texte="">
            {modele.detail}
          </p>
        ) : null}
        <Gestes modele={modele} rappels={rappels} />
        {modele.cout ? (
          <p className="n3-plein-cout" data-texte="">
            {modele.cout}
          </p>
        ) : null}
      </EcranNoir>
      <div className="n3-plein-plateau" data-hote="plateau" aria-hidden="true" />
    </div>
  );
}

/**
 * « Ce soir dans la salle N » : ce qu'une salle fermée garde dans la colonne,
 * à la place de « Ils regardent » et du bloc de rôle. Le jeu, et ceux qui
 * regardaient au moment de la fermeture, en étiquettes tapées. Ceux qui ont
 * joué sont sur le panneau, au passé : la colonne ne les répète pas. Le
 * carnet est sur l'écran, une seule fois. La durée de la partie attend D11 :
 * une absence ne se montre pas comme un zéro.
 */
export function CeSoir({
  salle,
  jeu,
  regardaient,
}: {
  salle: number;
  jeu: string | null;
  regardaient: readonly string[];
}) {
  return (
    <section id="ceSoir" aria-labelledby="ceSoirTitre" className="flex flex-col gap-1.5">
      <TitreColonne id="ceSoirTitre">{ETAT.ceSoir(salle)}</TitreColonne>
      {jeu ? <p className="truncate text-corps text-muted">{jeu}</p> : null}
      {regardaient.length > 0 ? (
        <>
          <p className="text-corps text-muted">{ETAT.ontRegarde}</p>
          <ul className="flex flex-wrap gap-1.5">
            {/* Deux personnes peuvent porter le même surnom. */}
            {regardaient.map((nom, i) => (
              <li key={`${i}-${nom}`} className="flex min-w-0">
                <Etiquette nom={nom} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/** L'écran noir, et les lignes du tube posées une fois sur lui (balayage,
 * vignette, roulement), refusées d'office sur l'image du jeu. */
function EcranNoir({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => (ref.current ? poserCalquesAttente(ref.current) : undefined), []);
  return (
    <div ref={ref} className="n3-plein-ecran">
      {children}
    </div>
  );
}

/** La durée de l'effet « coupure », comme la transition du socle. */
export const COUPURE_MS = 250;

/**
 * L'effet « coupure » (niveau « tout ») : un quart de seconde de neige à
 * l'entrée dans le plein cadre « Connexion », comme en changeant de chaîne
 * pour la salle. Il ne se montre que sous le jeton « coupure » : la première
 * image peinte le lève avec le plein cadre, et il se retire seul au bout de
 * `COUPURE_MS`. Jamais à l'entrée d'une panne, où une vraie coupure peut
 * arriver ; rien en mouvement réduit.
 */
function Coupure() {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (!effetActif("coupure") || mouvementReduit()) return;
    if (!armer("coupure", vues())) return;
    const arret = ref.current ? faireNeiger(ref.current, mondeDe("coupure")) : () => {};
    const fin = window.setTimeout(() => retirer("coupure"), COUPURE_MS);
    return () => {
      window.clearTimeout(fin);
      arret();
      retirer("coupure");
    };
  }, []);
  return <canvas ref={ref} className="n3-coupure" width={120} height={75} aria-hidden="true" />;
}

/** La neige d'une connexion coupée, sur le rectangle de l'image, à sa place.
 * Ne se voit que sous le jeton « neige ». */
export function Neige({
  cadre,
}: {
  cadre: { top: number; left: number; width: number; height: number };
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => (ref.current ? faireNeiger(ref.current) : undefined), []);
  return (
    <canvas
      ref={ref}
      className="n3-neige"
      width={160}
      height={120}
      aria-hidden="true"
      style={cadre}
    />
  );
}

/**
 * Arme la couverture de l'état, et la retire quand l'état part sans qu'une
 * image ne la lève. `vu` : les images que l'état avait vues à sa décision
 * (`Snapshot.couvertureVue`). Armée UNE fois par entrée dans l'état : une
 * image peinte la lève, et la même couverture ne revient pas au relevé
 * suivant sur une image qui bouge de nouveau.
 */
export function useCouverture(jeton: Jeton | null, vu: number): void {
  const vue = useRef(vu);
  vue.current = vu;
  useLayoutEffect(() => {
    if (jeton === null) return;
    armer(jeton, vue.current);
    return () => retirer(jeton);
  }, [jeton]);
}

/**
 * Les scènes d'Aïn quand l'état change, par l'arbitre de la salle (K10). Ne
 * peint rien. `hote` dit où elle joue : sur le plateau du plein cadre, sinon
 * là où la salle la pose (`ouEstLaMascotte`).
 */
export function ScenesDesEtats({
  moment,
  hote,
}: {
  moment: Moment;
  hote: (scene: string) => Hote | null;
}) {
  const arbitre = useArbitre();
  const avant = useRef<Moment>({ liaison: { etat: "ok" }, fermeDans: 0 });
  const ou = useRef(hote);
  ou.current = hote;
  // La clé sans les durées : une durée qui avance ne rejoue rien.
  const cle = JSON.stringify({
    ...moment.liaison,
    depuisMs: undefined,
    repondDepuisMs: undefined,
    fermeDans: moment.fermeDans > 0,
  });
  useEffect(() => {
    const scene = sceneDeTransition(avant.current, moment);
    // Le son grave d'une panne : le socle le tait si les sons sont coupés
    // (par défaut) ou si le jeu a le focus.
    if (alerteDEntree(avant.current.liaison.etat, moment.liaison.etat)) sonMenu("erreur");
    avant.current = moment;
    if (scene === null || arbitre === null) return;
    const ici = ou.current(scene);
    if (ici !== null) arbitre.demander({ scene, par: "etats", hote: ici });
    // Seule la clé compte : `moment` change deux fois par seconde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, arbitre]);
  return null;
}
