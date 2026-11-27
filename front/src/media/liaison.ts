/**
 * L'état de la liaison: ce que la page sait de ce qui lui arrive, en un mot.
 *
 * # Le trou que ça bouche
 *
 * Le 21 novembre 2026, l'image de Sonic est restée figée vingt minutes. Le son
 * continuait, la socket vidéo restait ouverte et recevait les messages vides
 * que la salle envoie toutes les 500 ms. Tous les détecteurs de la page
 * regardaient la CONNEXION: elle allait bien, donc la page n'a rien dit. Les
 * chiffres pour le savoir étaient pourtant là, dans un panneau replié.
 *
 * # Une fonction pure, et une seule
 *
 * Elle prend les signaux que la page possède déjà et rend UN état. Le décider
 * à un seul endroit, c'est ne plus avoir trois écrans qui se contredisent
 * (« récupération », « connexion », « aucune surcharge détectée »). Pure, parce
 * qu'un état qu'on ne peut pas provoquer dans un test est un état qu'on ne
 * vérifie qu'un soir de panne. Elle vit dans la couche média et jamais dans
 * React (règle 8): la session la calcule deux fois par seconde, React affiche.
 *
 * Deux mémoires seulement, passées en argument et rendues. Celle du gel: en
 * sortir demande une seconde d'images sans trou, sinon l'image isolée qui
 * arrivait toutes les 35 s le 21 novembre ferait clignoter le message. Et celle
 * de la salle tombée: on n'en sort que sur une image, sinon une socket rouverte
 * et muette ferait dire « L'image est revenue. » sans une image (relecture du
 * 22 novembre 2026).
 *
 * # Ce qu'elle ne suppose pas
 *
 * Chaque état ne s'appuie que sur un fait observé ici. « Le reste du site
 * répond » vient d'une requête qui a répondu, pas de la socket du salon, qui
 * peut se croire ouverte quarante-cinq secondes après une coupure du Wi-Fi.
 */

/** Ce que la page sait, en durées. `null` veut dire « jamais » ou « sans
 * objet », jamais zéro: une absence affichée comme un zéro a déjà menti quatre
 * fois dans ce projet. */
export type Signaux = {
  /** Un jeu tourne-t-il ? `null` tant que la salle n'est pas décrite. */
  jeu: boolean | null;
  /** `navigator.onLine`: faux veut dire que l'appareil n'a plus de réseau. */
  enLigne: boolean;
  /** L'onglet est-il visible ? */
  visible: boolean;
  /** Depuis quand il l'est, en millisecondes. */
  visibleDepuisMs: number;
  /** Un changement de jeu annoncé par le salon ou demandé ici, depuis quand. */
  demarrageDepuisMs: number | null;
  /** La page propose le format réduit (`Struggling`, deux fenêtres mauvaises). */
  proposer: boolean;
  video: {
    /** La socket vidéo est-elle ouverte ? */
    connectee: boolean;
    /** Depuis quand la socket actuelle est ouverte. */
    ouverteDepuisMs: number | null;
    /** Depuis quand la vidéo est coupée. */
    coupeeDepuisMs: number | null;
    /** Depuis le dernier message, vide compris: la salle est-elle là ? */
    entenduDepuisMs: number | null;
    /** Depuis le dernier message qui portait une image. */
    imageRecueDepuisMs: number | null;
    /** Depuis la dernière image peinte à l'écran. */
    peinteDepuisMs: number | null;
    /** Images peintes depuis que ce flux existe: zéro veut dire « arrivée ». */
    peintes: number;
    /** Messages portant une image, reçus depuis que ce flux existe. */
    recues: number;
    /** Depuis quand la page attend une image de cette salle. */
    demarreeDepuisMs: number | null;
    /** La page a demandé un autre jeu et l'ancien flux n'est pas encore tombé. */
    attendRedemarrage: boolean;
  };
  /** Depuis le dernier morceau de son reçu, `null` sans son. */
  sonDepuisMs: number | null;
  /** Depuis le dernier message de la socket manette, `null` sans socket. */
  manetteDepuisMs: number | null;
  /** Depuis le dernier « Relancer l'image » de cette page, `null` sans relance. */
  relanceDepuisMs: number | null;
  /** Ce que la dernière sonde du site a vu, tant qu'elle est fraîche.
   *
   * « repond »: une liste de salles en 2xx, donc le salon répond. « relais »:
   * une réponse, mais pas celle du site (un 502 du relais quand le salon est
   * arrêté, un portail Wi-Fi). « muet »: rien n'est revenu dans le délai. */
  site: "repond" | "relais" | "muet" | null;
  /** Ce que le salon dit de la salle, `null` si on ne sait pas. « fermee »
   * n'arrive ici que CONFIRMÉE par deux sondes (`veille.ts`): une seule réponse
   * « fermée » tombe aussi pendant les deux secondes d'un redémarrage. */
  salle: "ouverte" | "redemarre" | "fermee" | null;
  /** L'heure et la raison de la fermeture, telles que le salon les publie
   * (`Salle.fermee_depuis`, `Salle.fermee_pour`, lus par `veille.ts`, K37).
   * Rien quand le salon ne les dit pas : une salle jamais démarrée depuis le
   * démarrage de la machine, ou un salon d'avant ces champs. */
  fermeture?: Fermeture | null;
};

