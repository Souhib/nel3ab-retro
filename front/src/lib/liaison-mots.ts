/**
 * Ce que Bobine dit de la liaison: une phrase, un fait, une action.
 *
 * L'état se décide dans la couche média (`media/liaison.ts`); ici on ne fait
 * que le DIRE. Séparé du composant pour deux raisons. Les mots se vérifient
 * sans rendu: chaque phrase ci-dessous a son essai, et une garde refuse les
 * mots d'atelier et les tirets cadratins. Et la ligne parlée doit dire
 * exactement la même chose que l'écran, sans recopier la phrase ailleurs.
 *
 * La règle des mots, tirée de l'audit des textes du 22 novembre 2026: l'effet
 * d'abord, puis le fait qui le prouve, jamais une cause supposée. « Le son
 * arrive encore » est un fait mesuré ici; « le serveur a planté » n'en est pas
 * un. Le propriétaire calibre sur ce que les joueurs ressentent.
 */
import type { Pose } from "../bobine/Bobine";
import type { Liaison } from "../media/liaison";

/** Les gestes qu'un état propose, nommés par ce qu'ils font. */
export type Action =
  | "relancer"
  | "signaler"
  | "reessayer"
  | "quitter"
  | "salles"
  | "reduire"
  | "garder";

export type Dit = {
  /** Où et comment le dire. « rien »: l'état ne se montre pas (le démarrage a
   * son propre écran). « rideau »: il couvre l'image, qui n'existe pas encore.
   * « bandeau »: posé sur la dernière image, assombrie. « pastille »: une ligne
   * discrète, sans action. « proposition »: une offre en bas de l'image. */
  niveau: "rien" | "pastille" | "bandeau" | "rideau" | "proposition";
  pose: Pose;
  titre: string;
  detail?: string;
  actions: Action[];
  /** Une durée en secondes, affichée comme une horloge de régie. */
  compteur?: number;
  etapes?: { texte: string; fait: boolean }[];
};

/** Le nom court de chaque état, pour le panneau des mesures. */
export const NOM_ETAT: Record<Liaison["etat"], string> = {
  ok: "en marche",
  cachee: "onglet caché",
  irreguliere: "irrégulière",
  figee: "image figée",
  decodeur: "affichage arrêté",
  coupee: "coupée",
  injoignable: "salle muette",
  fermee: "salle fermée",
  demarrage: "démarrage",
  arrivee: "arrivée",
};

const RIEN: Dit = { niveau: "rien", pose: "repos", titre: "", actions: [] };

const enSecondes = (ms: number) => Math.max(0, Math.floor(ms / 1000));

export function dire(liaison: Liaison, salle: number): Dit {
  switch (liaison.etat) {
    case "ok":
    case "cachee":
    case "demarrage":
      return RIEN;
    case "figee":
      if (liaison.niveau === "pastille")
        return {
          niveau: "pastille",
          pose: "loupe",
          titre: "Image figée",
          actions: [],
          compteur: enSecondes(liaison.depuisMs),
        };
      return {
        niveau: "bandeau",
        pose: "loupe",
        titre: `L'image ne bouge plus depuis ${enSecondes(liaison.depuisMs)} s.`,
        // Un message vide de la salle toutes les 500 ms est ce qui fait entrer
        // dans cet état: « la salle répond » est donc toujours un fait ici.
        detail: liaison.son
          ? "Le son arrive encore: le jeu tourne sur la machine."
          : "La salle répond, mais n'envoie plus d'image.",
        actions: ["relancer", "signaler"],
        compteur: enSecondes(liaison.depuisMs),
      };
    case "decodeur":
      return {
        niveau: "bandeau",
        pose: "essuie",
        titre: "L'image arrive, mais ton appareil ne l'affiche plus.",
        detail: "Relancer l'image repart d'une image complète.",
        actions: ["relancer", "signaler"],
      };
    case "coupee":
      return liaison.cause === "reseau"
        ? {
            niveau: "bandeau",
            pose: "tire",
            titre: "Ton appareil n'a plus de réseau.",
            detail: "La page se reconnecte dès qu'il revient.",
            actions: [],
          }
        : {
            niveau: "bandeau",
            pose: "tire",
            titre: "Rien ne répond: ni la salle, ni le reste du site.",
            detail: "Vérifie ta connexion. La page réessaie toute seule.",
            // « Quitter » ici aussi: un téléphone replie la colonne, qui
            // porte la seule autre sortie (audit E6).
            actions: ["reessayer", "quitter"],
          };
    case "injoignable":
      return {
        niveau: "bandeau",
        pose: "loupe",
        titre: `La salle ${salle} ne répond plus.`,
        detail: liaison.siteRepond
          ? "Le reste du site répond: ta connexion passe. La page réessaie toute seule."
          : "La page réessaie toute seule.",
        actions: liaison.siteRepond
          ? ["reessayer", "signaler", "quitter"]
          : ["reessayer", "quitter"],
      };
    case "fermee":
      return {
        niveau: "bandeau",
        pose: "dort",
        titre: `La salle ${salle} est fermée.`,
        detail: "Le jeu s'est arrêté avec elle. Les autres salles sont dans la liste.",
        actions: ["salles"],
      };
    case "arrivee": {
      const etapes = [
        { texte: "la salle répond", fait: liaison.etape === "image" },
        { texte: "première image", fait: false },
      ];
      if (!liaison.perdue)
        return {
          niveau: "rideau",
          pose: "marche",
          titre: `Connexion à la salle ${salle}`,
          actions: [],
          etapes,
        };
      return {
        niveau: "rideau",
        pose: "loupe",
        titre: "L'image n'arrive pas.",
        detail: liaison.salleRepond
          ? "La salle répond, mais n'envoie aucune image."
          : liaison.etape === "salle"
            ? "La salle ne répond pas encore."
            : "La liaison est ouverte, sans image.",
        actions: ["reessayer", "quitter"],
        etapes,
      };
    }
    case "irreguliere":
      return {
        niveau: "proposition",
        pose: "repos",
        titre: "Ton image saute depuis vingt secondes.",
        detail: "Le format réduit demande environ 2,6 fois moins de débit.",
        actions: ["reduire", "garder"],
      };
  }
}

