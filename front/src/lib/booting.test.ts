import { describe, expect, it } from "vitest";
import {
  ATTENTE_LONGUE_S,
  attenteDemarrage,
  bootingStep,
  dureeSansImage,
  etapesAffichees,
  gestesDuChargement,
  habitudeMesuree,
  seuilLong,
  soireeDe,
  versionDuChargement,
  PLAFOND_CHARGEMENT_MS,
  STEPS,
  suiteDuChargement,
  type Live,
} from "./booting";

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

describe("l'attente d'un démarrage, dite comme l'écran la montre", () => {
  it("devient longue à vingt secondes, pas avant", () => {
    expect(attenteDemarrage(ATTENTE_LONGUE_S, false)).toBe("long");
    expect(attenteDemarrage(ATTENTE_LONGUE_S - 1, false)).toBeUndefined();
  });
  it("perdue dès que la page a cessé d'attendre, quelle que soit la durée", () => {
    expect(attenteDemarrage(3, true)).toBe("echec");
  });
});

describe("ce que devient un chargement", () => {
  const NOIR: Live = { connected: true, awaitingRestart: true, paintedSince: 0, dark: true };
  const PEINT: Live = { connected: true, awaitingRestart: false, paintedSince: 60, dark: false };
  const SUR_MARIO = {
    depuisMs: 2_000,
    cale: false,
    image: NOIR,
  };

  it("s'efface quand le nouveau jeu peint, comme l'étape « première image »", () => {
    expect(suiteDuChargement({ ...SUR_MARIO, image: PEINT })).toBe("effacer");
    // Le jumeau: le même jeu annoncé par la salle ne suffit pas à une page
    // qui montre l'image; elle attend de la voir.
    expect(suiteDuChargement(SUR_MARIO)).toBe("attendre");
  });

  it("cesse d'attendre au plafond, une seule fois", () => {
    const tard = { ...SUR_MARIO, depuisMs: PLAFOND_CHARGEMENT_MS + 1 };
    expect(suiteDuChargement(tard)).toBe("caler");
    expect(suiteDuChargement({ ...tard, cale: true })).toBe("attendre");
    expect(suiteDuChargement({ ...tard, depuisMs: PLAFOND_CHARGEMENT_MS - 1 })).toBe("attendre");
  });
});

describe("l'habitude d'un jeu (D05)", () => {
  const h = { mediane_s: 12, p90_s: 17.2, n: 6 };

  it("le seuil d'une attente longue suit le 90e centile mesuré", () => {
    expect(seuilLong(h)).toBe(18);
    expect(attenteDemarrage(18, false, seuilLong(h))).toBe("long");
    expect(attenteDemarrage(17, false, seuilLong(h))).toBeUndefined();
  });

  it("sans habitude mesurée, les vingt secondes d'avant", () => {
    expect(seuilLong(null)).toBe(ATTENTE_LONGUE_S);
    expect(seuilLong(undefined)).toBe(ATTENTE_LONGUE_S);
    // Moins de cinq démarrages : la page ne dit pas « d'habitude ».
    expect(habitudeMesuree({ ...h, n: 4 })).toBeNull();
    expect(seuilLong({ ...h, n: 4 })).toBe(ATTENTE_LONGUE_S);
    // Des durées illisibles ne valent pas une mesure.
    expect(habitudeMesuree({ ...h, mediane_s: 0 })).toBeNull();
    expect(habitudeMesuree({ ...h, p90_s: 10 })).toBeNull();
    expect(habitudeMesuree({ ...h, n: 5 })).toEqual({ ...h, n: 5 });
  });
});

describe("la version de la scène « chercher » (C11)", () => {
  it("complète au premier chargement de la soirée, courte ensuite", () => {
    const soir = new Date(2026, 10, 24, 21, 0);
    expect(versionDuChargement(null, soir)).toBe("complete");
    expect(versionDuChargement(soireeDe(soir), soir)).toBe("courte");
    // La nuit continue la soirée de la veille ; le lendemain soir, non.
    expect(versionDuChargement(soireeDe(soir), new Date(2026, 10, 25, 2, 0))).toBe("courte");
    expect(versionDuChargement(soireeDe(soir), new Date(2026, 10, 25, 20, 0))).toBe("complete");
  });
});

describe("les cases du chargement (C4)", () => {
  it("rend ce que la page sait, une case par étape", () => {
    expect(etapesAffichees("asked", undefined)).toEqual(["en-cours", "a-venir", "a-venir"]);
    expect(etapesAffichees("waiting", undefined)).toEqual(["faite", "en-cours", "a-venir"]);
    // Une attente longue ne sait plus si l'étape avance : un point d'interrogation.
    expect(etapesAffichees("waiting", "long")).toEqual(["faite", "inconnue", "a-venir"]);
    expect(etapesAffichees("asked", "long")).toEqual(["inconnue", "a-venir", "a-venir"]);
    // Calé : la première image est un échec, et ce qui la précède n'est pas su.
    expect(etapesAffichees("waiting", "echec")).toEqual(["faite", "inconnue", "echec"]);
    expect(etapesAffichees("asked", "echec")).toEqual(["inconnue", "inconnue", "echec"]);
  });

  it("la première image fait les trois cases, et aucune case ne recule", () => {
    expect(etapesAffichees("painting", undefined)).toEqual(["faite", "faite", "faite"]);
    expect(etapesAffichees("painting", "echec")).toEqual(["faite", "faite", "faite"]);
    // Le jumeau : chaque case faite d'une étape reste faite à l'étape suivante.
    for (const attente of [undefined, "long", "echec"] as const) {
      const faites = STEPS.map(
        (step) => etapesAffichees(step, attente).filter((c) => c === "faite").length,
      );
      expect(faites).toEqual([...faites].sort((a, b) => a - b));
    }
  });
});

describe("la durée sans image (C4)", () => {
  it("se dit en minutes et secondes passé la minute", () => {
    expect(dureeSansImage(92)).toBe("1 min 32");
    expect(dureeSansImage(60)).toBe("1 min 00");
    expect(dureeSansImage(45)).toBe("45 s");
  });
});

describe("les gestes du chargement, par rôle (C7a)", () => {
  it("rien tant que l'attente est normale", () => {
    expect(gestesDuChargement(undefined, true)).toEqual([]);
    expect(gestesDuChargement(undefined, false)).toEqual([]);
  });

  it("plus long : qui choisit peut arrêter le lancement, tous signalent", () => {
    expect(gestesDuChargement("long", true)).toEqual(["arreter", "signaler"]);
    expect(gestesDuChargement("long", false)).toEqual(["signaler"]);
  });

  it("aucune image : qui choisit choisit un autre jeu ; les autres signalent", () => {
    expect(gestesDuChargement("echec", true)).toEqual(["autre", "signaler"]);
    expect(gestesDuChargement("echec", false)).toEqual(["signaler"]);
  });
});
