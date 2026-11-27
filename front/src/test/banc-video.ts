/**
 * Un banc pour `VideoStream`, en temps simulé : une source, une liaison, un
 * écran, et la vraie classe entre les trois.
 *
 * # Pourquoi passer par la classe et pas par `nextSlack`
 *
 * Le défaut du 27 novembre 2026 (la marge collée au plancher, VID-1) n'était
 * pas dans la règle : il était dans l'appelant, qui passait à la règle la
 * somme de deux gestes de sens opposé. Un essai de la règle seule restait vert
 * sur la page cassée. Ce banc rejoue donc les arrivées et les tics d'écran
 * dans la classe elle-même, avec les minuteurs factices de vitest : l'horloge
 * de `performance.now()` avance avec eux.
 *
 * # Ce que le banc ne simule pas
 *
 * Le décodeur rend chaque image aussitôt, sans coût. Le fil principal ne
 * bloque jamais, sauf quand un scénario saute des tics. Les nombres qu'il
 * donne sont ceux de l'arithmétique de la page, pas ceux d'un navigateur.
 */
import { vi } from "vitest";
import { VideoStream, type FenetreVideo, type Marge, type VideoStats } from "../media/video";

/** La période d'une source à 60 images par seconde, en millisecondes. */
export const SOURCE_MS = 1000 / 60;

/** Une image : son instant de capture et son instant d'arrivée, en ms depuis
 * le début du scénario. */
export type Arrivee = { capture: number; arrivee: number };

export type Scenario = {
  /** La période des tics d'écran. */
  ecranMs: number;
  /** Combien de secondes simuler. */
  secondes: number;
  /** Les images, dans l'ordre d'arrivée (l'ordre de TCP). */
  arrivees: Arrivee[];
  /** Vrai pour un tic que le navigateur ne donne pas (un fil bloqué). */
  ticSaute?: (instant: number) => boolean;
  /** Sous quelle marge comparer : la nouvelle ou l'ancienne. */
  marge?: Marge;
};

/** Ce que le banc relève à la fin de chaque fenêtre de deux secondes : les
 * compteurs, et ce que la fenêtre a vu de pire, PRIS comme le relevé de la
 * page le prend (`Session.fenetre`). */
export type Releve = { instant: number; stats: VideoStats; fenetre: FenetreVideo | null };

export type Resultat = {
  releves: Releve[];
  /** Les instants de capture peints, dans l'ordre, avec le tic et l'instant
   * qui les ont peints. */
  peintes: { capture: number; tic: number; instant: number }[];
  /** Le plus long temps sans image neuve à l'écran, en ms, après les deux
   * premières secondes : ce que l'œil voit d'un arrêt (VID-4). */
  arretMax: number;
  /** La plus grande marge vue. */
  margeMax: number;
  /** La première fenêtre où l'allure a renoncé, ou nul. */
  renonce: number | null;
  fin: VideoStats;
};

/** L'instant de capture tel que le worker l'écrit : en microsecondes, avec
 * une origine loin de zéro pour que les retards ne soient jamais négatifs. */
const ORIGINE_MS = 1_000;

/**
 * Pose les doublures : la toile, `requestAnimationFrame`, la socket et le
 * décodeur. À appeler dans `beforeEach`, après `vi.useFakeTimers()`.
 */
export function doublures() {
  const etat: {
    peindre: FrameRequestCallback | null;
    socket: { onopen(): void; onmessage(event: { data: ArrayBuffer }): void } | null;
    dessins: number[];
  } = { peindre: null, socket: null, dessins: [] };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: (frame: { timestamp: number }) => etat.dessins.push(frame.timestamp / 1000),
    clearRect: () => {},
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    etat.peindre = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ half: true }))),
  );
  vi.stubGlobal(
    "WebSocket",
    class {
      static OPEN = 1;
      readyState = 1;
      send = () => {};
      close = () => {};
      constructor() {
        etat.socket = this as unknown as NonNullable<typeof etat.socket>;
      }
    },
  );
  vi.stubGlobal(
    "VideoDecoder",
    class {
      state = "configured";
      decodeQueueSize = 0;
      configure = () => {};
      close = () => {};
      private readonly rendre: VideoDecoderInit;
      constructor(rendre: VideoDecoderInit) {
        this.rendre = rendre;
      }
      decode(chunk: { timestamp: number }) {
        this.rendre.output({
          timestamp: chunk.timestamp,
          displayWidth: 1280,
          displayHeight: 720,
          close: () => {},
        } as unknown as VideoFrame);
      }
    },
  );
  vi.stubGlobal("EncodedVideoChunk", function (this: object, init: object) {
    Object.assign(this, init);
  });
  return etat;
}

/** Une image-clé minuscule derrière ses huit octets d'instant de capture. */
function message(captureMs: number): ArrayBuffer {
  const data = new Uint8Array(20);
  new DataView(data.buffer).setBigUint64(0, BigInt(Math.round(captureMs * 1000)), true);
  data.set([0, 0, 1, 0x67, 0x42, 0, 0x1e, 0, 0, 1, 0x65, 1], 8);
  return data.buffer;
}

