/**
 * La vue « Tes touches au clavier » ou « Ta manette » (23 novembre 2026,
 * chantier salle, étape 6). Elle remplace la carte dépliable `AideClavier` et
 * prend la place des rangs de la colonne, comme les mesures.
 *
 * Une ligne par commande : la touche ou le bouton, une flèche, et ce que la
 * console de la salle reçoit (`lib/aide-clavier` pour le clavier,
 * `lib/verification` pour la manette, qui lit les tables du produit). La
 * ligne s'allume quand la trame envoyée porte sa commande ; une fois vue, sa
 * case reste cochée pour la visite. Quand chaque ligne a été vue, la mascotte
 * joue « fier », une fois (K07).
 *
 * # Pourquoi la vue lit l'instantané elle-même
 *
 * L'instantané que React reçoit est relu deux fois par seconde. Un appui de
 * 150 ms tombe le plus souvent entre deux relevés et n'aurait rien allumé.
 * La vue relit donc l'état de la boucle d'entrée toutes les 50 ms, seulement
 * tant qu'elle est montée, et ne rend que quand une ligne change. Ce n'est pas
 * le chemin de l'image : la boucle d'image vit dans `media/` et n'en sait
 * rien.
 */
import { useEffect, useRef, useState } from "react";
import type { Ligne } from "../lib/aide-clavier";
import { cn } from "../lib/cn";
import { clavierAuJeu } from "../lib/focus-jeu";
import { TOUCHES } from "../lib/mots";
import { allumees, suivie, toutesVues, type Activite } from "../lib/verification";
import { useArbitre } from "./Cadre";
import { IconeRang, TitreColonne } from "./Colonne";
import { Touche } from "./Reperes";

/** Toutes les 50 ms : assez pour un appui de 100 ms, rien quand la vue est
 * fermée. */
export const RELEVE_MS = 50;

export type Releve = { activite: Activite; sinceHeardMs: number | null };

export function VueTouches({
  titre,
  lignes,
  clavier,
  lire,
  hote = "coin",
  onRevenir,
  onChanger,
}: {
  titre: string;
  lignes: readonly Ligne[];
  /** La vue du clavier : ses touches ne partent qu'avec le focus au jeu. */
  clavier: boolean;
  /** L'état de la boucle d'entrée, relu tant que la vue est montée. */
  lire: () => Releve;
  /** Où la mascotte joue « fier » : le coin au bureau, la barre au téléphone. */
  hote?: "coin" | "barre";
  onRevenir: () => void;
  /** Ouvre « touches et manettes » sur l'onglet de l'appareil. */
  onChanger: () => void;
}) {
  const arbitre = useArbitre();
  const [etat, setEtat] = useState<{
    allumees: boolean[];
    vues: ReadonlySet<number>;
    suivies: boolean[];
  }>(() => ({ allumees: [], vues: new Set(), suivies: [] }));
  const fier = useRef(false);
  const lireRef = useRef(lire);
  lireRef.current = lire;
  const lignesRef = useRef(lignes);
  lignesRef.current = lignes;
  // Les lignes sont recalculées à chaque instantané (deux fois par seconde) :
  // la vue ne repart de zéro que quand leur contenu change, sinon les cases
  // cochées s'effaceraient à chaque relevé.
  const cle = lignes.map((l) => `${l.touches}>${l.fait}>${l.commandes.join("+")}`).join("|");

  useEffect(() => {
    let vues = new Set<number>();
    let signe = "";
    fier.current = false;
    const relever = () => {
      const lues = lignesRef.current;
      const { activite, sinceHeardMs } = lireRef.current();
      const lu = allumees(lues, activite, {
        clavier,
        focusAuJeu: clavierAuJeu(document.activeElement),
        sinceHeardMs,
      });
      lu.forEach((oui, i) => {
        if (oui && !vues.has(i)) vues = new Set([...vues, i]);
      });
      const suivies = lues.map((ligne) => suivie(ligne, activite));
      const nouveau = `${lu.map(Number).join("")}|${[...vues].sort().join(",")}|${suivies.map(Number).join("")}`;
      if (nouveau !== signe) {
        signe = nouveau;
        setEtat({ allumees: lu, vues, suivies });
      }
      if (!fier.current && toutesVues(lues, vues, activite)) {
        fier.current = true;
        arbitre?.demander({ scene: "fier", par: "salle", hote });
      }
    };
    relever();
    const minuterie = window.setInterval(relever, RELEVE_MS);
    return () => window.clearInterval(minuterie);
  }, [cle, clavier, arbitre, hote]);

  return (
    <section
      id="vueTouches"
      aria-labelledby="vueTouchesTitre"
      className="n3-vue-touches flex w-full flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2">
        <TitreColonne id="vueTouchesTitre">{titre}</TitreColonne>
        <button
          type="button"
          id="revenirTouches"
          onClick={onRevenir}
          className="n3-rang-lien shrink-0"
        >
          {TOUCHES.revenir}
        </button>
      </div>
      <ul className="flex flex-col">
        {lignes.map((ligne, i) => {
          const suivi = etat.suivies[i] ?? false;
          const vue = etat.vues.has(i);
          return (
            <li
              key={`${ligne.touches}-${ligne.fait}`}
              data-ligne-touche=""
              data-suivie={suivi ? "" : undefined}
              data-allumee={etat.allumees[i] ? "" : undefined}
              data-vue={vue ? "" : undefined}
              className={cn("n3-ligne-touche", etat.allumees[i] && "n3-ligne-allumee")}
            >
              {/* Une case seulement quand l'instantané suit la commande : une
                  case qui ne s'allumerait jamais dirait « rien n'est parti ». */}
              <span className="n3-case" aria-hidden="true" data-cochee={vue ? "" : undefined}>
                {suivi ? (vue ? "✓" : "") : null}
              </span>
              <span className="n3-ligne-touches min-w-0 flex-1 truncate">
                <Touche>{ligne.touches}</Touche>
              </span>
              <IconeRang nom="chevron" />
              <span className="n3-ligne-fait min-w-0 flex-1 truncate text-muted">{ligne.fait}</span>
              {vue ? <span className="sr-only">, {TOUCHES.envoyee}</span> : null}
            </li>
          );
        })}
      </ul>
      {clavier ? <p className="text-corps leading-relaxed text-faint">{TOUCHES.horsJeu}</p> : null}
      <p className="text-corps leading-relaxed text-faint">{TOUCHES.legende}</p>
      <button type="button" id="changerTouches" onClick={onChanger} className="n3-rang">
        <IconeRang nom="curseurs" />
        {TOUCHES.changer}
      </button>
    </section>
  );
}