/** Pourquoi le salon dit la salle fermée : personne n'a touché au jeu,
 * quelqu'un l'a fermée, ou tout le reste. */
export type PourFermee = "inactivite" | "arret" | "panne";

export type Fermeture = {
  /** L'heure murale de la fermeture (`Date.now()`), `null` si inconnue. */
  a: number | null;
  pour: PourFermee | null;
};

export type Liaison =
  | { etat: "ok" }
  | { etat: "cachee" }
  | { etat: "irreguliere" }
  | {
      etat: "figee";
      /** Depuis quand l'image ne bouge plus, image isolée comprise. */
      depuisMs: number;
      /** Le son arrive encore: le jeu tourne. */
      son: boolean;
      /** La manette reçoit encore son écho: la salle entend. */
      manette: boolean;
      /** Une pastille d'abord, puis le bandeau avec ses actions. */
      niveau: "pastille" | "bandeau";
      /** Une relance a eu lieu pendant ce gel, il y a au moins
       * `APRES_RELANCE_MS`, et l'image n'est pas revenue : relancer encore ne
       * sert plus, signaler devient le geste. */
      apresRelance: boolean;
    }
  | { etat: "decodeur"; depuisMs: number }
  | { etat: "coupee"; cause: "reseau" | "silence"; depuisMs: number }
  | {
      etat: "injoignable";
      /** Ce que la sonde a vu du reste du site, `null` tant qu'elle n'a rien dit. */
      site: "repond" | "relais" | null;
      /** Pendant l'arrivée: la salle n'a encore jamais répondu à cette page. */
      arrivee: boolean;
      depuisMs: number;
    }
  | {
      etat: "redemarre";
      /** Pendant l'arrivée, l'état se pose sur le rideau. */
      arrivee: boolean;
    }
  | ({ etat: "fermee" } & Fermeture)
  | {
      etat: "demarrage";
      depuisMs: number;
      /** Ce que l'écran de chargement montre déjà: un démarrage qui traîne, ou
       * perdu. Posé par la page, qui tient l'écran (`lib/booting`). */
      attente?: "long" | "echec";
      /** Le jeu qui démarre, quand la page le sait : les phrases le nomment. */
      jeu?: string;
      /** Qui peut le relancer après un échec : cette page, quelqu'un de
       * nommé, ou personne qu'on connaisse. */
      relance?: "moi" | { nom: string } | null;
      /** L'habitude de ce jeu est mesurée (D05) : la lenteur peut dire
       * « d'habitude ». Sans elle, elle ne le dit pas (C5). */
      habitude?: boolean;
      /** Le seuil de l'attente longue, en secondes : « depuis 20 s » se dit
       * au passage, et ne change plus ensuite (le compteur ne parle pas). */
      seuilS?: number;
    }
  | {
      etat: "arrivee";
      /** « salle »: la socket n'est pas encore ouverte; « image »: elle l'est. */
      etape: "salle" | "image";
      depuisMs: number;
      /** La fin de l'attente: au-delà, l'écran propose de réessayer ou partir. */
      perdue: boolean;
      /** La salle envoie ses messages, sans image. */
      salleRepond: boolean;
      /** Depuis quand elle répond ainsi (la socket ouverte qu'on entend),
       * `null` quand elle ne répond pas. C'est le chiffre de « La salle
       * répond depuis 15 s, sans envoyer d'image. » */
      repondDepuisMs: number | null;
    };

