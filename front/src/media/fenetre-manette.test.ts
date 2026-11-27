/**
 * Ce que la fenêtre de relevé voit de la manette (chantier 2 de l'audit du
 * 27 novembre 2026).
 *
 * Le 26 novembre 2026, le worker n'a reçu aucune trame de manette dans 18 %
 * des intervalles d'image d'un joueur distant. La pompe des manettes tourne
 * sur le fil principal, comme la réception des images : un fil bloqué et une
 * liaison qui hoquette donnent le même signe au worker. Le relevé dit
 * maintenant le plus long tour de la pompe, et la queue des aller-retours
 * (p95 et max) au lieu de leur seule médiane.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InputStream, askEcho, readEcho } from "./input";

/** L'horloge de la page, tenue à la main : un fil bloqué laisse passer le
 * temps sans qu'aucun minuteur ne tourne. */
let ici = 0;
let stream: InputStream;
const envoyes: Uint8Array[] = [];
/** Les sockets que la page a ouvertes : la dernière est la sienne. */
const sockets: { onmessage: ((event: { data: ArrayBuffer }) => void) | null }[] = [];

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  ici = 0;
  vi.spyOn(performance, "now").mockImplementation(() => ici);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("navigator", { getGamepads: () => [] });
  vi.stubGlobal(
    "WebSocket",
    class {
      static OPEN = 1;
      readyState = 1;
      binaryType = "";
      onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
      onclose: (() => void) | null = null;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        sockets.push(this);
      }
      send(bytes: Uint8Array) {
        envoyes.push(bytes);
      }
      close() {}
    },
  );
  envoyes.length = 0;
  sockets.length = 0;
  stream = new InputStream(
    (path) => path,
    () => {},
  );
  stream.start();
});

afterEach(() => {
  stream.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** La fenêtre prise, comme le relevé la prend. Une page d'avant n'a pas
 * `fenetre` : l'essai dit alors ce qui manque au lieu de tomber ici. */
function prendre(): Partial<ReturnType<InputStream["fenetre"]>> {
  return typeof stream.fenetre === "function" ? stream.fenetre(true) : {};
}

/** Le temps passe et les minuteurs tournent. */
function avancer(ms: number) {
  for (let fait = 0; fait < ms; fait += 1) {
    ici += 1;
    vi.advanceTimersByTime(1);
  }
}

/** Le temps passe, et AUCUN minuteur ne tourne : un fil principal bloqué. */
function bloquer(ms: number) {
  ici += ms;
}

it("lit un fil principal bloqué 150 ms dans le plus long tour de la pompe", () => {
  avancer(1000);
  bloquer(150);
  avancer(1000);
  const fenetre = prendre();
  expect(typeof fenetre.pompeMaxMs, "la fenêtre ne dit pas le tour de la pompe").toBe("number");
  expect(fenetre.pompeMaxMs).toBeGreaterThanOrEqual(150);
  expect(fenetre.pompeMaxMs).toBeLessThanOrEqual(155);
});

// Le jumeau : un fil libre fait tourner la pompe toutes les 4 ms.
it("lit quatre millisecondes quand rien ne bloque, et repart de rien après un relevé", () => {
  avancer(1000);
  bloquer(150);
  avancer(1000);
  prendre();
  avancer(2000);
  expect(prendre().pompeMaxMs).toBe(4);
});

it("ne compte pas le temps d'un onglet caché", () => {
  avancer(1000);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  try {
    // Un onglet caché ne fait tourner ses minuteurs qu'une fois par seconde.
    for (let fois = 0; fois < 3; fois++) {
      bloquer(996);
      avancer(4);
    }
  } finally {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  }
  avancer(1000);
  expect(prendre().pompeMaxMs).toBeLessThan(10);
});

/** Répond à chaque aller-retour parti, `retard(n)` millisecondes plus tard. */
function repondre(echos: number, retard: (n: number) => number) {
  for (let n = 0; n < echos; n += 1) {
    // Jusqu'au prochain départ : la page en envoie un par seconde.
    const avant = envoyes.length;
    let parti: Uint8Array | undefined;
    for (let attendu = 0; parti === undefined && attendu < 1100; attendu += 1) {
      avancer(1);
      parti = envoyes.slice(avant).find((b) => readEcho(b) !== null);
    }
    if (parti === undefined) throw new Error("précondition: aucun aller-retour n'est parti");
    const ticket = readEcho(parti);
    if (ticket === null) throw new Error("précondition: aller-retour illisible");
    avancer(retard(n));
    sockets.at(-1)?.onmessage?.({ data: askEcho(ticket).buffer });
  }
}

it("lit la queue des aller-retours de la fenêtre : p95 et max", () => {
  // Dix-huit retours rapides, et deux lents : la médiane ne les voit pas.
  repondre(20, (n) => (n === 7 || n === 13 ? 180 : 12));
  const fenetre = prendre();
  expect(fenetre.retourMs, "la fenêtre ne dit pas la queue des aller-retours").toEqual([180, 180]);
  expect(stream.state().roundTripMs).toBe(12);
});

// Nul et pas zéro : sans retour, rien n'est mesuré.
it("rend nul sans aucun retour dans la fenêtre", () => {
  repondre(3, () => 12);
  prendre();
  avancer(500);
  expect(prendre().retourMs).toBeNull();
});
