/**
 * La veille de la liaison: elle rassemble les signaux des trois flux, demande
 * au site quand il le faut, et passe le tout à la règle pure (`liaison.ts`).
 *
 * Séparée de la règle pour que la règle reste pure, et séparée de la session
 * pour se tester sans socket: tout ce qu'elle lit du monde (l'heure, le
 * réseau, l'onglet, la requête) lui est donné.
 *
 * # La sonde du site
 *
 * Quand la vidéo tombe, la page demande `/api/salles`. La socket du salon ne
 * suffit pas: après une coupure du Wi-Fi, elle se croit ouverte jusqu'à son
 * délai de 45 s (25 s d'intervalle, 20 s d'attente).
 *
 * Ce que la réponse prouve, et rien de plus:
 * - une liste en 2xx: le salon répond. Pas « ta connexion passe »: le
 *   22 septembre 2026, une petite requête passait très bien sur un Wi-Fi qui
 *   ne portait plus le flux;
 * - toute autre réponse: quelque chose a répondu, pas le site. Un 502 du relais
 *   quand le salon est arrêté en est une, et la première version la prenait
 *   pour « le reste du site répond » (relecture du 22 novembre 2026);
 * - rien dans le délai: rien ne répond.
 *
 * Le salon dit aussi si la salle tourne, redémarre ou est fermée. « Fermée »
 * n'est cru qu'après deux réponses espacées (`FERMEE_CONFIRMEE_MS`): le worker
 * SORT à chaque changement de jeu et systemd le relance deux secondes plus
 * tard, et un salon d'avant le champ `redemarre` disait « fermée » pendant ces
 * deux secondes.
 */
import {
  ECHO_FRAIS_MS,
  FRAIS_MS,
  lireLiaison,
  MEMOIRE_VIDE,
  type Etat,
  type Fenetre,
  type Fermeture,
  type Liaison,
  type Memoire,
  type PourFermee,
  type Signaux,
} from "./liaison";

/** Ce que la veille lit des flux, tel que leurs relevés le donnent. */
export type Flux = {
  video: {
    connected: boolean;
    sinceOpenedMs: number | null;
    downForMs: number | null;
    sinceHeardMs: number | null;
    sinceUnitMs: number | null;
    sincePaintedMs: number | null;
    painted: number;
    units: number;
    sinceStartedMs: number | null;
    awaitingRestart: boolean;
  };
  sound: { sinceChunkMs: number | null };
  input: { sinceHeardMs: number | null };
};

/** Ce que la page sait et que les flux ignorent. */
export type Contexte = {
  /** Un jeu tourne-t-il ? `null` tant que la salle n'est pas décrite. */
  jeu: boolean | null;
  /** L'instant (`performance.now`) d'un changement de jeu en cours, ou `null`. */
  demarrageA: number | null;
  /** La page propose le format réduit. */
  proposer: boolean;
};

export type Monde = {
  now: () => number;
  /** L'heure murale (`Date.now()`) : l'heure d'une fermeture se dit en
   * heures et minutes, `now` n'en sait rien. */
  horloge: () => number;
  enLigne: () => boolean;
  visible: () => boolean;
  salle: () => number;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
};

/** Une sonde toutes les trois secondes au plus, en millisecondes. Six fois
 * moins souvent que les tentatives de la vidéo (une toutes les 500 ms), et
 * assez souvent pour que « fermée » arrive avant qu'on ait lu la phrase
 * d'avant. */
export const SONDE_EVERY_MS = 3000;

/** Ce qu'une sonde attend avant de conclure « rien ne répond », en ms.
 *
 * 2,5 s. Sur le lien lent émulé de l'audit des états (22 novembre 2026), les
 * trois requêtes du premier écran prenaient 2,4 s À ELLES TROIS: une seule
 * requête qui dépasse 2,5 s n'est plus une liaison lente. */
export const SONDE_PATIENCE_MS = 2500;

/** Au-delà, une réponse de la sonde ne dit plus rien du présent, en ms: deux
 * sondes manquées et une marge. */
export const SONDE_FRAICHE_MS = 8000;