export type Etat = Liaison["etat"];

/** Ce que la fonction retient d'un appel à l'autre. */
export type Memoire = {
  /** Le gel, et sa reprise. */
  figee: null | {
    /** L'instant où l'image s'est arrêtée. */
    depuis: number;
    /** Depuis quand les images reviennent, et combien il en était arrivé. */
    reprise: null | { a: number; recues: number };
    /** Le dernier relevé qui a vu l'image encore arrêtée: la durée dite
     * s'arrête là pendant une reprise. */
    vuA: number;
  };
  /** La salle tombée: depuis la dernière preuve de vie. On n'en sort que sur
   * une image arrivée APRÈS, ou sur un gel quand la salle répond sans image. */
  tombee: null | { depuis: number };
};

export const MEMOIRE_VIDE: Memoire = { figee: null, tombee: null };

/** Sous ce délai, une coupure ne se montre pas, en millisecondes.
 *
 * Une seconde. La vidéo se rebranche 500 ms après une fermeture
 * (`video.ts`, `onclose`), et une poignée de main locale prend quelques
 * dizaines de millisecondes: un hoquet réparé par une reconnexion finit avant.
 * L'audit des états (22 novembre 2026) demandait « rien sous une seconde ». */
export const GRACE_MS = 1000;

/** Sans image depuis ce délai, socket ouverte et octets qui arrivent: l'image
 * est figée côté salle, en millisecondes.
 *
 * Deux secondes. Les pages qui ne sentaient rien restaient sous 250 ms entre
 * deux images, hors démarrage (soirées des 22 et 25 septembre 2026, voir
 * `FREEZE_MS` dans `lib/vitals`); deux secondes en font huit fois plus. C'est
 * aussi le silence que la page juge déjà mortel pour les octets
 * (`SILENCE_LIMIT`). Dolphin taisait autrefois une image fixe pendant 2,1 s;
 * il la présente depuis `SkipDuplicateXFBs = False` (worker, main.rs). */
export const FIGEE_MS = 2000;

/** À partir de quand la pastille devient un bandeau avec ses actions, en
 * millisecondes.
 *
 * Cinq secondes. Les gels qu'un joueur a SENTIS le 22 septembre 2026 duraient
 * 4 et 8,9 s (carnet, « Un gel de page n'est pas un gel de salle »): à cinq
 * secondes la personne l'a remarqué, et un bandeau plus tôt couvrirait un
 * chargement de jeu qui se tait trois secondes. */
export const FIGEE_BANDEAU_MS = 5000;

/** Un message, son ou image, plus vieux que ça ne compte plus, en ms.
 *
 * 1,5 s, soit trois messages vides manqués: la salle en envoie un toutes les
 * 500 ms quand elle n'a rien d'autre (`KEEP_ALIVE`, transport). */
export const FRAIS_MS = 1500;

/** L'écho de la manette, plus vieux que ça, ne compte plus, en ms.
 *
 * 2,5 s: un aller-retour part chaque seconde (`ECHO_EVERY_MS`), donc deux
 * manqués et une demi-seconde de marge. */
