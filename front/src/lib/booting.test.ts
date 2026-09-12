import { expect, it } from "vitest";
import { bootingStep, STEPS, type Live } from "./booting";

/** Le déroulé RÉEL d'un changement de jeu, lu dans `media/video.ts`.
 *
 * Les quatre états sont ceux que la page traverse vraiment: le clic pose
 * `awaiting` alors que la socket vit encore (video.ts, `expectRestart`), puis
 * `onclose` remet `connected` ET `awaiting` à faux, puis le flux revient et
 * peint du noir, et enfin la première vraie image arrive. */
const DEROULE: { quand: string; live: Live }[] = [
  {
    quand: "au clic",
    live: { connected: true, awaitingRestart: true, paintedSince: 0, dark: true },
  },
  {
    quand: "la socket tombe",
    live: { connected: false, awaitingRestart: false, paintedSince: 0, dark: true },
  },
  {
    quand: "le flux revient, encore noir",
    live: { connected: true, awaitingRestart: false, paintedSince: 5, dark: true },
  },
  {
    quand: "première vraie image",
    live: { connected: true, awaitingRestart: false, paintedSince: 40, dark: false },
  },
];

it("l'étape ne recule jamais pendant un changement de jeu", () => {
  let atteint = -1;
  for (const { quand, live } of DEROULE) {
    const rang = STEPS.indexOf(bootingStep(live));
    expect(rang, `l'étape a reculé ${quand}`).toBeGreaterThanOrEqual(atteint);
    atteint = rang;
  }
});

it("« première image » s'allume exactement quand l'écran se retire, pas avant", () => {
  // La condition qui retire l'écran, dans App.tsx: peint plus de 30 images
  // depuis la reconnexion ET l'image n'est plus noire.
  const noir: Live = { connected: true, awaitingRestart: false, paintedSince: 5, dark: true };
  expect(bootingStep(noir)).not.toBe("painting");
  expect(bootingStep({ ...noir, paintedSince: 40 })).not.toBe("painting");
  expect(bootingStep({ ...noir, paintedSince: 40, dark: false })).toBe("painting");
});

it("la demande reste « envoyée » tant que la socket n'est pas tombée", () => {
  expect(bootingStep(DEROULE[0]!.live)).toBe("asked");
  // Le jumeau négatif: une socket vivante SANS demande en cours n'est pas une
  // demande envoyée, sinon l'étape 1 se rallumerait à chaque hoquet.
  expect(bootingStep({ ...DEROULE[0]!.live, awaitingRestart: false })).not.toBe("asked");
});
