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
 * Quand la vidéo tombe, une seule question distingue « la salle ne répond
 * plus » de « rien ne répond »: le reste du site répond-il, MAINTENANT ? La
 * socket du salon ne le dit pas: après une coupure du Wi-Fi, elle se croit
 * ouverte jusqu'à son délai de 45 s (25 s d'intervalle, 20 s d'attente). Une
 * requête qui revient, elle, le prouve. `/api/salles` répond en plus si la
 * salle est ouverte, ce qui sépare une salle fermée d'une salle qui redémarre
 * (audit P10).
 */
import {
  lireLiaison,
  MEMOIRE_VIDE,
  FRAIS_MS,
  type Etat,
  type Liaison,
  type Memoire,
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
    sourceHz: number;
    sinceStartedMs: number | null;
    awaitingRestart: boolean;
  };
  sound: { sinceChunkMs: number | null };
  input: { sinceHeardMs: number | null };
  padOnly: boolean;
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

type Reponse = { a: number; repond: boolean; ouverte: boolean | null };

export class VeilleLiaison {
  private readonly monde: Monde;
  private memoire: Memoire = MEMOIRE_VIDE;
  private contexte: Contexte = { jeu: null, demarrageA: null, proposer: false };
  private vus = new Set<Etat>();
  /** Depuis quand l'onglet est visible: `-Infinity` s'il l'était à l'arrivée. */
  private visibleA: number | null;
  private sondeA: number | null = null;
  private enVol = false;
  private reponse: Reponse | null = null;
  private derniere: Liaison = { etat: "ok" };

  constructor(monde: Monde) {
    this.monde = monde;
    this.visibleA = monde.visible() ? Number.NEGATIVE_INFINITY : null;
  }

  /** Ce que la page sait: le jeu, le démarrage, la proposition. */
  dire(contexte: Contexte): void {
    this.contexte = contexte;
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
    const attend = !flux.padOnly && this.contexte.jeu !== false && this.visibleA !== null;
    if (muette && attend) this.sonder(now);
    const frais = this.reponse !== null && now - this.reponse.a < SONDE_FRAICHE_MS;
    const lu = lireLiaison(
      {
        jeu: this.contexte.jeu,
        manetteSeule: flux.padOnly,
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
          sourceHz: v.sourceHz,
          demarreeDepuisMs: v.sinceStartedMs,
          attendRedemarrage: v.awaitingRestart,
        },
        sonDepuisMs: flux.sound.sinceChunkMs,
        manetteDepuisMs: flux.input.sinceHeardMs,
        site: frais && this.reponse ? (this.reponse.repond ? "repond" : "muet") : null,
        salleOuverte: frais && this.reponse ? this.reponse.ouverte : null,
      },
      this.memoire,
      now,
    );
    this.memoire = lu.memoire;
    this.vus.add(lu.liaison.etat);
    this.derniere = lu.liaison;
    return lu.liaison;
  }

  /** Le dernier état calculé, sans recalculer. */
  actuelle(): Liaison {
    return this.derniere;
  }

  /** Les états vus depuis la dernière fois, et on repart de zéro. Lu par la
   * proposition de format réduit, toutes les dix secondes. */
  prendreVus(): ReadonlySet<Etat> {
    const vus = this.vus;
    this.vus = new Set();
    return vus;
  }

  private sonder(now: number): void {
    if (this.enVol) return;
    if (this.sondeA !== null && now - this.sondeA < SONDE_EVERY_MS) return;
    this.sondeA = now;
    this.enVol = true;
    const numero = this.monde.salle();
    const fin = (reponse: Omit<Reponse, "a">) => {
      this.enVol = false;
      this.reponse = { a: this.monde.now(), ...reponse };
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
        // Une réponse, quelle qu'elle soit, prouve que la liaison passe.
        if (!answer.ok) return fin({ repond: true, ouverte: null });
        const liste: unknown = await answer.json().catch(() => null);
        const trouvee = Array.isArray(liste)
          ? (liste as { numero?: unknown; ouverte?: unknown }[]).find((s) => s?.numero === numero)
          : undefined;
        fin({
          repond: true,
          ouverte: typeof trouvee?.ouverte === "boolean" ? trouvee.ouverte : null,
        });
      })
      .catch(() => fin({ repond: false, ouverte: null }));
  }
}
