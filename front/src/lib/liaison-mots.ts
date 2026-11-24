/**
 * Ce que la salle dit de la liaison : une phrase, un fait, un geste.
 *
 * L'état se décide dans la couche média (`media/liaison.ts`) ; ici on ne fait
 * que le DIRE. Séparé des composants pour deux raisons. Les mots se vérifient
 * sans rendu : chaque phrase ci-dessous a son essai, et une garde refuse les
 * mots d'atelier et les tirets cadratins. Et la ligne parlée doit dire
 * exactement la même chose que l'écran, sans recopier la phrase ailleurs.
 *
 * La règle des mots, tirée de l'audit des textes du 22 novembre 2026 : l'effet
 * d'abord, puis le fait qui le prouve, jamais une cause supposée. « Le son
 * arrive encore » est un fait mesuré ici ; « le serveur a planté » n'en est
 * pas un. Le propriétaire calibre sur ce que les joueurs ressentent.
 *
 * Depuis le thème rétro (24 novembre 2026, ADR D40), l'état quitte l'image :
 * une pastille hors de l'image peinte, une fiche dans la colonne, la bande ou
 * la feuille, et le plein cadre de la borne quand il n'y a pas d'image du
 * tout. Bobine est partie ; la mascotte joue ses scènes ailleurs
 * (`lib/etat-scene.ts`), et ces mots ne dépendent plus d'un dessin.
 */
import type { Liaison, PourFermee } from "../media/liaison";
import { ATTENTE_LONGUE_S } from "./booting";
import { enBouton, IMAGE, placeN, prixImageLegere } from "./mots";
import { ROUGH_IN_A_ROW, VITALS_EVERY } from "./vitals";

/** Les gestes qu'un état propose, nommés par ce qu'ils font. « Signaler » n'en
 * est pas un : il a sa propre place (`Dit.signaler`). */
export type Action =
  | "relancer"
  | "reessayer"
  | "quitter"
  | "salles"
  | "carnet"
  | "reduire"
  | "garder"
  | "rester"
  | "revenir"
  | "garder-legere";

/** Les icônes en pixels d'une pastille (`retro/icones.ts`). */
export type IconeEtat =
  | "arret"
  | "ecran-noir"
  | "coupe"
  | "inconnu"
  | "decroche"
  | "relance"
  | "lune"
  | "plume"
  | "saute";

/** La pastille : un voyant hors de l'image, un mot et son icône. `offre` : une
 * proposition, au contour en pointillés, pas une alerte. */
export type Pastille = {
  texte: string;
  icone: IconeEtat;
  offre?: boolean;
  /** Une durée en secondes, en chiffres d'afficheur, qui avance sans être lue. */
  compteur?: number;
};

export type Etape = { texte: string; fait: boolean };

export type Dit = {
  /** Où le dire. « rien » : l'état ne se montre pas (le démarrage a son propre
   * écran). « plein » : le plein cadre de la borne, à la place d'une image qui
   * n'existe pas (encore, ou plus). « fiche » : une fiche hors de l'image, avec
   * ses gestes, et sa pastille. « pastille » : le voyant seul. */
  niveau: "rien" | "pastille" | "fiche" | "plein";
  titre: string;
  /** Le fait qui prouve l'état. */
  detail?: string;
  /** Ce que coûte le geste, dit sous lui. */
  cout?: string;
  actions: Action[];
  /** Où se pose « Signaler » : à côté du geste, en dernière ligne de la fiche,
   * en geste plein quand relancer n'a pas suffi, ou nulle part (le salon ne
   * répond pas, ou rien à signaler). Jamais deux à l'écran (K25). */
  signaler: "a-cote" | "derniere-ligne" | "plein" | null;
  pastille: Pastille | null;
  etapes?: Etape[];
};