/** Rejoue un scénario dans une vraie `VideoStream`. */
export function rejouer(etat: ReturnType<typeof doublures>, scenario: Scenario): Resultat {
  const video = new VideoStream(document.createElement("canvas"), (p) => p, {
    marge: scenario.marge ?? "lisse",
  });
  video.start();
  let socket = etat.socket;
  if (socket === null) throw new Error("la doublure de socket n'a pas été construite");
  socket.onopen();
  const t0 = performance.now();
  const fin = scenario.secondes * 1000;
  type Evenement = { instant: number; genre: "tic" | "image" | "releve"; capture?: number };
  const evenements: Evenement[] = [];
  for (let instant = 0; instant <= fin; instant += scenario.ecranMs)
    evenements.push({ instant, genre: "tic" });
  for (const une of scenario.arrivees)
    if (une.arrivee <= fin)
      evenements.push({ instant: une.arrivee, genre: "image", capture: une.capture });
  for (let instant = 2000; instant <= fin; instant += 2000)
    evenements.push({ instant: instant + 0.001, genre: "releve" });
  // À instant égal, l'image d'abord : un message est une tâche, le tic vient
  // au rendu suivant.
  const rang = { image: 0, tic: 1, releve: 2 };
  evenements.sort((a, b) => a.instant - b.instant || rang[a.genre] - rang[b.genre]);

  const releves: Releve[] = [];
  const peintes: Resultat["peintes"] = [];
  let tics = 0;
  let margeMax = video.stats().slackMs;
  let renonce: number | null = null;
  let ici = 0;
  for (const evenement of evenements) {
    const pas = evenement.instant - ici;
    if (pas > 0) vi.advanceTimersByTime(pas);
    ici = evenement.instant;
    if (evenement.genre === "image") {
      // Après plus de deux secondes sans un octet, le chien de garde de la
      // page ferme sa socket et en rouvre une : les images suivantes passent
      // par la nouvelle, comme chez le worker.
      if (etat.socket !== null && etat.socket !== socket) {
        socket = etat.socket;
        socket.onopen();
      }
      socket.onmessage({ data: message(ORIGINE_MS + (evenement.capture ?? 0)) });
      continue;
    }
    if (evenement.genre === "releve") {
      const stats = video.stats();
      // Une page d'avant la fenêtre n'a pas `fenetre` : le banc la rejoue
      // quand même, et l'essai dit ce qui manque au lieu de tomber ici.
      const fenetre = typeof video.fenetre === "function" ? video.fenetre(true) : null;
      releves.push({ instant: evenement.instant, stats, fenetre });
      margeMax = Math.max(margeMax, stats.slackMs);
      if (renonce === null && stats.overloaded) renonce = evenement.instant;
      continue;
    }
    if (scenario.ticSaute?.(evenement.instant)) continue;
    tics += 1;
    const avant = etat.dessins.length;
    etat.peindre?.(t0 + evenement.instant);
    for (const capture of etat.dessins.slice(avant))
      peintes.push({ capture: capture - ORIGINE_MS, tic: tics, instant: evenement.instant });
  }
  const stats = video.stats();
  video.stop();
  let arretMax = 0;
  for (let i = 1; i < peintes.length; i++)
    if (peintes[i - 1].instant >= 2000)
      arretMax = Math.max(arretMax, peintes[i].instant - peintes[i - 1].instant);
  return { releves, peintes, arretMax, margeMax, renonce, fin: stats };
}

/** Une source à 60 images par seconde, sur une liaison qui met `base` ms. */
export function reguliere(secondes: number, base = 20): Arrivee[] {
  const images: Arrivee[] = [];
  for (let k = 0; k * SOURCE_MS <= secondes * 1000; k++) {
    const capture = k * SOURCE_MS;
    images.push({ capture, arrivee: capture + base });
  }
  return images;
}

/** Les images qui arrivent pendant `[debut, debut + ms[` sont retenues et
 * livrées ensemble à `debut + ms`, dans l'ordre : un arrêt de la liaison. */
export function retenue(images: Arrivee[], debut: number, ms: number): Arrivee[] {
  return images.map((une) =>
    une.arrivee >= debut && une.arrivee < debut + ms ? { ...une, arrivee: debut + ms } : une,
  );
}

/**
 * Des rafales : chaque seconde, la liaison retient les images `retenueMs`,
 * puis les livre ensemble, dans l'ordre (TCP ne double personne).
 *
 * C'est la forme du 26 novembre 2026 chez le joueur distant : une capture
 * régulière à 17-21 ms d'écart, et une page qui voyait 117 à 147 ms.
 */
export function rafales(secondes: number, retenueMs: number, base = 20): Arrivee[] {
  return reguliere(secondes, base).map((une) => {
    const dans = une.arrivee % 1000;
    const debut = 500;
    if (dans < debut || dans >= debut + retenueMs) return une;
    return { capture: une.capture, arrivee: une.arrivee - dans + debut + retenueMs };
  });
}
