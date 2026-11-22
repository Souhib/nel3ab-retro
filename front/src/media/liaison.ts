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
 * La seule mémoire est celle du gel, passée en argument et rendue: sortir d'un
 * gel demande une seconde de vraie cadence, sinon l'image isolée qui arrivait
 * toutes les 35 s le 21 novembre ferait clignoter le message.
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
  /** Cette page ne sert que de manette: elle n'attend aucune image. */
  manetteSeule: boolean;
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
    /** La cadence de la source, zéro tant qu'elle n'est pas mesurée. */
    sourceHz: number;
    /** Depuis quand la page attend une image de cette salle. */
    demarreeDepuisMs: number | null;
    /** La page a demandé un autre jeu et l'ancien flux n'est pas encore tombé. */
    attendRedemarrage: boolean;
  };
  /** Depuis le dernier morceau de son reçu, `null` sans son. */
  sonDepuisMs: number | null;
  /** Depuis le dernier message de la socket manette, `null` sans socket. */
  manetteDepuisMs: number | null;
  /** Ce que la dernière sonde du site a vu, tant qu'elle est fraîche. */
  site: "repond" | "muet" | null;
  /** La salle est-elle ouverte, d'après le site ? `null` si on ne sait pas. */
  salleOuverte: boolean | null;
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
    }
  | { etat: "decodeur"; depuisMs: number }
  | { etat: "coupee"; cause: "reseau" | "silence"; depuisMs: number }
  | { etat: "injoignable"; siteRepond: boolean; depuisMs: number }
  | { etat: "fermee" }
  | { etat: "demarrage"; depuisMs: number }
  | {
      etat: "arrivee";
      /** « salle »: la socket n'est pas encore ouverte; « image »: elle l'est. */
      etape: "salle" | "image";
      depuisMs: number;
      /** La fin de l'attente: au-delà, l'écran propose de réessayer ou partir. */
      perdue: boolean;
      /** La salle envoie ses messages, sans image. */
      salleRepond: boolean;
    };

export type Etat = Liaison["etat"];

/** Ce que la fonction retient d'un appel à l'autre: le gel, et sa reprise. */
export type Memoire = {
  figee: null | {
    /** L'instant où l'image s'est arrêtée. */
    depuis: number;
    /** Depuis quand les images reviennent, et combien il en était arrivé. */
    reprise: null | { a: number; recues: number };
  };
};

export const MEMOIRE_VIDE: Memoire = { figee: null };

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
 * Cinq secondes. Les gels que Hyde a SENTIS duraient 4 et 8,9 s (soirées de
 * septembre 2026): à cinq secondes la personne l'a remarqué, et un bandeau
 * plus tôt couvrirait un chargement de jeu qui se tait trois secondes. */
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

/** Ce qu'une reprise doit tenir avant qu'on sorte du gel: une seconde, à 90 %
 * de la cadence du jeu au moins. Le 21 novembre, une image arrivait toutes les
 * 35 s; une seule ne doit pas effacer le message. */
export const REPRISE_MS = 1000;
export const REPRISE_PART = 0.9;
/** La cadence supposée quand la source n'est pas encore mesurée: 20 images
 * par seconde, sous les 25 et 30 des jeux les plus lents de la bibliothèque et
 * six cents fois l'image isolée du 21 novembre. */
export const REPRISE_HZ_PLANCHER = 20;

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

const recent = (ms: number | null, limite: number): boolean => ms !== null && ms < limite;
const age = (ms: number | null): number => ms ?? Number.POSITIVE_INFINITY;