/** Ce que la page sait en plus de la liaison, pour la dire. */
export type Contexte = {
  /** Le moteur de la console du jeu (`consoles.moteurDe`) : le prix de l'image
   * légère n'est un chiffre que là où il a été mesuré. */
  moteur?: string | null;
  /** Le nom du jeu en cours, quand la salle l'a dit. */
  jeu?: string | null;
  /** La page vit sous un salon : la sortie mène aux autres salles. Servie
   * seule, elle quitte la salle. */
  salon?: boolean;
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

const RIEN: Dit = { niveau: "rien", titre: "", actions: [], signaler: null, pastille: null };

const enSecondes = (ms: number) => Math.max(0, Math.floor(ms / 1000));

/** La place et la manette ne bougent pas pendant qu'on relance. */
const GARDEES = "Ta place et ta manette restent.";

/** Pourquoi la salle a fermé, dit en une phrase. L'inactivité ne donne pas
 * de durée : la demi-heure par défaut se remplace par
 * `NEL3AB_CLOSE_AFTER_SECS`, que la page ne lit pas. */
const RAISON_FERMEE: Record<PourFermee, string> = {
  inactivite: "Personne n'avait touché au jeu depuis longtemps.",
  arret: "Quelqu'un l'a fermée.",
  panne: "Elle s'est arrêtée sur une panne.",
};

/** « 23 h 12 », « 9 h 05 » : l'heure murale de `a`, à l'heure de l'appareil. */
export function heureDite(a: number): string {
  const quand = new Date(a);
  return `${quand.getHours()} h ${String(quand.getMinutes()).padStart(2, "0")}`;
}

/** « Rien ne répond » : un titre pour un fait, quelle que soit la panne qui
 * le montre (coupée par silence, ou injoignable derrière un relais). */
function rienNeRepond(enPartie: boolean): Dit {
  return {
    niveau: enPartie ? "fiche" : "plein",
    titre: "Rien ne répond, ni la salle ni le reste du site.",
    detail: "La page réessaie toute seule.",
    cout: "Ta page ne voit pas de quel côté ça coince.",
    actions: ["reessayer"],
    // Signaler passe par le salon, qui ne répond pas.
    signaler: null,
    // Le plein cadre dit l'état sur l'écran : pas de pastille à côté.
    pastille: enPartie ? { texte: "Rien ne répond", icone: "inconnu" } : null,
  };
}

/** Ce que la page dit d'un état. */
export function dire(liaison: Liaison, salle: number, contexte: Contexte = {}): Dit {
  const sortie: Action = contexte.salon ? "salles" : "quitter";
  switch (liaison.etat) {
    case "ok":
    case "cachee":
    case "demarrage":
      return RIEN;
    case "figee": {
      const secondes = enSecondes(liaison.depuisMs);
      const pastille: Pastille = { texte: "Image figée", icone: "arret", compteur: secondes };
      if (liaison.niveau === "pastille")
        return { ...RIEN, niveau: "pastille", titre: "Image figée", pastille };
      // Un message vide de la salle toutes les 500 ms est ce qui fait entrer
      // dans cet état : « la salle répond » est donc toujours un fait ici.
      const detail = liaison.son
        ? "Le son arrive encore."
        : "La salle répond, mais n'envoie plus d'image.";
      if (liaison.apresRelance)
        return {
          niveau: "fiche",
          titre: "L'image reste figée après la relance.",
          detail,
          cout: "Signaler note ce moment, avec les mesures des deux dernières minutes.",
          actions: ["relancer"],
          signaler: "plein",
          pastille,
        };
      return {
        niveau: "fiche",
        titre: `L'image ne bouge plus depuis ${secondes} s.`,
        detail,
        cout: GARDEES,
        actions: ["relancer"],
        signaler: "a-cote",
        pastille,
      };
    }
    case "decodeur":
      return {
        niveau: "fiche",
        titre: "L'image arrive, mais ton appareil ne l'affiche plus.",
        detail: `Rien n'est affiché depuis ${enSecondes(liaison.depuisMs)} s; la salle envoie toujours.`,
        // « entière » et pas « complète » : le lexique garde « image complète »
        // pour la qualité de l'image (vérification finale du 22 novembre 2026).
        cout: `Elle repart d'une image entière. ${GARDEES}`,
        actions: ["relancer"],
        signaler: "a-cote",
        pastille: { texte: "Affichage arrêté", icone: "ecran-noir" },
      };
    case "coupee":
      if (liaison.cause === "silence") return rienNeRepond(true);
      return {
        niveau: "fiche",
        titre: "Ton appareil n'a plus de réseau.",
        detail: "La page se reconnecte dès qu'il revient.",
        // Pas de « Réessayer » : la page réessaie toutes les 500 ms, un
        // bouton ne ferait rien de plus tant que le recul des essais
        // n'existe pas (constat E11, reporté).
        actions: [],
        signaler: null,
        pastille: { texte: "Plus de réseau", icone: "coupe" },
      };
    case "injoignable": {
      // Un relais qui répond à la place du site : le même fait que « rien ne
      // répond », avec les mêmes mots.
      if (liaison.site === "relais") {
        const rien = rienNeRepond(!liaison.arrivee);
        return liaison.arrivee ? { ...rien, actions: ["reessayer", sortie] } : rien;
      }
      // Le fait que la sonde a vu, et lui seul. « ta connexion passe » a été
      // retiré : c'était une cause supposée, et une petite requête passe
      // aussi sur un Wi-Fi qui ne porte plus le flux (22 septembre 2026).
      const detail =
        liaison.site === "repond"
          ? "Le reste du site répond. La page réessaie toute seule."
          : "La page réessaie toute seule.";
      // « Signaler » passe par le salon : le proposer quand la sonde n'a pas
      // vu le site répondre promettrait un repère qui ne partira pas.
      const signaler = liaison.site === "repond" ? "a-cote" : null;
      if (liaison.arrivee)
        // Elle n'a encore jamais répondu à cette page : « ne répond plus »
        // serait faux.
        return {
          niveau: "plein",
          titre: `La salle ${salle} ne répond pas.`,
          detail,
          actions: ["reessayer", sortie],
          signaler,
          pastille: null,
        };
      return {
        niveau: "fiche",
        titre: `La salle ${salle} ne répond plus.`,
        detail,
        actions: ["reessayer"],
        signaler,
        pastille: { texte: "La salle ne répond plus", icone: "decroche" },
      };
    }
    case "redemarre":
      // Le salon le dit de systemd : le worker est sorti (un changement de
      // jeu, un plantage) et sera relancé. Pas « fermée », et rien à faire.
      if (liaison.arrivee)
        return {
          niveau: "plein",
          titre: `La salle ${salle} redémarre.`,
          detail: "La page la rejoint dès qu'elle répond.",
          actions: [sortie],
          signaler: null,
          pastille: null,
        };
      return {
        niveau: "fiche",
        titre: `La salle ${salle} redémarre.`,
        detail: "La page la rejoint dès qu'elle répond.",
        cout: "Rien à faire: la page revient seule dans la salle.",
        actions: [],
        signaler: null,
        pastille: { texte: "La salle redémarre", icone: "relance" },
      };
    case "fermee":
      return {
        niveau: "plein",
        // L'heure et la raison que le salon publie (K37) ; sans elles, le
        // fait seul, jamais une heure inventée.
        titre:
          liaison.a === null
            ? `La salle ${salle} est fermée.`
            : `La salle ${salle} a fermé à ${heureDite(liaison.a)}.`,
        detail:
          (liaison.pour ? `${RAISON_FERMEE[liaison.pour]} ` : "") +
          "Ce que tu as sauvegardé dans le jeu est gardé. " +
          "Le reste de la partie s'est arrêté avec la salle.",
        // Le carnet une seule fois, sous un salon seulement : servie seule,
        // la page n'a pas de carnet (D12).
        actions: contexte.salon ? [sortie, "carnet"] : [sortie],
        signaler: null,
        pastille: null,
      };
    case "arrivee": {
      if (!liaison.perdue)
        return {
          niveau: "plein",
          titre: `Connexion à la salle ${salle}.`,
          // Le fait, quand la salle a dit son jeu : on arrive au milieu
          // d'une partie, pas à son début.
          detail: contexte.jeu
            ? `Une partie de ${contexte.jeu} est en cours: tu arrives au milieu.`
            : undefined,
          actions: [],
          signaler: null,
          pastille: null,
          etapes: [
            { texte: "la salle répond", fait: liaison.etape === "image" },
            { texte: "première image", fait: false },
          ],
        };
      return {
        niveau: "plein",
        titre: "L'image n'arrive pas.",
        detail:
          liaison.repondDepuisMs !== null
            ? `La salle répond depuis ${enSecondes(liaison.repondDepuisMs)} s, sans envoyer d'image.`
            : liaison.etape === "salle"
              ? "La salle ne répond pas encore."
              : "La liaison est ouverte, sans image.",
        cout: "Réessayer rouvre la liaison, sans recharger la page.",
        actions: ["reessayer", sortie],
        signaler: null,
        pastille: null,
      };
    }
    case "irreguliere":
      return {
        niveau: "fiche",
        // La durée vient des deux constantes qui la font, pas d'un nombre
        // recopié (vérification finale du 22 novembre 2026).
        titre: `Ton image saute depuis ${(ROUGH_IN_A_ROW * VITALS_EVERY) / 1000} s.`,
        // Trois phrases pour tenir la garde des soixante-dix caractères. Le
        // chiffre n'est dit que là où il a été mesuré (`prixImageLegere`).
        detail:
          "L'image légère est moins nette. " +
          `Elle demande ${prixImageLegere(contexte.moteur ?? null)}. ` +
          "Elle ne change que ton écran.",
        actions: ["reduire", "garder"],
        signaler: null,
        pastille: { texte: "L'image saute", icone: "saute", offre: true },
      };
  }
}

/** La salle va fermer faute d'activité, dans `minutes`. `place` : cette page
 * tient une place, et peut dire « je reste » ; un spectateur n'a que la
 * pastille (il n'a rien à garder ouvert). */
export function direFermeture(minutes: number, place: boolean): Dit {
  const duree = `${minutes} min`;
  return {
    niveau: place ? "fiche" : "pastille",
    titre: `La salle ferme dans ${duree}.`,
    detail:
      "Une touche du jeu suffit: manette, clavier ou écran. " +
      "Ce qui n'est pas sauvegardé dans le jeu s'arrêtera avec elle.",
    actions: place ? ["rester"] : [],
    signaler: null,
    pastille: { texte: `Ferme dans ${duree}`, icone: "lune" },
  };
}

/** L'image est passée en image légère toute seule : on le dit, et on laisse
 * revenir. « n'arrivaient plus assez régulièrement » traduit `pacingGaveUp`
 * (la marge de l'horloge au plafond cinq fenêtres de suite) : c'est une
 * traduction, pas une phrase vérifiée auprès d'un joueur. */
export function direLegere(): Dit {
  return {
    niveau: "fiche",
    titre: "Ton image est passée en image légère.",
    detail: "Les images n'arrivaient plus assez régulièrement. Elle ne change que ton écran.",
    actions: ["revenir", "garder-legere"],
    signaler: null,
    pastille: { texte: enBouton(IMAGE.legere), icone: "plume" },
  };
}

/** Qui peut relancer un jeu qui n'a pas rendu d'image : soi, quelqu'un de
 * nommé, ou personne qu'on connaisse. */
export type Relance = NonNullable<Extract<Liaison, { etat: "demarrage" }>["relance"]> | null;

/** Ce que la ligne parlée dit d'un démarrage, demandé par le chantier menus
 * (C1a, C5, C9) : le nom du jeu, la lenteur au seuil, puis l'échec et qui peut
 * relancer. Jamais « d'habitude » : aucune habitude n'est mesurée (C5). */
export function phraseDemarrage(
  attente: "long" | "echec" | undefined,
  jeu: string | null = null,
  relance: Relance = null,
): string {
  const nom = jeu ?? "Le jeu";
  if (attente === "echec") {
    const aucune = jeu ? `Aucune image de ${jeu}.` : "Aucune image du jeu.";
    if (relance === "moi") return `${aucune} Tu peux le relancer.`;
    if (relance !== null) return `${aucune} ${relance.nom} peut le relancer.`;
    return aucune;
  }
  if (attente === "long") return `${nom} démarre encore, depuis ${ATTENTE_LONGUE_S} s.`;
  return `${nom} démarre.`;
}

/** Ce que la ligne parlée dit d'un état, sans durée : une durée qui avance
 * ferait relire la ligne chaque demi-seconde. */
function parlee(liaison: Liaison, salle: number): string {
  switch (liaison.etat) {
    case "ok":
    case "cachee":
      return "";
    case "figee": {
      if (liaison.apresRelance) return "L'image reste figée après la relance. Tu peux le signaler.";
      // Deux annonces : le gel, puis le geste quand la fiche paraît.
      if (liaison.niveau === "bandeau") return "Tu peux relancer l'image.";
      return liaison.son
        ? "L'image ne bouge plus. Le son arrive encore."
        : "L'image ne bouge plus. La salle répond encore.";
    }
    case "decodeur":
      return "Ton appareil n'affiche plus l'image.";
    case "coupee":
      return liaison.cause === "reseau"
        ? "Ton appareil n'a plus de réseau."
        : "Rien ne répond, ni la salle ni le reste du site.";
    case "injoignable": {
      if (liaison.site === "relais") return "Rien ne répond, ni la salle ni le reste du site.";
      const titre = liaison.arrivee
        ? `La salle ${salle} ne répond pas.`
        : `La salle ${salle} ne répond plus.`;
      return liaison.site === "repond" ? `${titre} Le reste du site répond.` : titre;
    }
    case "redemarre":
      return `La salle ${salle} redémarre.`;
    case "fermee":
      return `La salle ${salle} est fermée.`;
    case "demarrage":
      // Ce que l'écran de chargement montre, dit aussi pour qui ne le voit
      // pas (audit A11Y-07) : la lenteur, puis l'échec et sa sortie.
      return phraseDemarrage(liaison.attente, liaison.jeu ?? null, liaison.relance ?? null);
    case "arrivee":
      if (liaison.perdue)
        return liaison.salleRepond
          ? "L'image n'arrive pas. La salle répond, sans envoyer d'image."
          : "L'image n'arrive pas. La salle ne répond pas encore.";
      return liaison.etape === "image"
        ? "La salle répond. Première image attendue."
        : `Connexion à la salle ${salle}.`;
    case "irreguliere":
      return "Ton image saute. L'image légère est proposée.";
  }
}

/** La phrase de la ligne parlée quand l'état passe de `avant` à `apres`.
 *
 * Le retour à la normale se dit lui aussi, une fois : sans lui, la dernière
 * annonce resterait « l'image ne bouge plus » pour qui n'a pas l'écran sous
 * les yeux. Rien quand tout allait déjà bien, ni pour un onglet caché.
 *
 * `peintes` est le nombre d'images que la page a peintes : une salle au repos
 * sort de l'arrivée sans aucune, et « L'image est là. » y serait faux
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
      return peintes > 0 ? "L'image est là." : "";
    case "demarrage":
      return avant.jeu ? `${avant.jeu} a démarré.` : "Le jeu a démarré.";
    default:
      return "L'image est revenue.";
  }
}

/** La phrase de la ligne parlée quand le compte de fermeture passe de
 * `avant` à `apres` minutes : une à l'entrée, une à la dernière minute, une
 * quand la salle reste ouverte. Jamais chaque minute. */
export function phraseFermeture(avant: number, apres: number): string {
  if (apres > 0 && avant === 0)
    return apres === 1
      ? "La salle ferme dans une minute. Une touche du jeu suffit pour rester."
      : `La salle ferme dans ${apres} minutes. Une touche du jeu suffit pour rester.`;
  if (apres === 1 && avant > 1) return "La salle ferme dans une minute.";
  if (apres === 0 && avant > 0) return "La salle reste ouverte.";
  return "";
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
