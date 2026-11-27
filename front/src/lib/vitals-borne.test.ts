/**
 * Le relevé le plus long que la page puisse écrire tient dans la borne du
 * salon.
 *
 * Le salon refuse un relevé de plus de 2 048 caractères, comptés sur
 * `json.dumps(relevé, ensure_ascii=False)` (`VITALS_MAX`,
 * control/nel3ab_control/api/ws/handlers.py). Un relevé refusé n'est pas
 * écrit : la fenêtre se perd sans un mot, et ce serait la plus chargée, celle
 * d'un long gel ou d'une manette au nom bizarre. Le 27 novembre 2026, le relevé
 * gagne une quinzaine de champs (VID-4, VID-5, SON-4) : cet essai les compte
 * tous, au pire.
 *
 * # Comment « au pire » est construit
 *
 * Le relevé vient de la vraie fonction `vitals`, nourrie d'un instantané où
 * tout est mesuré : aucune valeur nulle, chaque champ facultatif présent. Puis
 * chaque nombre est remplacé par -99 999 999, neuf caractères : plus de
 * vingt-sept heures en millisecondes, ou cent millions d'images. Les chaînes
 * viennent d'entrées hostiles que `vitals` doit couper et nettoyer elle-même.
 * Une chaîne nouvelle sans borne connue fait échouer l'essai.
 */
import { describe, expect, it } from "vitest";
import type { Fenetre, Snapshot } from "../media/session";
import { DEBLOQUE_MAX, PAD_NAME_MAX, controle, vitals } from "./vitals";

/** La borne du salon, `VITALS_MAX`. */
const VITALS_MAX = 2048;

/** Le nombre le plus long qu'on admet dans un relevé : neuf caractères. */
const NOMBRE_PIRE = -99_999_999;

/** Ce que `json.dumps(valeur, ensure_ascii=False)` écrit, en caractères.
 *
 * Python sépare par « , » et « : », avec une espace, là où `JSON.stringify`
 * n'en met pas. Une chaîne s'échappe pareil des deux côtés pour ce qui compte
 * ici (guillemet, barre oblique inverse, caractères de contrôle). Vérifié le
 * 27 novembre 2026 contre `python3 -c 'import json,sys;
 * print(len(json.dumps(json.load(sys.stdin), ensure_ascii=False)))'` sur le
 * relevé au pire de cet essai : même nombre. */
export function longueurPython(valeur: unknown): number {
  if (valeur === null) return 4;
  if (typeof valeur === "boolean") return valeur ? 4 : 5;
  if (typeof valeur === "number") return JSON.stringify(valeur).length;
  if (typeof valeur === "string") return JSON.stringify(valeur).length;
  if (Array.isArray(valeur))
    return (
      2 +
      valeur.reduce<number>((n, une) => n + longueurPython(une), 0) +
      2 * Math.max(0, valeur.length - 1)
    );
  if (typeof valeur === "object") {
    const champs = Object.entries(valeur).filter(([, v]) => v !== undefined);
    return (
      2 +
      champs.reduce((n, [cle, v]) => n + JSON.stringify(cle).length + 2 + longueurPython(v), 0) +
      2 * Math.max(0, champs.length - 1)
    );
  }
  throw new Error(`valeur imprévue dans un relevé: ${String(valeur)}`);
}

/** Les chaînes du relevé et la plus longue que chacune peut porter. Une
 * chaîne absente de cette liste fait échouer l'essai : elle doit dire sa
 * borne avant de partir au salon. */
const CHAINES: Record<string, (vue: string) => string> = {
  // `vitals` les reçoit d'entrées hostiles ci-dessous : on garde ce qu'elle
  // en a fait, qui est ce qui part au salon.
  modèle: (vue) => vue,
  débloqué: (vue) => vue,
  // Deux nombres de cinq chiffres.
  format: () => "99999x99999",
  // L'état d'un `AudioContext`, ou « coupé » : « interrupted » est le plus long.
  état: () => "interrupted",
  marge: () => "ancienne",
};

/** Remplace chaque nombre par le pire, et chaque chaîne par sa plus longue.
 * Rend aussi les chemins des valeurs nulles, qui ne compteraient pas leur
 * forme mesurée. */
function auPire(valeur: unknown, chemin: string, nuls: string[], cle = ""): unknown {
  if (valeur === null) {
    nuls.push(chemin);
    return null;
  }
  if (typeof valeur === "number") return NOMBRE_PIRE;
  if (typeof valeur === "string") {
    const pire = CHAINES[cle];
    if (pire === undefined) throw new Error(`chaîne sans borne connue: ${chemin}`);
    return pire(valeur);
  }
  if (Array.isArray(valeur))
    return valeur.map((une, i) => auPire(une, `${chemin}[${i}]`, nuls, cle));
  if (typeof valeur === "object")
    return Object.fromEntries(
      Object.entries(valeur as Record<string, unknown>).map(([k, v]) => [
        k,
        auPire(v, `${chemin}.${k}`, nuls, k),
      ]),
    );
  return valeur;
}