/** Combien de temps une salle doit rester « fermée » d'une réponse à l'autre
 * avant qu'on la dise fermée, en millisecondes.
 *
 * 2,5 s, plus que `RestartSec=2` de l'unité du worker
 * (`deploy/nel3ab-worker@.service`), qui relance la salle à chaque changement
 * de jeu. Les sondes partent toutes les trois secondes, donc la deuxième
 * réponse tombe après la relance. Une vraie salle fermée se dit donc environ
 * trois secondes plus tard qu'avant, et une salle qui redémarre ne se dit plus
 * jamais fermée. */
export const FERMEE_CONFIRMEE_MS = 2500;

type Reponse = { a: number; site: "repond" | "relais" | "muet"; salle: Signaux["salle"] };

const POUR: readonly PourFermee[] = ["inactivite", "arret", "panne"];

/** L'heure murale d'une fermeture que le salon dit depuis `depuis` secondes,
 * et sa raison quand elle est l'une des trois connues. */
function lireFermeture(depuis: unknown, pour: unknown, mur: number): Fermeture {
  return {
    a:
      typeof depuis === "number" && Number.isFinite(depuis) && depuis >= 0
        ? mur - depuis * 1000
        : null,
    pour: POUR.find((une) => une === pour) ?? null,
  };
}

export class VeilleLiaison {
  private readonly monde: Monde;
  private memoire: Memoire = MEMOIRE_VIDE;
  private contexte: Contexte = { jeu: null, demarrageA: null, proposer: false };
  private vus = new Set<Etat>();
  /** Le gel vu dans la fenêtre: `null` sans gel, sinon vrai tant que chaque
   * relevé figé avait encore le son et l'écho. */
  private gelSalle: boolean | null = null;
  /** La première réponse « fermée » de la série en cours. */
  private fermeeVueA: number | null = null;
  /** L'heure et la raison lues dans la première réponse « fermée » de la
   * série : celles des sondes suivantes, arrondies à la seconde, feraient
   * changer la minute dite sous les yeux. */
  private fermeture: Fermeture | null = null;
  /** Depuis quand l'onglet est visible: `-Infinity` s'il l'était à l'arrivée. */
  private visibleA: number | null;
  private sondeA: number | null = null;
  private enVol = false;
  private reponse: Reponse | null = null;
  private derniere: Liaison = { etat: "ok" };
  /** L'instant du dernier « Relancer l'image », `null` sans relance. */
  private relanceA: number | null = null;

  constructor(monde: Monde) {
    this.monde = monde;
    this.visibleA = monde.visible() ? Number.NEGATIVE_INFINITY : null;
  }

  /** Ce que la page sait: le jeu, le démarrage, la proposition. */
  dire(contexte: Contexte): void {
    this.contexte = contexte;
  }

  /** « Relancer l'image » vient d'être demandé : la règle saura si l'image
   * reste figée après (`APRES_RELANCE_MS`). */
  relancer(): void {
    this.relanceA = this.monde.now();
  }

  /** L'onglet vient peut-être de changer d'état. Appelé par l'événement, et
   * aussi à chaque relevé: un relevé manqué ne doit pas tout fausser. */
  regarder(): void {
    const visible = this.monde.visible();
    if (!visible) this.visibleA = null;
    else if (this.visibleA === null) this.visibleA = this.monde.now();
  }