export const ECHO_FRAIS_MS = 2500;

/** Ce qu'une reprise doit tenir avant qu'on sorte du gel: une seconde sans
 * trou senti. Le 21 novembre, une image arrivait toutes les 35 s; une seule ne
 * doit pas effacer le message.
 *
 * La première version demandait en plus 90 % de `sourceHz`. C'était faux, et la
 * relecture adverse l'a reproduit dans un navigateur: `sourceHz` est la MÉDIANE
 * des écarts entre instants de capture, et ces instants tombent sur les tics de
 * 16,67 ms du compositeur. Un jeu à 45 images par seconde donne des écarts de
 * 1, 1 et 2 tics, une médiane d'un tic, donc « 60 »: la page exigeait 54 images
 * par seconde et restait figée pendant que l'image bougeait. */
export const REPRISE_MS = 1000;

/** L'écart entre deux images au-delà duquel une reprise recommence, en ms.
 * Le seuil de ce que les joueurs sentent (`FREEZE_MS`, `lib/vitals`). */
const FREEZE_GAP_MS = 500;

/** Le moins d'images par seconde qu'une reprise peut compter, et c'est une
 * conséquence plutôt qu'un réglage: un flux sans aucun trou de `FREEZE_GAP_MS`
 * envoie au moins deux images par seconde. Le compte sert à ne pas
 * croire un relevé chanceux: les relevés tombent toutes les 500 ms, et une
 * image isolée lue juste après son arrivée ne doit rien prouver. */
export const REPRISE_HZ_PLANCHER = 1000 / FREEZE_GAP_MS;

/** Combien de temps un gel survit à une coupure, en millisecondes.
 *
 * Trois secondes, trois fois la grâce. « Relancer l'image » ferme la socket et
 * en ouvre une autre: TCP, TLS et la mise à niveau WebSocket font quelques
 * allers-retours, soit environ une seconde à 300 ms d'aller-retour par un
 * relais. Le message ne doit ni basculer sur « la salle ne répond plus » ni
 * revenir à « en marche » pendant ce temps. Pas mesuré sur un vrai relais. */
export const COUPURE_GEL_MS = 3000;

/** Des images arrivent mais aucune n'est peinte depuis ce délai, en ms: c'est
 * l'appareil. Le même seuil que le chien de garde du décodeur
 * (`SILENCE_LIMIT`), qui le reconstruit au-delà. */
export const DECODEUR_MS = 2000;

/** La fin d'une arrivée sans première image, en millisecondes.
 *
 * Quinze secondes. La salle fabrique une image-clé dès qu'une page arrive et
 * en refait toutes les 500 ms (`KEY_FRAME_EVERY`). Sur le banc simulé du
 * 22 novembre 2026 (vrai flux H.264, de vraies WebSocket, en local), la
 * première image était peinte 525 à 544 ms après le clic d'entrée, sur cinq
 * entrées: quinze secondes en font près de trente fois plus. Pas mesuré sur
 * un téléphone en relais. L'audit P3 demandait quinze secondes, et l'ancien
 * écran n'avait pas de fin. */
export const ARRIVEE_LIMITE_MS = 15_000;

/** Pendant une arrivée, une salle qui refuse depuis ce délai alors que le site
 * répond est dite injoignable, en millisecondes. Cinq secondes, soit une
 * dizaine de tentatives (une toutes les 500 ms): audit E6. */
export const ARRIVEE_INJOIGNABLE_MS = 5000;

/** Ce qu'une relance doit laisser passer avant qu'on la dise vaine, en ms.
 *
 * Dix secondes. Une relance ferme la socket et en ouvre une autre, puis la
 * salle fabrique une image-clé (`KEY_FRAME_EVERY`, 500 ms) : sur le banc
 * simulé du 22 novembre 2026, la première image venait 525 à 544 ms après
 * l'entrée. Dix secondes en font près de vingt fois plus, et laissent passer
 * la reconnexion d'un relais lent (`COUPURE_GEL_MS`). Pas mesuré sur un vrai
 * relais. */