/** Un instantané où tout est mesuré, avec des chaînes hostiles. */
function toutMesure(): Snapshot {
  const hostile = '"\\\u0001'.repeat(200);
  return {
    video: {
      painted: 1,
      fastestLag: 1,
      shown: 1,
      undecoded: 1,
      stalls: 1,
      restarts: 1,
      overloaded: true,
      keyFramesAsked: 1,
      slackMs: 1,
      starved: 1,
      skipped: 1,
      caughtUp: 1,
      overflowed: 1,
      marge: "ancienne",
      connected: true,
      reconnects: 1,
      paintedSince: 1,
      awaitingRestart: true,
      heldRefreshes: { p05: 1, p50: 1, p95: 1 },
      waitMs: { p50: 1, p95: 1 },
      gapMs: { p50: 1, p95: 1, max: 1 },
      jitterMs: 1,
      room: 1,
      picture: { width: 99_999, height: 99_999 },
      dark: true,
      probeMs: { p50: 1, p95: 1, max: 1 },
      half: true,
      halfDenied: true,
      sourceHz: 1,
      sinceArrivalMs: 1,
      sinceHeardMs: 1,
      sinceUnitMs: 1,
      units: 1,
      sincePaintedMs: 1,
      sinceOpenedMs: 1,
      downForMs: 1,
      sinceStartedMs: 1,
      refreshHz: 1,
      backlog: 1,
      addedMs: 1,
    },
    sound: {
      state: "interrupted",
      unlocked: `refusé: ${hostile}`,
      gain: 1,
      output: 1,
      chunks: 1,
      sinceChunkMs: 1,
      gaps: 1,
      playedSeconds: 1,
      leadMs: 1,
      sampleRate: 1,
      outputMs: 1,
      browserMs: 1,
    },
    input: {
      port: 1,
      watching: false,
      refused: false,
      sent: 1,
      padId: hostile,
      padLayout: "standard",
      learning: null,
      lesson: null,
      lessonResult: null,
      suspendu: null,
      neutre: null,
      activite: { suivies: new Set(), actives: new Set() },
      pressed: [],
      displaced: false,
      players: 4,
      busy: [true, false, false, false],
      mics: [false, false, false, false],
      deciding: false,
      closingIn: 0,
      capturing: null,
      profile: null,
      keys: {} as Snapshot["input"]["keys"],
      keyProfiles: ["défaut"],
      keyProfile: "défaut",
      lockedProfiles: [],
      pads: [],
      using: null,
      roundTripMs: 1,
      sinceHeardMs: 1,
    },
    soundGapMs: 1,
    soundSyncMs: 1,
    mic: "off",
    liaison: { etat: "ok" },
    couvertureVue: 0,
  } as Snapshot;
}

/** Une fenêtre où tout a été mesuré. */
const FENETRE_PLEINE: Fenetre = {
  video: {
    arretMs: 1,
    ecranMaxMs: 1,
    ecarts: { plus100: 1, pireMs: 1, ilYaMs: 1 },
    sejourMs: [1, 1],
  },
  input: { retourMs: [1, 1], pompeMaxMs: 1 },
};

function releveAuPire() {
  const now = toutMesure();
  const sample = vitals(
    now,
    toutMesure(),
    10_000,
    { visible: false, cachéeMs: 1 },
    true,
    FENETRE_PLEINE,
  );
  const nuls: string[] = [];
  const pire = auPire(sample, "relevé", nuls);
  return { sample, pire, nuls };
}

describe("le relevé le plus long", () => {
  it("n'a aucun champ nul : chaque champ compte sa forme mesurée", () => {
    expect(releveAuPire().nuls).toEqual([]);
  });

  it("tient dans les 2 048 caractères du salon", () => {
    const { pire } = releveAuPire();
    const longueur = longueurPython(pire);
    expect(longueur, JSON.stringify(pire)).toBeLessThanOrEqual(VITALS_MAX);
  });

  it("coupe et nettoie les chaînes venues du navigateur", () => {
    const { sample } = releveAuPire();
    // Un caractère de contrôle s'écrit en six caractères (\u0001) : `vitals`
    // les retire, et ne garde que la longueur permise.
    expect([...(sample.manette.modèle ?? "")].filter(controle)).toEqual([]);
    expect(sample.manette.modèle?.length).toBeLessThanOrEqual(PAD_NAME_MAX);
    expect([...sample.son.débloqué].filter(controle)).toEqual([]);
    expect(sample.son.débloqué.length).toBeLessThanOrEqual(DEBLOQUE_MAX);
  });

  // Le jumeau : la mesure de longueur voit bien un relevé trop long. Sans lui,
  // une fonction qui rendrait toujours zéro passerait l'essai d'au-dessus.
  it("voit un relevé trop long quand il l'est", () => {
    const { pire } = releveAuPire();
    const gonfle = { ...(pire as object), ajout: "x".repeat(VITALS_MAX) };
    expect(longueurPython(gonfle)).toBeGreaterThan(VITALS_MAX);
    // Et la forme de Python, pas celle de `JSON.stringify` : deux caractères
    // de plus par séparateur.
    expect(longueurPython({ a: [1, 2] })).toBe('{"a": [1, 2]}'.length);
  });
});
