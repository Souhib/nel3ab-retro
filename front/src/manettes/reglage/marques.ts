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
 *   puis s'effacent (`efface`, quatre paliers dans la feuille).
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
  const toutCouper = () => {
    couperMinuteurs();
    for (const piece of racine.querySelectorAll("[data-marque]"))
      piece.removeAttribute("data-marque");
  };
  // La gauche porte les commandes, la droite les indices bruts (b0, a2) :
  // leurs noms ne se croisent pas, une seule racine suffit à les trouver.
  const piece = (nom: string) => racine.querySelector(`[data-part="${CSS.escape(nom)}"]`);
  const desabonner = abonner((moment) => {
    if (moment.type === "etape") {
      toutCouper();
      const attendue = piece(pieceDe(moment.control));
      if (!attendue) return;
      attendue.setAttribute("data-marque", "cadre");
      plus(MARQUES.insiste, () => attendue.setAttribute("data-marque", "insiste"));
      plus(MARQUES.fleche, () => attendue.setAttribute("data-marque", "fleche"));
    } else if (moment.type === "recu") {
      const appuyee = piece(moment.indice);
      if (!appuyee) return;
      // La réponse est là : la commande attendue n'insiste plus.
      couperMinuteurs();
      appuyee.setAttribute("data-marque", "coins");
      plus(MARQUES.coins, () => {
        appuyee.setAttribute("data-marque", "efface");
        plus(MARQUES.efface, () => appuyee.removeAttribute("data-marque"));
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
