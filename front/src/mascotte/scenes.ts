/**
 * Les scènes de la mascotte, abstraites: ce qui se passe, pas qui le joue.
 *
 * Le personnage en pixel art n'est pas encore choisi (ADR D37). Les écrans
 * demandent donc une SCÈNE (« quelqu'un arrive », « la salle s'endort ») et
 * le rendu, remplaçable en un seul endroit (`rendu.ts`), décide de la jouer.
 * Les identifiants sont communs à tous les chantiers d'écran; ils reprennent
 * les scènes de la proposition du 22 novembre (Quatrou), traduites:
 * « le scotch résiste » devient l'arrivée, « l'oreille » le départ.
 *
 * Chaque scène a une version complète, jouée la première fois dans ce
 * navigateur, et une version courte ensuite (`version`). En mouvement réduit,
 * seule la pose clé se montre: la pose finale, sans mouvement.
 */

export const SCENES = [
  "arrivee",
  "depart",
  "attente",
  "chercher",
  "premiere-image",
  "rebrancher",
  "arret",
  "coupe",
  "decroche",
  "redemarre",
  "endort",
  "dort",
  "ouvre",
  "range",
  "depot",
  "refus",
  "pret",
  "fier",
  "demo",
] as const;
export type Scene = (typeof SCENES)[number];
export type Version = "complete" | "courte";

export const estScene = (valeur: unknown): valeur is Scene =>
  typeof valeur === "string" && (SCENES as readonly string[]).includes(valeur);

/** Ce que chaque scène dit, et sa durée complète et courte en millisecondes.
 * Aucune ne dépasse 2,75 s, la limite de la charte de la proposition, sauf la
 * démo, qui ne se joue que quand personne ne regarde. */
export const DUREES: Record<Scene, { complete: number; courte: number; sens: string }> = {
  arrivee: { complete: 900, courte: 400, sens: "quelqu'un prend une place" },
  depart: { complete: 600, courte: 300, sens: "quelqu'un s'en va, ou un spectateur arrive" },
  attente: { complete: 1600, courte: 800, sens: "la salle est ouverte, personne ne joue" },
  chercher: { complete: 2500, courte: 1200, sens: "le jeu démarre" },
  "premiere-image": { complete: 150, courte: 150, sens: "la première image arrive" },
  rebrancher: { complete: 1300, courte: 600, sens: "on arrive, ou la connexion revient" },
  arret: { complete: 700, courte: 400, sens: "l'image ne bouge plus" },
  coupe: { complete: 800, courte: 400, sens: "la connexion est coupée de ton côté" },
  decroche: { complete: 800, courte: 400, sens: "la salle ne répond plus" },
  redemarre: { complete: 700, courte: 400, sens: "la salle redémarre" },
  endort: { complete: 2400, courte: 1000, sens: "la salle va fermer" },
  dort: { complete: 1200, courte: 600, sens: "la salle est fermée" },
  ouvre: { complete: 2200, courte: 900, sens: "une salle s'ouvre" },
  range: { complete: 1600, courte: 700, sens: "une soirée se range dans le carnet" },
  depot: { complete: 1200, courte: 600, sens: "un jeu déposé est rangé" },
  refus: { complete: 1400, courte: 600, sens: "un fichier déposé est refusé" },
  pret: { complete: 900, courte: 450, sens: "un joueur est prêt" },
  fier: { complete: 1200, courte: 600, sens: "une belle partie se termine" },
  demo: { complete: 5000, courte: 2500, sens: "le mode démo, quand personne ne touche à rien" },
};

const VUES = "nel3ab:mascotte-vues";

/** Les scènes déjà vues dans ce navigateur. Illisible ou refusé: aucune. */
function vues(): Set<Scene> {
  try {
    const lu: unknown = JSON.parse(localStorage.getItem(VUES) ?? "[]");
    return new Set(Array.isArray(lu) ? lu.filter(estScene) : []);
  } catch {
    return new Set();
  }
}