export const APRES_RELANCE_MS = 10_000;

const recent = (ms: number | null, limite: number): boolean => ms !== null && ms < limite;
const age = (ms: number | null): number => ms ?? Number.POSITIVE_INFINITY;

/**
 * L'état de la liaison, et la mémoire pour l'appel suivant.
 *
 * L'ordre des règles est l'ordre de ce qui l'emporte: un onglet caché ne voit
 * rien, un appareil sans réseau ne peut rien recevoir, un démarrage annoncé
 * explique tout le reste, et ainsi de suite.
 */
export function lireLiaison(
  s: Signaux,
  memoire: Memoire,
  maintenant: number,
): { liaison: Liaison; memoire: Memoire } {
  const rend = (liaison: Liaison, garde: Memoire = MEMOIRE_VIDE) => ({ liaison, memoire: garde });
  const v = s.video;

  if (!s.visible) return rend({ etat: "cachee" });
  const down = !v.connectee || !recent(v.entenduDepuisMs, FRAIS_MS);
  const downFor = v.connectee ? age(v.entenduDepuisMs) : age(v.coupeeDepuisMs);
  /** La salle tombée, retenue depuis sa dernière preuve de vie. */
  const tombeeDepuis = memoire.tombee?.depuis ?? maintenant - downFor;
  if (!s.enLigne)
    return rend(
      { etat: "coupee", cause: "reseau", depuisMs: age(v.coupeeDepuisMs) },
      // Retenue comme une salle tombée: le réseau revenu, seule une image
      // dira que l'image est revenue.
      { figee: memoire.figee, tombee: { depuis: tombeeDepuis } },
    );
  if (s.demarrageDepuisMs !== null || v.attendRedemarrage)
    return rend({ etat: "demarrage", depuisMs: s.demarrageDepuisMs ?? 0 });
  if (s.jeu === false) return rend({ etat: "ok" });

  const salleTombee = (arrivee: boolean, depuisMs: number): Liaison =>
    s.site === "muet"
      ? { etat: "coupee", cause: "silence", depuisMs }
      : s.site === "repond" && s.salle === "fermee"
        ? { etat: "fermee", a: s.fermeture?.a ?? null, pour: s.fermeture?.pour ?? null }
        : s.site === "repond" && s.salle === "redemarre"
          ? { etat: "redemarre", arrivee }
          : { etat: "injoignable", site: s.site, arrivee, depuisMs };

  // L'arrivée: rien n'a encore été peint. Parler de panne serait faux tant
  // que la salle n'a pas eu le temps de répondre.
  if (v.peintes === 0) {
    if (down && downFor >= ARRIVEE_INJOIGNABLE_MS && s.site !== null)
      return rend(salleTombee(true, downFor));
    const salleRepond = v.connectee && recent(v.entenduDepuisMs, FRAIS_MS);
    return rend({
      etat: "arrivee",
      etape: v.connectee ? "image" : "salle",
      depuisMs: age(v.demarreeDepuisMs),
      perdue: age(v.demarreeDepuisMs) >= ARRIVEE_LIMITE_MS,
      salleRepond,
      // La socket ouverte, et entendue : c'est depuis son ouverture que la
      // salle répond à cette page.
      repondDepuisMs: salleRepond ? v.ouverteDepuisMs : null,
    });
  }

  if (down) {
    // Le gel survit à la relance de l'image: la socket se ferme puis se
    // rouvre, et le message ne doit ni clignoter ni changer de cause.
    const gel = memoire.figee;
    if (gel && downFor < COUPURE_GEL_MS) {
      const garde = { ...gel, reprise: null, vuA: maintenant };
      return rend(figee(s, garde, maintenant), { figee: garde, tombee: memoire.tombee });
    }
    if (downFor < GRACE_MS && memoire.tombee === null) return rend({ etat: "ok" });
    // Le gel est GARDÉ à travers la chute: une socket rouverte qui n'apporte
    // pas d'image le retrouve, au lieu de passer par « en marche ».
    return rend(salleTombee(false, maintenant - tombeeDepuis), {
      figee: gel,
      tombee: { depuis: tombeeDepuis },
    });
  }

  // La salle parle de nouveau. Une salle tombée n'est revenue que sur une
  // IMAGE arrivée après sa chute: un message vide sur une socket rouverte dit
  // seulement qu'elle répond. Sans image au bout de deux secondes, c'est un gel.
  if (memoire.tombee) {
    const imageApres =
      v.imageRecueDepuisMs !== null && v.imageRecueDepuisMs < maintenant - memoire.tombee.depuis;
    if (!imageApres && memoire.figee === null && age(v.ouverteDepuisMs) < FIGEE_MS)
      return rend(salleTombee(false, maintenant - memoire.tombee.depuis), memoire);
  }

  // La socket est ouverte et la salle parle. L'image bouge-t-elle ?
  const calme = Math.min(age(v.imageRecueDepuisMs), age(v.ouverteDepuisMs), s.visibleDepuisMs);
  if (memoire.figee) {
    const reprise = reprendre(s, memoire.figee.reprise, maintenant);
    if (reprise === "sortie") return suite(s);
    const gel = {
      depuis: memoire.figee.depuis,
      reprise,
      vuA: reprise === null ? maintenant : memoire.figee.vuA,
    };
    return rend(figee(s, gel, maintenant), { figee: gel, tombee: null });
  }
  if (calme >= FIGEE_MS) {
    // La durée DITE est le temps depuis la dernière image, pas depuis la
    // reconnexion ou le retour sur l'onglet: c'est ce que la personne a vu.
    const gel = {
      depuis: maintenant - (v.imageRecueDepuisMs ?? calme),
      reprise: null,
      vuA: maintenant,
    };
    return rend(figee(s, gel, maintenant), { figee: gel, tombee: null });
  }
  return suite(s);
}

