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
import { placeN, prixImageLegere } from "./mots";
import { ROUGH_IN_A_ROW, VITALS_EVERY } from "./vitals";

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
  redemarre: "salle qui redémarre",
  fermee: "salle fermée",
  demarrage: "démarrage",
  arrivee: "arrivée",
};

const RIEN: Dit = { niveau: "rien", pose: "repos", titre: "", actions: [] };

const enSecondes = (ms: number) => Math.max(0, Math.floor(ms / 1000));

/** Ce que la page dit d'un état. `moteur` est celui de la console du jeu
 * (`consoles.moteurDe`): il décide si le prix de l'image légère est un chiffre
 * mesuré ou un effet. */
export function dire(liaison: Liaison, salle: number, moteur: string | null = null): Dit {
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
        // « entière » et pas « complète »: le lexique garde « image complète »
        // pour la qualité de l'image (vérification finale du 22 novembre 2026).
        detail: "Relancer l'image repart d'une image entière.",
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
    case "injoignable": {
      // Le fait que la sonde a vu, et lui seul. « ta connexion passe » a été
      // retiré: c'était une cause supposée, et une petite requête passe aussi
      // sur un Wi-Fi qui ne porte plus le flux (22 septembre 2026).
      const detail =
        liaison.site === "repond"
          ? "Le reste du site répond. La page réessaie toute seule."
          : liaison.site === "relais"
            ? "Le reste du site ne répond pas non plus. La page réessaie toute seule."
            : "La page réessaie toute seule.";
      // « Signaler » passe par le salon: le proposer quand la sonde n'a pas vu
      // le site répondre promettrait un repère qui ne partira pas.
      const actions: Action[] =
        liaison.site === "repond" ? ["reessayer", "signaler", "quitter"] : ["reessayer", "quitter"];
      if (liaison.arrivee)
        // Elle n'a encore jamais répondu à cette page: « ne répond plus »
        // serait faux. Le rideau garde ses étapes, aucune n'est faite.
        return {
          niveau: "rideau",
          pose: "loupe",
          titre: `La salle ${salle} ne répond pas.`,
          detail,
          actions,
          etapes: [
            { texte: "la salle répond", fait: false },
            { texte: "première image", fait: false },
          ],
        };
      return {
        niveau: "bandeau",
        pose: "loupe",
        titre: `La salle ${salle} ne répond plus.`,
        detail,
        actions,
      };
    }
    case "redemarre":
      // Le salon le dit de systemd: le worker est sorti (un changement de jeu,
      // un plantage) et sera relancé. Pas « fermée », et rien à faire.
      return {
        niveau: liaison.arrivee ? "rideau" : "bandeau",
        pose: "marche",
        titre: `La salle ${salle} redémarre.`,
        detail: "La page la rejoint dès qu'elle répond.",
        actions: ["quitter"],
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
        // La durée vient des deux constantes qui la font, pas d'un nombre
        // recopié (vérification finale du 22 novembre 2026).
        titre: `Ton image saute depuis ${(ROUGH_IN_A_ROW * VITALS_EVERY) / 1000} secondes.`,
        // Le chiffre n'est dit que là où il a été mesuré (`prixImageLegere`).
        detail: `L'image légère demande ${prixImageLegere(moteur)}.`,
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
    case "injoignable": {
      const titre = liaison.arrivee
        ? `La salle ${salle} ne répond pas.`
        : `La salle ${salle} ne répond plus.`;
      return liaison.site === "repond"
        ? `${titre} Le reste du site répond.`
        : liaison.site === "relais"
          ? `${titre} Le reste du site ne répond pas non plus.`
          : titre;
    }
    case "redemarre":
      return `La salle ${salle} redémarre.`;
    case "fermee":
      return `La salle ${salle} est fermée.`;
    case "demarrage":
      // Ce que l'écran de chargement montre, dit aussi pour qui ne le voit
      // pas (audit A11Y-07): la lenteur, puis l'échec et sa sortie.
      // Le nom du jeu quand la page le connaît (C9). Le compteur ne parle
      // pas : « depuis 20 s » est le seuil franchi, pas l'attente du moment.
      if (liaison.jeu !== undefined) {
        const jeu = liaison.jeu;
        if (liaison.attente === "echec") {
          const relance =
            liaison.relance === null
              ? " Tu peux le relancer ou choisir un autre jeu."
              : liaison.relance !== undefined
                ? ` ${liaison.relance} peut le relancer.`
                : "";
          return `Aucune image de ${jeu}.${relance}`;
        }
        if (liaison.attente === "long")
          return liaison.habitude
            ? `${jeu} met plus longtemps que d'habitude.`
            : liaison.seuilS !== undefined
              ? `${jeu} démarre encore, depuis ${liaison.seuilS} s.`
              : `${jeu} démarre encore.`;
        return `${jeu} démarre.`;
      }
      return liaison.attente === "echec"
        ? "La salle n'a pas rendu d'image."
        : liaison.attente === "long"
          ? liaison.habitude
            ? "Le jeu met plus longtemps que d'habitude."
            : "Le jeu démarre encore."
          : "Le jeu démarre.";
    case "arrivee":
      return liaison.perdue
        ? "L'image n'arrive pas."
        : liaison.etape === "image"
          ? "La salle répond. Première image attendue."
          : `Connexion à la salle ${salle}.`;
    case "irreguliere":
      return "Ton image saute. L'image légère est proposée.";
  }
}