/**
 * La version à jouer: `complete` ou `courte` telle que demandée, ou `auto`:
 * complète la première fois dans ce navigateur, courte ensuite. `auto` note la
 * scène comme vue. La mémoire vit dans le navigateur; si elle manque, la
 * version complète se joue.
 */
export function version(scene: Scene, demandee: Version | "auto" = "auto"): Version {
  if (demandee !== "auto") return demandee;
  const deja = vues();
  if (deja.has(scene)) return "courte";
  deja.add(scene);
  try {
    localStorage.setItem(VUES, JSON.stringify([...deja]));
  } catch {
    /* navigation privée: la prochaine fois sera encore la première */
  }
  return "complete";
}

/** Les états d'une salle que les écrans connaissent, et les événements. */
export const ETATS = [
  "vit",
  "figee",
  "redemarre",
  "coupee",
  "injoignable",
  "fermee",
  "demarrage",
  "connexion",
  "repos",
  "fermeture",
] as const;
export type Etat = (typeof ETATS)[number];

export const EVENEMENTS = {
  place: "arrivee",
  depart: "depart",
  spectateur: "depart",
  pret: "pret",
  fier: "fier",
  "salle-ouverte": "ouvre",
  "soiree-rangee": "range",
  "depot-reussi": "depot",
  "depot-refuse": "refus",
} as const satisfies Record<string, Scene>;
export type Evenement = keyof typeof EVENEMENTS;

/** Pendant une partie, seules ces scènes se jouent, dans la colonne, jamais
 * devant l'image. */
const EN_PARTIE: ReadonlySet<Scene> = new Set(["arrivee", "depart", "pret"]);

/**
 * Quelle scène pour quel changement: une fonction pure. `avant` et `apres`
 * sont des états de la salle, ou `null` pour une page qui arrive.
 * `evenement` remplace le changement d'état. `enPartie`: une image de jeu est
 * à l'écran. `dejaVu`: la scène a déjà été vue (version courte). Rend la
 * scène et sa version, ou `null` quand rien ne se joue. Un état ou un
 * événement inconnu est une erreur, pas un silence.
 */
export function pourTransition(
  avant: Etat | null,
  apres: Etat | null,
  {
    evenement,
    enPartie = false,
    dejaVu = false,
  }: { evenement?: Evenement; enPartie?: boolean; dejaVu?: boolean } = {},
): { scene: Scene; version: Version } | null {
  for (const etat of [avant, apres])
    if (etat !== null && !(ETATS as readonly string[]).includes(etat))
      throw new Error(`état de salle inconnu: ${String(etat)}`);
  const v: Version = dejaVu ? "courte" : "complete";
  const rendre = (scene: Scene) =>
    enPartie && !EN_PARTIE.has(scene) ? null : { scene, version: v };
  if (evenement !== undefined) {
    if (!Object.hasOwn(EVENEMENTS, evenement))
      throw new Error(`événement inconnu: ${String(evenement)}`);
    return rendre(EVENEMENTS[evenement]);
  }
  if (avant === apres) return null;
  switch (apres) {
    case "connexion":
      // On arrive, ou ça revient: plus court si ça revient.
      return enPartie
        ? null
        : {
            scene: "rebrancher",
            version: avant === "coupee" || avant === "injoignable" ? "courte" : v,
          };
    case "demarrage":
      return rendre("chercher");
    case "vit":
      // L'image arrive: la scène du démarrage s'efface, rien devant l'image.
      return avant === "demarrage" ? { scene: "premiere-image", version: "complete" } : null;
    case "figee":
      return rendre("arret");
    case "redemarre":
      return rendre("redemarre");
    case "coupee":
      return rendre("coupe");
    case "injoignable":
      return rendre("decroche");
    case "fermeture":
      return rendre("endort");
    case "fermee":
      return rendre("dort");
    case "repos":
      return rendre("attente");
    default:
      return null;
  }
}