/** Ce qui reste quand l'image bouge: l'appareil, la proposition, ou rien. */
function suite(s: Signaux): { liaison: Liaison; memoire: Memoire } {
  const v = s.video;
  const installe = Math.min(age(v.ouverteDepuisMs), s.visibleDepuisMs);
  if (
    recent(v.imageRecueDepuisMs, FRAIS_MS) &&
    age(v.peinteDepuisMs) >= DECODEUR_MS &&
    installe >= DECODEUR_MS
  )
    return {
      liaison: { etat: "decodeur", depuisMs: age(v.peinteDepuisMs) },
      memoire: MEMOIRE_VIDE,
    };
  if (s.proposer) return { liaison: { etat: "irreguliere" }, memoire: MEMOIRE_VIDE };
  return { liaison: { etat: "ok" }, memoire: MEMOIRE_VIDE };
}

/** L'état figé. Pendant une reprise, la durée s'arrête au dernier relevé qui
 * a vu l'image arrêtée: une image qui bouge ne doit pas faire monter la
 * pastille au bandeau, ni le compteur au-delà de ce que la personne a vu. */
function figee(s: Signaux, gel: NonNullable<Memoire["figee"]>, maintenant: number): Liaison {
  const depuisMs = Math.max(0, (gel.reprise === null ? maintenant : gel.vuA) - gel.depuis);
  return {
    etat: "figee",
    depuisMs,
    son: recent(s.sonDepuisMs, FRAIS_MS),
    manette: recent(s.manetteDepuisMs, ECHO_FRAIS_MS),
    niveau: depuisMs >= FIGEE_BANDEAU_MS ? "bandeau" : "pastille",
    apresRelance: apresRelance(s.relanceDepuisMs, gel.depuis, maintenant),
  };
}