/** La phrase de la ligne parlée quand l'état passe de `avant` à `apres`.
 *
 * Le retour à la normale se dit lui aussi, une fois: sans lui, la dernière
 * annonce resterait « l'image ne bouge plus » pour qui n'a pas l'écran sous les
 * yeux. Rien quand tout allait déjà bien, ni pour un onglet caché.
 *
 * `peintes` est le nombre d'images que la page a peintes: une salle au repos
 * sort de l'arrivée sans aucune, et « Première image reçue. » y était faux
 * (vérification finale du 22 novembre 2026). */
export function phraseLiaison(
  avant: Liaison,
  apres: Liaison,
  salle: number,
  peintes: number,
): string {
  const dit = parlee(apres, salle);
  if (dit !== "" || apres.etat === "cachee") return dit;
  switch (avant.etat) {
    case "ok":
    case "cachee":
    case "irreguliere":
      return "";
    case "arrivee":
      return peintes > 0 ? "Première image reçue." : "";
    case "demarrage":
      return "Le jeu a démarré.";
    default:
      return "L'image est revenue.";
  }
}

// ==== chantier personnes ====
/** Une demande de place, dite UNE fois et en mots.
 *
 * L'ancien bandeau était une alerte assertive qui réécrivait « 9 s », « 8 s »…
 * chaque seconde: dix interruptions de suite en pleine partie (audit A11Y-09).
 * Le délai se dit en entier, une fois, avec ce qui arrive sans réponse.
 *
 * Ce qui arrive sans réponse dépend du chemin du salon (23 novembre 2026,
 * chantier personnes). La reprise, que la page emploie, laisse l'autre
 * prendre la place après le délai (`api/ws/recovery.py`) ; l'ancienne
 * demande `ask`, que la page écoute encore, la laisse à qui la tient. La
 * phrase disait « tu la gardes » pour les deux, le contraire du salon sur
 * le chemin de tous les jours. Sans chemin dit, c'est l'ancienne demande :
 * le seul appelant d'avant ce changement. */
export function phraseDemande(
  demande: { from: string; port: number; chemin?: "reprise" | "ancienne" } | null,
  secondes: number,
): string {
  if (demande === null) return "";
  const sansReponse =
    demande.chemin === "reprise" ? `${demande.from} pourra la prendre.` : "tu la gardes.";
  return `${demande.from} demande ta place ${demande.port}. Tu as ${Math.ceil(secondes)} secondes pour répondre. Sans réponse, ${sansReponse}`;
}
// ==== fin personnes ====

/** Une ligne du résumé de la connexion. */
export type LigneResume = { nom: string; valeur: string };

/**
 * Le résumé de « état de la connexion », l'entrée du menu qui a remplacé la
 * rubrique « mesures ».
 *
 * Son nom promettait un état et sa valeur disait « 1234 images », son aide
 * « 60 Hz à l'écran » (relecture du 22 novembre 2026). L'état d'abord, par son
 * nom (`NOM_ETAT`), puis les faits que la page mesure, en mots. Le détail
 * complet, avec les compteurs, reste dans la colonne.
 */
export function resumeConnexion(
  liaison: Liaison,
  faits: { images: number; hz: number; port: number | null },
): LigneResume[] {
  return [
    { nom: "état", valeur: NOM_ETAT[liaison.etat] },
    // Les images PEINTES, pas reçues: ce compteur se fige justement quand
    // l'image arrive et que l'appareil ne l'affiche plus (état « decodeur »).
    {
      nom: "images affichées",
      valeur: faits.images.toLocaleString("fr-FR").replace(/\s/gu, " "),
    },
    { nom: "ton écran", valeur: `${Math.round(faits.hz)} images par seconde` },
    // L'emplacement 1 à 4 est une place; la manette est l'objet qu'on tient.
    { nom: "ta place", valeur: faits.port === null ? "aucune" : placeN(faits.port) },
  ];
}
