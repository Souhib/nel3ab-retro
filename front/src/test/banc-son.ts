/**
 * Un banc pour `SoundStream`, en temps simulé : une source de son, une
 * liaison, une carte son, et la vraie classe entre les trois.
 *
 * Écrit le 27 novembre 2026 pour SON-1 et SON-4. Les essais d'avant faisaient
 * tourner `scheduleAt` seul et comptaient les trous ; aucun ne regardait ce
 * qui restait en file, et c'est là que le retard pris après une rafale
 * restait pour toute la séance.
 *
 * # Ce que le banc ne simule pas
 *
 * L'horloge de la carte avance en continu, sans les blocs de 128 échantillons
 * d'un vrai contexte. Le son n'est pas écouté : le banc relève où chaque
 * morceau est posé, combien de temps il dure, et ses premiers échantillons.
 */
import { vi } from "vitest";
import { SoundStream } from "../media/sound";

/** La durée d'un morceau, en secondes : dix millisecondes, comme la salle. */
export const MORCEAU_S = 0.01;
const RATE = 48_000;

/** Un morceau posé : quand il commence, combien il dure, et ses premiers
 * échantillons du canal gauche (pour voir un fondu). */
export type Pose = {
  at: number;
  /** L'horloge de la carte quand le morceau a été posé. */
  maintenant: number;
  duree: number;
  debut: number[];
  fin: number[];
};

export function doubluresSon() {
  const etat: {
    contexte: { currentTime: number; state: string; outputLatency: number } | null;
    socket: { onmessage(event: { data: ArrayBuffer }): void } | null;
    poses: Pose[];
  } = { contexte: null, socket: null, poses: [] };
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      currentTime = 0;
      sampleRate = RATE;
      outputLatency = 0;
      baseLatency = 0;
      destination = {};
      constructor() {
        etat.contexte = this;
      }
      createGain() {
        return { gain: { value: 1, setTargetAtTime() {} }, connect() {} };
      }
      createBuffer(_canaux: number, frames: number) {
        const canaux = [new Float32Array(frames), new Float32Array(frames)];
        return {
          length: frames,
          duration: frames / RATE,
          getChannelData: (c: number) => canaux[c],
        };
      }
      createBufferSource() {
        const source = {
          buffer: null as null | { duration: number; getChannelData(c: number): Float32Array },
          connect() {},
          start(at: number) {
            const gauche = source.buffer?.getChannelData(0) ?? new Float32Array(0);
            etat.poses.push({
              at,
              maintenant: etat.contexte?.currentTime ?? 0,
              duree: source.buffer?.duration ?? 0,
              debut: [...gauche.slice(0, 4)],
              fin: [...gauche.slice(-4)],
            });
          },
        };
        return source;
      }
      createMediaStreamDestination() {
        return { stream: {} };
      }
      async resume() {}
      async close() {
        this.state = "closed";
      }
    },
  );
  vi.stubGlobal(
    "Audio",
    class {
      srcObject: unknown = null;
      setAttribute() {}
      play() {
        return Promise.resolve();
      }
      pause() {}
    },
  );
  vi.stubGlobal(
    "WebSocket",
    class {
      static OPEN = 1;
      readyState = 1;
      binaryType = "";
      onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        etat.socket = this as unknown as NonNullable<typeof etat.socket>;
      }
      send() {}
      close() {}
    },
  );
  return etat;
}

/** Un morceau de son : huit octets d'instant de capture, puis 10 ms de PCM
 * stéréo à 48 kHz. L'échantillon vaut `niveau` partout : un fondu se lit
 * alors dans les premiers échantillons posés. */
export function morceau(captureMs: number, niveau = 0.5): ArrayBuffer {
  const frames = RATE * MORCEAU_S;
  const data = new ArrayBuffer(8 + frames * 2 * 2);
  new DataView(data).setBigUint64(0, BigInt(Math.round(captureMs * 1000)), true);
  new Int16Array(data, 8).fill(Math.round(niveau * 32767));
  return data;
}

/** Les arrivées d'un flux régulier : un morceau toutes les 10 ms, de `debut`
 * à `fin` en ms, chacun arrivé `transit(i)` ms après sa capture. */
export function regulier(debut: number, fin: number, transit: (i: number) => number = () => 20) {
  const arrivees: { capture: number; arrivee: number }[] = [];
  for (let i = 0, capture = debut; capture < fin; i++, capture += MORCEAU_S * 1000)
    arrivees.push({ capture, arrivee: capture + transit(i) });
  return arrivees;
}

export type Releve = { instant: number; fileMs: [number, number, number] | null | undefined };

/**
 * Rejoue des arrivées dans une vraie `SoundStream`, avec les minuteurs
 * factices. `derive` décale l'horloge de la carte de tant de parties par
 * million par rapport à celle de la salle. Un relevé est pris toutes les
 * `releveMs` (la fenêtre de la page, prise comme le relevé la prend).
 */
export async function rejouerSon(
  etat: ReturnType<typeof doubluresSon>,
  arrivees: { capture: number; arrivee: number }[],
  options: { derive?: number; releveMs?: number; rendre?: boolean } = {},
) {
  // `rendre` : la coupe de SON-1, qui ne part que sous `?son=rendre`. Absent,
  // la page décide comme dans un vrai navigateur, d'après son adresse.
  const son = new SoundStream(
    (p) => p,
    1,
    false,
    options.rendre === undefined ? {} : { rendre: options.rendre },
  );
  await son.start();
  const contexte = etat.contexte;
  const socket = etat.socket;
  if (contexte === null || socket === null) throw new Error("précondition: pas de contexte");
  const derive = (options.derive ?? 0) / 1e6;
  const releveMs = options.releveMs ?? 10_000;
  const triees = [...arrivees].sort((a, b) => a.arrivee - b.arrivee);
  const fin = triees.at(-1)?.arrivee ?? 0;
  const releves: Releve[] = [];
  let ici = 0;
  let prochain = releveMs;
  const aller = (instant: number) => {
    if (instant > ici) vi.advanceTimersByTime(instant - ici);
    ici = instant;
    contexte.currentTime = (instant / 1000) * (1 + derive);
  };
  for (const une of triees) {
    while (prochain <= une.arrivee) {
      aller(prochain);
      // Une page d'avant la fenêtre n'a pas `fenetre` : le banc rejoue quand
      // même, et l'essai dit ce qui manque au lieu de tomber ici.
      const fenetre = typeof son.fenetre === "function" ? son.fenetre(true) : undefined;
      releves.push({ instant: prochain, fileMs: fenetre?.fileMs });
      prochain += releveMs;
    }
    aller(une.arrivee);
    socket.onmessage({ data: morceau(une.capture) });
  }
  aller(fin + 1);
  return { son, releves, stats: son.stats() };
}
