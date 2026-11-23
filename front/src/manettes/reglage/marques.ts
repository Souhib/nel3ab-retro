/** Les marques du pas à pas, posées sur les dessins hors de React.
 *
 * L'instantané de la page se lit deux fois par seconde (règle 8) : une marque
 * qui l'attendrait arriverait après l'appui qu'elle annonce. Ce module
 * s'abonne aux moments de la boucle (`surReglage` pour Dolphin, `surLecon`
 * pour la trame Pro) et ne change qu'un attribut, `data-marque` ; la feuille
 * (`reglage.css`) dessine.
 *
 * - « etape » : un cadre se pose sur la commande attendue, revient plus large
 *   à 4 s (`insiste`), puis une flèche à 8 s (`fleche`), et plus rien : une
 *   attente longue ne clignote pas.
 * - « recu » : des coins encadrent la pièce appuyée sur ta manette 650 ms,
 *   et une ligne pointillée la relie à la commande attendue ; puis les deux
 *   s'effacent (`efface`, quatre paliers dans la feuille).
 * - D5 : l'étape suivante coupe ce qui est en cours et pose sa propre marque
 *   aussitôt. Une marque ne retarde jamais la leçon.
 */

/** Les moments lus : ceux de `EvenementDe`, sans dépendre de leur trame. */
export type Moment =
  | { type: "etape"; control: string }
  | { type: "recu"; indice: string }
  | { type: "relache" }
  | { type: "fin" }
  | { type: "suspendu" }
  | { type: "premiere-manette" };

export const MARQUES = { insiste: 4000, fleche: 8000, coins: 650, efface: 400 } as const;

/** La pièce dessinée d'une commande : le stick Dolphin porte `x` et `cx`,
 * les sens de la trame Pro portent le clic de leur stick. */
export function pieceDe(commande: string): string {
  if (commande === "y") return "x";
  if (commande === "cy") return "cx";
  if (/^l[xy][+-]$/.test(commande)) return "LS";
  if (/^r[xy][+-]$/.test(commande)) return "RS";
  return commande;
}

type Horloge = Pick<typeof globalThis, "setTimeout" | "clearTimeout">;

const SVG = "http://www.w3.org/2000/svg";

/** La ligne pointillée de la pièce appuyée (à droite) à la commande attendue
 * (à gauche), dans un calque de la racine : les deux dessins sont deux `svg`
 * distincts, aucun des deux ne peut la porter. */
function tirerLiaison(racine: Element, de: Element, vers: Element): SVGSVGElement {
  const boite = racine.getBoundingClientRect();
  const centre = (piece: Element) => {
    const r = piece.getBoundingClientRect();
    return [
      Math.round(r.left + r.width / 2 - boite.left),
      Math.round(r.top + r.height / 2 - boite.top),
    ];
  };
  const [x1, y1] = centre(de);
  const [x2, y2] = centre(vers);
  const calque = document.createElementNS(SVG, "svg");
  calque.setAttribute("class", "n3-liaison");
  calque.setAttribute("aria-hidden", "true");
  const ligne = document.createElementNS(SVG, "line");
  for (const [nom, valeur] of Object.entries({ x1, y1, x2, y2 }))
    ligne.setAttribute(nom, String(valeur));
  calque.append(ligne);
  racine.append(calque);
  return calque;
}

/** Pose les marques dans `racine` (qui contient les deux dessins) et rend la
 * fonction qui arrête tout et retire chaque marque. */
export function poserMarques(
  racine: Element,
  abonner: (ecoute: (moment: Moment) => void) => () => void,
  horloge: Horloge = globalThis,
): () => void {
  const minuteurs = new Set<ReturnType<typeof setTimeout>>();
  const plus = (ms: number, faire: () => void) => {
    const id = horloge.setTimeout(() => {
      minuteurs.delete(id);
      faire();
    }, ms);
    minuteurs.add(id);
  };
  const couperMinuteurs = () => {
    for (const id of minuteurs) horloge.clearTimeout(id);
    minuteurs.clear();
  };
  let attendue: Element | null = null;
  const toutCouper = () => {
    couperMinuteurs();
    attendue = null;
    for (const piece of racine.querySelectorAll("[data-marque]"))
      piece.removeAttribute("data-marque");
    for (const calque of racine.querySelectorAll(".n3-liaison")) calque.remove();
  };
  // La gauche porte les commandes, la droite les indices bruts (b0, a2) :
  // leurs noms ne se croisent pas, une seule racine suffit à les trouver.
  const piece = (nom: string) => racine.querySelector(`[data-part="${CSS.escape(nom)}"]`);
  const desabonner = abonner((moment) => {
    if (moment.type === "etape") {
      toutCouper();
      const cible = piece(pieceDe(moment.control));
      if (!cible) return;
      attendue = cible;
      cible.setAttribute("data-marque", "cadre");
      plus(MARQUES.insiste, () => cible.setAttribute("data-marque", "insiste"));
      plus(MARQUES.fleche, () => cible.setAttribute("data-marque", "fleche"));
    } else if (moment.type === "recu") {
      const appuyee = piece(moment.indice);
      if (!appuyee) return;
      // La réponse est là : la commande attendue n'insiste plus.
      couperMinuteurs();
      for (const calque of racine.querySelectorAll(".n3-liaison")) calque.remove();
      const liaison = attendue ? tirerLiaison(racine, appuyee, attendue) : null;
      appuyee.setAttribute("data-marque", "coins");
      plus(MARQUES.coins, () => {
        appuyee.setAttribute("data-marque", "efface");
        liaison?.setAttribute("data-marque", "efface");
        plus(MARQUES.efface, () => {
          appuyee.removeAttribute("data-marque");
          liaison?.remove();
        });
      });
    } else if (moment.type === "fin" || moment.type === "suspendu") {
      toutCouper();
    }
  });
  return () => {
    desabonner();
    toutCouper();
  };
}
