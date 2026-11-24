/** Les marques du pas à pas, posées sur les dessins hors de React.
 *
 * L'instantané de la page se lit deux fois par seconde (règle 8) : une marque
 * qui l'attendrait arriverait après l'appui qu'elle annonce. Ce module
 * s'abonne aux moments de la boucle (`surReglage` pour Dolphin, `surLecon`
 * pour la trame Pro) et ne change qu'un attribut, `data-marque` ; la feuille
 * (`reglage.css`) dessine.
 *
 * Deux séquences vivent côte à côte, chacune avec ses minuteries :
 *
 * - l'étape : « etape » pose un cadre sur la commande attendue, plus large à
 *   4 s (`insiste`), puis une flèche à 8 s (`fleche`), et plus rien : une
 *   attente longue ne clignote pas ;
 * - la réponse : « recu » pose des coins sur la pièce appuyée de ta manette
 *   650 ms, et une ligne pointillée la relie à la commande qui a reçu la
 *   réponse ; puis les deux s'effacent (`efface`, quatre paliers dans la
 *   feuille).
 *
 * D5 : l'étape suivante coupe la séquence de l'étape d'avant et pose sa
 * propre marque aussitôt. Elle ne coupe pas la réponse qui vient de clore
 * cette étape : la boucle émet « recu » puis l'« etape » suivante dans le
 * même appel (`media/input.ts`, `media/switch.ts`), et la couper retirait les
 * coins avant toute peinture (relecture du 24 novembre 2026). Une nouvelle
 * réponse coupe la précédente. Rien de tout cela ne retarde la leçon.
 */

/** Les moments lus : ceux de `EvenementDe`, sans dépendre de leur trame. */
export type Moment =
  | { type: "etape"; control: string }
  | { type: "recu"; control: string; indice: string }
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

/** Le stick dessiné d'un axe de ta manette (`a1-` est le stick `a0`), comme
 * la peinture l'incline (`lib/wiring`, `paintWiring`) : les axes 0 et 1
 * pour le stick gauche, 2 et 3 pour le droit. `null` pour un bouton ou un
 * axe qu'aucun stick ne porte. */
export function stickDe(indice: string): string | null {
  const axe = /^a([0-3])[+-]$/.exec(indice);
  return axe ? (Number(axe[1]) < 2 ? "a0" : "a2") : null;
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

/** Une séquence de marques : ses minuteries, et ce qu'elle a posé. La couper
 * arrête les unes et retire l'autre. */
function sequence(horloge: Horloge) {
  const minuteurs = new Set<ReturnType<typeof setTimeout>>();
  let retirer = () => {};
  const arreter = () => {
    for (const id of minuteurs) horloge.clearTimeout(id);
    minuteurs.clear();
  };
  return {
    plus(ms: number, faire: () => void) {
      const id = horloge.setTimeout(() => {
        minuteurs.delete(id);
        faire();
      }, ms);
      minuteurs.add(id);
    },
    /** Ce que `couper` retirera. */
    poser(retrait: () => void) {
      retirer = retrait;
    },
    /** Les minuteries seulement : la marque posée reste. */
    arreter,
    couper() {
      arreter();
      retirer();
      retirer = () => {};
    },
  };
}

/** Pose les marques dans `racine` (qui contient les deux dessins, la gauche
 * d'abord) et rend la fonction qui arrête tout et retire chaque marque. */
export function poserMarques(
  racine: Element,
  abonner: (ecoute: (moment: Moment) => void) => () => void,
  horloge: Horloge = globalThis,
): () => void {
  let etape = sequence(horloge);
  let reponse = sequence(horloge);
  // La gauche porte les commandes, la droite les indices bruts (b0, a2) :
  // leurs noms de pièce ne se croisent pas, une seule racine suffit à les
  // trouver. Les sticks, eux, se nomment `a0` et `a2` des deux côtés sur la
  // trame Pro : celui d'un axe se cherche dans le dessin de droite.
  const piece = (nom: string) => racine.querySelector(`[data-part="${CSS.escape(nom)}"]`);
  const appuyee = (indice: string) => {
    const stick = stickDe(indice);
    if (stick === null) return piece(indice);
    const droite = [...racine.querySelectorAll("svg[data-padmap]")].at(-1);
    return droite?.querySelector(`[data-stick="${stick}"]`) ?? null;
  };
  const desabonner = abonner((moment) => {
    if (moment.type === "etape") {
      etape.couper();
      etape = sequence(horloge);
      const cible = piece(pieceDe(moment.control));
      if (!cible) return;
      const suite = etape;
      cible.setAttribute("data-marque", "cadre");
      suite.poser(() => cible.removeAttribute("data-marque"));
      suite.plus(MARQUES.insiste, () => cible.setAttribute("data-marque", "insiste"));
      suite.plus(MARQUES.fleche, () => cible.setAttribute("data-marque", "fleche"));
    } else if (moment.type === "recu") {
      // La réponse est là : la commande attendue n'insiste plus.
      etape.arreter();
      reponse.couper();
      reponse = sequence(horloge);
      const de = appuyee(moment.indice);
      if (!de) return;
      const vers = piece(pieceDe(moment.control));
      const liaison = vers ? tirerLiaison(racine, de, vers) : null;
      const suite = reponse;
      de.setAttribute("data-marque", "coins");
      suite.poser(() => {
        de.removeAttribute("data-marque");
        liaison?.remove();
      });
      suite.plus(MARQUES.coins, () => {
        de.setAttribute("data-marque", "efface");
        liaison?.setAttribute("data-marque", "efface");
        suite.plus(MARQUES.efface, () => suite.couper());
      });
    } else if (moment.type === "fin") {
      // Plus rien n'est attendu ; la dernière réponse finit ses 650 ms.
      etape.couper();
    } else if (moment.type === "suspendu") {
      // La manette est partie : sa pièce ne répond plus de rien.
      etape.couper();
      reponse.couper();
    }
  });
  return () => {
    desabonner();
    etape.couper();
    reponse.couper();
  };
}
