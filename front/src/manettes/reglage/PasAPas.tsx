/** Le pas à pas, ses deux issues et la table des correspondances, communs aux
 * deux trames (Dolphin et Pro). Rien ici ne lit une manette : chaque trame
 * passe ses mots et ses gestes, et la machine d'étapes reste dans
 * `media/lesson` (`Pas`). */
import type { ReactNode } from "react";
import { REGLAGE } from "../../lib/mots";

/** Un bouton du panneau : la boîte en escalier du socle, plein ou non. */
export function Bouton({
  plein = false,
  children,
  className = "",
  ...reste
}: { plein?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`rt-boite rt-bouton n3-reglage-bouton ${plein ? "rt-bouton-plein" : ""} ${className}`}
      {...reste}
    >
      <i className="rt-ombre" aria-hidden="true" />
      {children}
    </button>
  );
}

/** La jauge des étapes : un segment par étape, pleins pour les faites. */
export function Jauge({ faites, total }: { faites: number; total: number }) {
  return (
    <div
      className="n3-jauge"
      role="progressbar"
      aria-label={REGLAGE.etape(faites + 1, total)}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={faites}
    >
      {Array.from({ length: total }, (_, at) => (
        <span key={at} data-plein={at < faites ? "oui" : "non"} />
      ))}
    </div>
  );
}

/** Une étape en cours : la consigne prend la place de l'appareil et de la
 * liste ; les dessins restent dessous, posés par la trame. */
export function PasAPas({
  etape,
  total,
  attendRelache,
  consigne,
  action,
  onPasser,
  onArreter,
}: {
  etape: number;
  total: number;
  attendRelache: boolean;
  consigne: string;
  action?: string;
  onPasser: () => void;
  onArreter: () => void;
}) {
  return (
    <section className="n3-pas" aria-labelledby="pasTitre" data-pas-a-pas="">
      <h3 id="pasTitre">{REGLAGE.etape(etape, total)}</h3>
      <Jauge faites={etape - 1} total={total} />
      <p role="status" className="n3-pas-consigne">
        {attendRelache ? REGLAGE.relache : consigne}
      </p>
      {action ? (
        <p className="n3-pas-action">
          {REGLAGE.dansLeJeu} : {action}
        </p>
      ) : null}
      <div className="n3-reglage-gestes">
        <Bouton id="passerEtape" onClick={onPasser}>
          {REGLAGE.passer}
        </Bouton>
        <Bouton id="arreterLecon" onClick={onArreter}>
          {REGLAGE.arreter}
        </Bouton>
      </div>
    </section>
  );
}

/** Avant la première étape : lâcher la manette, puis commencer. Le repos est
 * pris au clic sur « Commencer » (`InputState.neutre`). */
export function AvantLePas({
  onCommencer,
  onAnnuler,
}: {
  onCommencer: () => void;
  onAnnuler: () => void;
}) {
  return (
    <div className="n3-reglage-avis" role="status">
      <p>{REGLAGE.repos}</p>
      <div className="n3-reglage-gestes">
        <Bouton plein id="commencerLecon" onClick={onCommencer}>
          {REGLAGE.commencer}
        </Bouton>
        <Bouton onClick={onAnnuler}>{REGLAGE.annuler}</Bouton>
      </div>
    </div>
  );
}

/** Une manette débranchée au milieu du pas à pas : la reprise ne vaut que
 * pour la même manette (la boucle le vérifie et refuse sinon). */
export function Suspension({
  etape,
  onReprendre,
  onDaccord,
}: {
  etape: number;
  onReprendre: () => void;
  onDaccord: () => void;
}) {
  return (
    <div className="n3-reglage-avis" role="status" data-suspendu="">
      <p>
        {REGLAGE.suspendu(etape)} {REGLAGE.branche}
      </p>
      <div className="n3-reglage-gestes">
        <Bouton plein id="reprendreLecon" onClick={onReprendre}>
          {REGLAGE.reprendre(etape)}
        </Bouton>
        <Bouton id="oublierLecon" onClick={onDaccord}>
          {REGLAGE.daccord}
        </Bouton>
      </div>
    </div>
  );
}

/** La fin, comptée, et le chemin vers la première commande passée. */
export function Fin({
  texte,
  passee,
  onRegler,
}: {
  texte: string;
  passee: { cle: string; nom: string } | null;
  onRegler: (cle: string) => void;
}) {
  return (
    <div className="n3-reglage-avis" role="status" data-fin-lecon="">
      <p>{texte}</p>
      {passee ? (
        <Bouton id="reglerPassee" onClick={() => onRegler(passee.cle)}>
          {REGLAGE.reglerDans(passee.nom)}
        </Bouton>
      ) : null}
    </div>
  );
}

/** Une ligne de la table : la commande du jeu, ce qui la déclenche, et
 * l'attente quand on la change. */
export type Ligne = {
  cle: string;
  nom: string;
  /** Ce qu'elle est (« gâchette gauche ») ou ce qu'elle fait dans le jeu. */
  sous?: string;
  valeur: string;
  enCours: boolean;
  /** La consigne pendant un changement : « Appuie sur un bouton… ». */
  attente: string;
};

/** « Toutes les correspondances » : changer une commande se fait ici, dans
 * sa ligne. `prefixe` sépare les tables de la manette et du clavier, qui
 * peuvent vivre dans la même page. */
export function Correspondances({
  titre,
  colonne,
  lignes,
  prefixe,
  inactif,
  onChanger,
  onAnnuler,
  onEffacer,
  courante,
  pied,
}: {
  titre: string;
  colonne: string;
  lignes: readonly Ligne[];
  prefixe: string;
  inactif: boolean;
  onChanger: (cle: string) => void;
  onAnnuler: () => void;
  onEffacer?: (cle: string) => void;
  /** La ligne choisie d'un clic sur le dessin. */
  courante?: string | null;
  pied?: ReactNode;
}) {
  return (
    <table className="n3-correspondances" aria-label={titre}>
      <thead>
        <tr>
          <th scope="col">{REGLAGE.dansLeJeu}</th>
          <th scope="col">{colonne}</th>
          <th scope="col">
            <span className="sr-only">{REGLAGE.changer}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((ligne) => (
          <tr
            key={ligne.cle}
            data-cle={ligne.cle}
            data-attend={ligne.enCours ? "oui" : undefined}
            aria-current={courante === ligne.cle ? "true" : undefined}
          >
            <th scope="row">
              {ligne.nom}
              {ligne.sous ? <small>{ligne.sous}</small> : null}
            </th>
            <td>{ligne.enCours ? <span role="status">{ligne.attente}</span> : ligne.valeur}</td>
            <td>
              {ligne.enCours ? (
                <Bouton onClick={onAnnuler}>{REGLAGE.annuler}</Bouton>
              ) : (
                <>
                  <Bouton
                    id={`${prefixe}-${ligne.cle}`}
                    aria-label={REGLAGE.changerNom(ligne.nom)}
                    disabled={inactif}
                    onClick={() => onChanger(ligne.cle)}
                  >
                    {REGLAGE.changer}
                  </Bouton>
                  {onEffacer ? (
                    <Bouton
                      aria-label={REGLAGE.effacerNom(ligne.nom)}
                      disabled={inactif}
                      onClick={() => onEffacer(ligne.cle)}
                    >
                      ×
                    </Bouton>
                  ) : null}
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
      {pied ? (
        <tfoot>
          <tr>
            <td colSpan={3}>{pied}</td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