/** Ce que la ligne parlée dit d'un état, sans durée: une durée qui avance
 * ferait relire la ligne chaque demi-seconde. */
function parlee(liaison: Liaison, salle: number): string {
  switch (liaison.etat) {
    case "ok":
    case "cachee":
      return "";
    case "figee":
      return liaison.son
        ? "L'image ne bouge plus. Le son arrive encore."
        : "L'image ne bouge plus. La salle répond encore.";
    case "decodeur":
      return "Ton appareil n'affiche plus l'image.";
    case "coupee":
      return liaison.cause === "reseau"
        ? "Ton appareil n'a plus de réseau."
        : "Rien ne répond. Vérifie ta connexion.";
    case "injoignable":
      return liaison.siteRepond
        ? `La salle ${salle} ne répond plus. Le reste du site répond.`
        : `La salle ${salle} ne répond plus.`;
    case "fermee":
      return `La salle ${salle} est fermée.`;
    case "demarrage":
      return "Le jeu démarre.";
    case "arrivee":
      return liaison.perdue
        ? "L'image n'arrive pas."
        : liaison.etape === "image"
          ? "La salle répond. Première image attendue."
          : `Connexion à la salle ${salle}.`;
    case "irreguliere":
      return "Ton image saute. Le format réduit est proposé.";
  }
}

/** La phrase de la ligne parlée quand l'état passe de `avant` à `apres`.
 *
 * Le retour à la normale se dit lui aussi, une fois: sans lui, la dernière
 * annonce resterait « l'image ne bouge plus » pour qui n'a pas l'écran sous les
 * yeux. Rien quand tout allait déjà bien, ni pour un onglet caché. */
export function phraseLiaison(avant: Liaison, apres: Liaison, salle: number): string {
  const dit = parlee(apres, salle);
  if (dit !== "" || apres.etat === "cachee") return dit;
  switch (avant.etat) {
    case "ok":
    case "cachee":
    case "irreguliere":
      return "";
    case "arrivee":
      return "Première image reçue.";
    case "demarrage":
      return "Le jeu a démarré.";
    default:
      return "L'image est revenue.";
  }
}

/** Une demande de manette, dite UNE fois et en mots.
 *
 * L'ancien bandeau était une alerte assertive qui réécrivait « 9 s », « 8 s »…
 * chaque seconde: dix interruptions de suite en pleine partie (audit A11Y-09).
 * Le délai se dit en entier, une fois, avec ce qui arrive sans réponse. */
export function phraseDemande(
  demande: { from: string; port: number } | null,
  secondes: number,
): string {
  if (demande === null) return "";
  return `${demande.from} demande ta manette ${demande.port}. Tu as ${Math.ceil(secondes)} secondes pour répondre. Sans réponse, tu la gardes.`;
}