/** La relance a eu lieu PENDANT ce gel (après son début), et l'image n'est
 * pas revenue depuis `APRES_RELANCE_MS`. Une relance d'un gel d'avant ne
 * compte pas : ce gel-ci n'a pas encore été relancé. */
function apresRelance(relanceDepuisMs: number | null, gelDepuis: number, maintenant: number) {
  if (relanceDepuisMs === null || relanceDepuisMs < APRES_RELANCE_MS) return false;
  return maintenant - relanceDepuisMs >= gelDepuis;
}

/** La reprise d'un gel: rien tant que les images ne reviennent pas, une
 * reprise qui commence, ou la sortie quand elle a tenu une seconde sans trou.
 * Un relevé qui voit une image de plus d'une demi-seconde la remet à zéro, et
 * le compte (`REPRISE_HZ_PLANCHER`) refuse une image isolée lue au bon moment.
 * Aucune cadence de la source n'entre ici: voir `REPRISE_MS`. */
function reprendre(
  s: Signaux,
  avant: { a: number; recues: number } | null,
  maintenant: number,
): { a: number; recues: number } | null | "sortie" {
  if (!recent(s.video.imageRecueDepuisMs, FREEZE_GAP_MS)) return null;
  if (avant === null) return { a: maintenant, recues: s.video.recues };
  const duree = maintenant - avant.a;
  const voulu = REPRISE_HZ_PLANCHER * (duree / 1000);
  return duree >= REPRISE_MS && s.video.recues - avant.recues >= voulu ? "sortie" : avant;
}

/** Ce qu'une fenêtre de dix secondes a vu, tel que la veille le rend. */
export type Fenetre = {
  vus: ReadonlySet<Etat>;
  /** Un gel a été vu, et à CHAQUE relevé figé le son et l'écho de la manette
   * arrivaient encore. Faux s'il n'y a pas eu de gel. */
  gelSalle: boolean;
};

export const FENETRE_VIDE: Fenetre = { vus: new Set(), gelSalle: false };

/**
 * Que fait la proposition de format réduit de cette fenêtre de dix secondes ?
 *
 * « tenir »: un jeu démarre, la proposition attend trente secondes de plus
 * (`Struggling.hold`), comme avant. « ignorer »: la fenêtre ne dit rien de la
 * liaison, elle ne compte ni pour ni contre (`Struggling.ignore`). « compter »:
 * elle compte, bonne ou mauvaise.
 *
 * Ce qui est ignoré: ce que la salle dit d'elle-même (fermée, redémarre),
 * l'appareil qui ne décode plus, l'onglet caché, l'arrivée, et un gel pendant
 * lequel le son et l'écho ont continué. Le 21 novembre 2026, le son et la
 * manette passaient pendant tout le gel: la liaison portait, la capture non.
 *
 * Ce qui COMPTE, et la première version se trompait là: une coupure, et un gel
 * sans le son ou sans l'écho. Une liaison qui cale ressemble exactement à ça
 * vue d'ici, et c'est le cas pour lequel la proposition existe: les arrêts de
 * 4 et 8,9 s du 22 septembre 2026 ne touchaient qu'une page. Qu'une petite
 * requête au site passe ne prouve rien, elle passe aussi sur un Wi-Fi qui ne
 * porte plus le flux. La première version appelait `hold()` pour chacune de
 * ces fenêtres: le compte repartait de zéro et la page restait aveugle
 * quarante secondes, donc une liaison qui cale toutes les seize secondes ne se
 * voyait plus jamais rien proposer (relecture du 22 novembre 2026).
 */
export function fenetrePourProposition(fenetre: Fenetre): "tenir" | "ignorer" | "compter" {
  const vus = fenetre.vus;
  if (vus.has("demarrage")) return "tenir";
  for (const vu of ["fermee", "redemarre", "decodeur", "cachee", "arrivee"] as const)
    if (vus.has(vu)) return "ignorer";
  if (vus.has("figee") && fenetre.gelSalle) return "ignorer";
  return "compter";
}