/**
 * L'état de la liaison, et la mémoire du gel pour l'appel suivant.
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
  const rend = (liaison: Liaison, gel: Memoire["figee"] = null) => ({
    liaison,
    memoire: { figee: gel },
  });
  const v = s.video;

  if (!s.visible) return rend({ etat: "cachee" });
  if (!s.enLigne) return rend({ etat: "coupee", cause: "reseau", depuisMs: age(v.coupeeDepuisMs) });
  if (s.manetteSeule) return rend({ etat: "ok" });
  if (s.demarrageDepuisMs !== null || v.attendRedemarrage)
    return rend({ etat: "demarrage", depuisMs: s.demarrageDepuisMs ?? 0 });
  if (s.jeu === false) return rend({ etat: "ok" });

  const down = !v.connectee || !recent(v.entenduDepuisMs, FRAIS_MS);
  const downFor = v.connectee ? age(v.entenduDepuisMs) : age(v.coupeeDepuisMs);
  const salleTombee = (): Liaison =>
    s.site === "muet"
      ? { etat: "coupee", cause: "silence", depuisMs: downFor }
      : s.site === "repond" && s.salleOuverte === false
        ? { etat: "fermee" }
        : { etat: "injoignable", siteRepond: s.site === "repond", depuisMs: downFor };

  // L'arrivée: rien n'a encore été peint. Parler de panne serait faux tant
  // que la salle n'a pas eu le temps de répondre.
  if (v.peintes === 0) {
    if (down && downFor >= ARRIVEE_INJOIGNABLE_MS && s.site !== null) return rend(salleTombee());
    return rend({
      etat: "arrivee",
      etape: v.connectee ? "image" : "salle",
      depuisMs: age(v.demarreeDepuisMs),
      perdue: age(v.demarreeDepuisMs) >= ARRIVEE_LIMITE_MS,
      salleRepond: v.connectee && recent(v.entenduDepuisMs, FRAIS_MS),
    });
  }

  if (down) {
    // Le gel survit à la seconde où l'on relance l'image: la socket se ferme
    // puis se rouvre, et le message ne doit pas clignoter.
    if (downFor < GRACE_MS)
      return memoire.figee
        ? rend(figee(s, memoire.figee.depuis, maintenant), memoire.figee)
        : rend({ etat: "ok" });
    return rend(salleTombee());
  }

  // La socket est ouverte et la salle parle. L'image bouge-t-elle ?
  const calme = Math.min(age(v.imageRecueDepuisMs), age(v.ouverteDepuisMs), s.visibleDepuisMs);
  if (memoire.figee) {
    const reprise = reprendre(s, memoire.figee.reprise, maintenant);
    if (reprise === "sortie") return suite(s);
    const garde = { depuis: memoire.figee.depuis, reprise };
    return rend(figee(s, garde.depuis, maintenant), garde);
  }
  if (calme >= FIGEE_MS) {
    // La durée DITE est le temps depuis la dernière image, pas depuis la
    // reconnexion ou le retour sur l'onglet: c'est ce que la personne a vu.
    const debut = maintenant - (v.imageRecueDepuisMs ?? calme);
    return rend(figee(s, debut, maintenant), { depuis: debut, reprise: null });
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
      memoire: { figee: null },
    };
  if (s.proposer) return { liaison: { etat: "irreguliere" }, memoire: { figee: null } };
  return { liaison: { etat: "ok" }, memoire: { figee: null } };
}

function figee(s: Signaux, depuis: number, maintenant: number): Liaison {
  const depuisMs = Math.max(0, maintenant - depuis);
  return {
    etat: "figee",
    depuisMs,
    son: recent(s.sonDepuisMs, FRAIS_MS),
    manette: recent(s.manetteDepuisMs, ECHO_FRAIS_MS),
    niveau: depuisMs >= FIGEE_BANDEAU_MS ? "bandeau" : "pastille",
  };
}

/** La reprise d'un gel: rien tant que les images ne reviennent pas, une
 * reprise qui commence, ou la sortie quand elle a tenu une seconde à la
 * cadence du jeu. Une image qui tarde plus d'une demi-seconde la remet à zéro. */
function reprendre(
  s: Signaux,
  avant: { a: number; recues: number } | null,
  maintenant: number,
): { a: number; recues: number } | null | "sortie" {
  if (!recent(s.video.imageRecueDepuisMs, FREEZE_GAP_MS)) return null;
  if (avant === null) return { a: maintenant, recues: s.video.recues };
  const duree = maintenant - avant.a;
  const hz = s.video.sourceHz > 0 ? s.video.sourceHz : REPRISE_HZ_PLANCHER;
  const voulu = REPRISE_PART * hz * (duree / 1000);
  return duree >= REPRISE_MS && s.video.recues - avant.recues >= voulu ? "sortie" : avant;
}

/** L'écart entre deux images au-delà duquel une reprise recommence, en ms.
 * Le seuil de ce que les joueurs sentent (`FREEZE_MS`, `lib/vitals`). */
const FREEZE_GAP_MS = 500;

/**
 * La fenêtre de dix secondes doit-elle compter pour la proposition de format
 * réduit ?
 *
 * Non, dès qu'elle a vu autre chose que la salle en marche: un gel de la
 * salle, une coupure, une arrivée, un démarrage, un appareil qui ne décode
 * plus ou un onglet caché. Aucune de ces fenêtres ne dit si la LIAISON porte
 * le plein format, et toutes ressemblent à une mauvaise liaison pour `rough`.
 * Le 22 novembre 2026, l'audit a vu la proposition sortir douze secondes après
 * un gel, puis juste après une coupure (E4).
 */
export function retenirProposition(vus: ReadonlySet<Etat>): boolean {
  for (const vu of vus) if (vu !== "ok" && vu !== "irreguliere") return true;
  return false;
}