  /** L'état de la liaison, maintenant. */
  lire(flux: Flux): Liaison {
    this.regarder();
    const now = this.monde.now();
    const v = flux.video;
    const muette = !v.connected || v.sinceHeardMs === null || v.sinceHeardMs >= FRAIS_MS;
    const attend = this.contexte.jeu !== false && this.visibleA !== null;
    if (muette && attend) this.sonder(now);
    // La vidéo parle: une série de « fermée » d'avant ne compte plus pour la
    // prochaine chute.
    if (!muette) {
      this.fermeeVueA = null;
      this.fermeture = null;
    }
    const frais = this.reponse !== null && now - this.reponse.a < SONDE_FRAICHE_MS;
    const lu = lireLiaison(
      {
        jeu: this.contexte.jeu,
        enLigne: this.monde.enLigne(),
        visible: this.visibleA !== null,
        visibleDepuisMs: this.visibleA === null ? 0 : now - this.visibleA,
        demarrageDepuisMs:
          this.contexte.demarrageA === null ? null : now - this.contexte.demarrageA,
        proposer: this.contexte.proposer,
        video: {
          connectee: v.connected,
          ouverteDepuisMs: v.sinceOpenedMs,
          coupeeDepuisMs: v.downForMs,
          entenduDepuisMs: v.sinceHeardMs,
          imageRecueDepuisMs: v.sinceUnitMs,
          peinteDepuisMs: v.sincePaintedMs,
          peintes: v.painted,
          recues: v.units,
          demarreeDepuisMs: v.sinceStartedMs,
          attendRedemarrage: v.awaitingRestart,
        },
        sonDepuisMs: flux.sound.sinceChunkMs,
        manetteDepuisMs: flux.input.sinceHeardMs,
        relanceDepuisMs: this.relanceA === null ? null : now - this.relanceA,
        site: frais && this.reponse ? this.reponse.site : null,
        salle: frais && this.reponse ? this.reponse.salle : null,
        fermeture: frais && this.reponse?.salle === "fermee" ? this.fermeture : null,
      },
      this.memoire,
      now,
    );
    this.memoire = lu.memoire;
    this.vus.add(lu.liaison.etat);
    if (lu.liaison.etat === "figee") {
      const continus =
        flux.sound.sinceChunkMs !== null &&
        flux.sound.sinceChunkMs < FRAIS_MS &&
        flux.input.sinceHeardMs !== null &&
        flux.input.sinceHeardMs < ECHO_FRAIS_MS;
      this.gelSalle = (this.gelSalle ?? true) && continus;
    }
    this.derniere = lu.liaison;
    return lu.liaison;
  }

  /** Le dernier état calculé, sans recalculer. */
  actuelle(): Liaison {
    return this.derniere;
  }

  /** Ce que la fenêtre a vu depuis la dernière fois, et on repart de zéro. Lu
   * par la proposition de format réduit, toutes les dix secondes
   * (`fenetrePourProposition`). */
  prendreFenetre(): Fenetre {
    const fenetre = { vus: this.vus, gelSalle: this.gelSalle === true };
    this.vus = new Set();
    this.gelSalle = null;
    return fenetre;
  }

  private sonder(now: number): void {
    if (this.enVol) return;
    if (this.sondeA !== null && now - this.sondeA < SONDE_EVERY_MS) return;
    this.sondeA = now;
    this.enVol = true;
    const numero = this.monde.salle();
    const fin = (
      site: Reponse["site"],
      dite: Signaux["salle"] | "fermee?",
      fermeture: Fermeture | null = null,
    ) => {
      this.enVol = false;
      const a = this.monde.now();
      let salle: Signaux["salle"] = dite === "fermee?" ? null : dite;
      if (dite === "fermee?") {
        this.fermeeVueA ??= a;
        this.fermeture ??= fermeture;
        if (a - this.fermeeVueA >= FERMEE_CONFIRMEE_MS) salle = "fermee";
      } else {
        this.fermeeVueA = null;
        this.fermeture = null;
      }
      this.reponse = { a, site, salle };
    };
    let signal: AbortSignal | undefined;
    try {
      signal = AbortSignal.timeout(SONDE_PATIENCE_MS);
    } catch {
      signal = undefined;
    }
    this.monde
      .fetch("/api/salles", { cache: "no-store", signal })
      .then(async (answer) => {
        const liste: unknown = answer.ok ? await answer.json().catch(() => null) : null;
        // Seule une LISTE en 2xx est le site. Un 502 du relais, un portail
        // Wi-Fi ou une page d'erreur ont répondu, mais pas lui.
        if (!Array.isArray(liste)) return fin("relais", null);
        const trouvee = (
          liste as {
            numero?: unknown;
            ouverte?: unknown;
            redemarre?: unknown;
            fermee_depuis?: unknown;
            fermee_pour?: unknown;
          }[]
        ).find((s) => s?.numero === numero);
        if (trouvee?.redemarre === true) return fin("repond", "redemarre");
        if (trouvee?.ouverte === true) return fin("repond", "ouverte");
        if (trouvee?.ouverte === false)
          return fin(
            "repond",
            "fermee?",
            lireFermeture(trouvee.fermee_depuis, trouvee.fermee_pour, this.monde.horloge()),
          );
        return fin("repond", null);
      })
      .catch(() => fin("muet", null));
  }
}
