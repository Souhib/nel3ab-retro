/**
 * La marge contre la gigue, à travers la vraie `VideoStream` (VID-1, DON-1).
 *
 * Le 26 novembre 2026, chez un joueur distant, la marge est restée au
 * plancher pendant quatre minutes et vingt et une secondes, avec près de deux
 * famines et deux images jetées par seconde, sur une capture régulière. La
 * cause était dans l'appelant de `nextSlack` : le débordement de la file
 * (l'horaire est trop TARD) et le rattrapage d'une image en retard (l'horaire
 * est trop TÔT) incrémentaient le même compteur, et un seul jet interdisait à
 * la marge de grandir.
 *
 * La décision du propriétaire, le 27 novembre 2026 : « lisse, retard
 * plafonné ». La marge grandit sur des rafales, mais ce que la correction
 * ajoute s'arrête à trente millisecondes au-dessus de la marge de départ.
 * L'ancien comportement exact reste derrière `?marge=ancienne`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATCHUP_SLACK_MAX, SLACK_FLOOR, SLACK_START } from "./clock";
import {
  SOURCE_MS,
  doublures,
  rafales,
  reguliere,
  rejouer,
  type Arrivee,
} from "../test/banc-video";
import { VideoStream } from "./video";

let etat: ReturnType<typeof doublures>;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  etat = doublures();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Ce que le test dit en échouant : la marge, l'horaire et les famines, pour
 * qu'un rouge se lise sans relancer. */
function resume(r: ReturnType<typeof rejouer>): string {
  return JSON.stringify({
    margeMax: r.margeMax,
    marge: r.fin.slackMs,
    horaire: r.fin.addedMs,
    gigue: Math.round(r.fin.jitterMs),
    affamees: r.fin.starved,
    arretMax: Math.round(r.arretMax),
    jetees: r.fin.skipped,
    rattrapage: r.fin.caughtUp,
    debordement: r.fin.overflowed,
  });
}

describe("des rafales d'images sur un écran 120 Hz", () => {
  // La forme demandée par le plan du 27 novembre 2026 : rAF à 8,33 ms, source
  // à 60 images par seconde, chaque seconde 8 images retenues 130 ms puis
  // livrées ensemble, 30 secondes simulées.
  const scenario = { ecranMs: 1000 / 120, secondes: 30, arrivees: rafales(30, 130) };

  it("font grandir la marge au-dessus de son départ, sans dépasser le plafond choisi", () => {
    const r = rejouer(etat, scenario);
    // La précondition : le scénario affame vraiment la page. Sans elle, une
    // marge restée au départ ne dirait rien.
    expect(r.fin.starved, resume(r)).toBeGreaterThan(20);
    expect(
      r.margeMax,
      `la marge n'a pas dépassé sa valeur de départ: ${resume(r)}`,
    ).toBeGreaterThan(SLACK_START);
    expect(r.margeMax, resume(r)).toBeLessThanOrEqual(CATCHUP_SLACK_MAX);
    // Les rafales ne font pas déborder la file : ce sont des rattrapages.
    expect(r.fin.overflowed, resume(r)).toBe(0);
    expect(r.fin.caughtUp, resume(r)).toBeGreaterThan(0);
    // L'allure ne renonce pas : une liaison irrégulière n'est pas étroite.
    expect(r.renonce, resume(r)).toBeNull();
  });

  it("gardent la marge au départ sous `?marge=ancienne`, comme avant le 27 novembre", () => {
    // Le bras témoin de la comparaison à l'aveugle chez le propriétaire : il
    // doit montrer le défaut, sinon la soirée ne compare rien.
    const r = rejouer(etat, { ...scenario, marge: "ancienne" });
    expect(r.fin.starved, resume(r)).toBeGreaterThan(20);
    expect(r.margeMax, resume(r)).toBeLessThanOrEqual(SLACK_START);
  });

  it("montrent un arrêt plus court et moins de sauts qu'avec l'ancienne marge", () => {
    // Les famines comptent des ÉPISODES (VID-4) : un arrêt de 130 ms en reste
    // un, raccourci ou non. Ce qui se voit est la durée de l'arrêt au verre et
    // le nombre d'images sautées.
    const nouvelle = rejouer(etat, scenario);
    etat = doublures();
    const ancienne = rejouer(etat, { ...scenario, marge: "ancienne" });
    const dit = `${resume(nouvelle)} contre ${resume(ancienne)}`;
    expect(nouvelle.arretMax, dit).toBeLessThan(ancienne.arretMax);
    expect(nouvelle.fin.skipped, dit).toBeLessThan(ancienne.fin.skipped);
    // Et le prix, borné : l'horaire monte d'au plus ce que la marge a pris.
    expect(nouvelle.fin.addedMs - ancienne.fin.addedMs, dit).toBeLessThanOrEqual(
      CATCHUP_SLACK_MAX - 3,
    );
  });
});

describe("le jumeau du 17 août 2026 : une file qui déborde", () => {
  // Une retenue de 450 ms une fois par seconde livre vingt-sept images d'un
  // coup, plus que la file n'en tient : elle déborde, l'horaire est trop TARD
  // pour elle, et grandir ne ferait que l'aggraver.
  const scenario = { ecranMs: 1000 / 120, secondes: 30, arrivees: rafales(30, 450) };

  it("ne fait pas grandir la marge, même affamée", () => {
    const r = rejouer(etat, scenario);
    expect(r.fin.overflowed, `précondition: la file doit déborder: ${resume(r)}`).toBeGreaterThan(
      0,
    );
    expect(r.fin.starved, resume(r)).toBeGreaterThan(20);
    expect(r.margeMax, resume(r)).toBeLessThanOrEqual(SLACK_START);
  });
});

describe("le jumeau d'un écran qui bloque : des rattrapages sans famine", () => {
  // Un fil principal arrêté 64 ms une fois par seconde (l'essai du
  // 8 septembre 2026) : des images arrivent à l'heure pendant l'arrêt, et le
  // tic suivant rattrape. Rien n'a manqué à la liaison.
  const ticSaute = (instant: number) => instant % 1000 >= 300 && instant % 1000 < 364;
  const scenario = { ecranMs: 1000 / 120, secondes: 20, arrivees: reguliere(20), ticSaute };

  /** Les famines après la première fenêtre : la première compte le
   * démarrage, où la cadence de la source n'est pas encore mesurée. */
  const famines = (r: ReturnType<typeof rejouer>) => r.fin.starved - r.releves[0].stats.starved;

  it("laisse la marge redescendre au plancher", () => {
    const r = rejouer(etat, scenario);
    expect(r.fin.caughtUp, `précondition: il faut des rattrapages: ${resume(r)}`).toBeGreaterThan(
      10,
    );
    expect(famines(r), resume(r)).toBe(0);
    expect(r.fin.slackMs, resume(r)).toBe(SLACK_FLOOR);
  });

  it("et la gardait figée avant, sous `?marge=ancienne`", () => {
    const r = rejouer(etat, { ...scenario, marge: "ancienne" });
    expect(r.fin.caughtUp + r.fin.overflowed, resume(r)).toBeGreaterThan(10);
    expect(famines(r), resume(r)).toBe(0);
    const figee = r.releves[0].stats.slackMs;
    expect(figee, resume(r)).toBeGreaterThan(SLACK_FLOOR);
    expect(
      r.releves.map((un) => un.stats.slackMs),
      resume(r),
    ).toEqual(r.releves.map(() => figee));
  });
});

/**
 * Un lien trop étroit, l'équivalent de `slowlink.mjs` en temps simulé.
 *
 * `slowlink.mjs` passe par un vrai worker sur les ports de la machine, qu'un
 * essai n'a pas le droit de toucher. Le modèle reprend son relais
 * (`throttle.mjs`) : un seau à jetons dont le débit oscille de ±90 % sur
 * 700 ms, avec un quart de seconde de rafale. Le worker garde huit images par
 * spectateur et jette les suivantes, comme sa file bornée.
 */
function lienEtroit(secondes: number, megabits: number, fluxMegabits: number): Arrivee[] {
  const octetsParImage = (fluxMegabits * 1e6) / 8 / 60;
  const debit = (megabits * 1e6) / 8 / 1000; // octets par ms
  const images: Arrivee[] = [];
  let jetons = 0;
  let enFile: { capture: number; reste: number }[] = [];
  let k = 0;
  for (let t = 0; t <= secondes * 1000; t += 1) {
    while (k * SOURCE_MS <= t) {
      const taille = k % 60 === 0 ? octetsParImage * 5 : octetsParImage;
      if (enFile.length < 8) enFile.push({ capture: k * SOURCE_MS, reste: taille });
      k += 1;
    }
    const phase = ((t % 700) / 700) * 2 * Math.PI;
    jetons = Math.min(jetons + debit * (1 + 0.9 * Math.sin(phase)), debit * 250);
    while (enFile.length > 0 && jetons > 0) {
      const tete = enFile[0];
      const pris = Math.min(jetons, tete.reste);
      tete.reste -= pris;
      jetons -= pris;
      if (tete.reste > 0) break;
      images.push({ capture: tete.capture, arrivee: t + 20 });
      enFile = enFile.slice(1);
    }
  }
  return images;
}

describe("le basculement en demi-format sur un lien trop étroit", () => {
  // Ce que le propriétaire a demandé de garder : `overloaded` (la marge au
  // plafond cinq fenêtres d'affilée) bascule la page seule en demi-format
  // (App.tsx). La correction ne doit ni le faire naître ni le faire taire.
  // 2, 4 et 6 Mbit/s renoncent aujourd'hui (à 54 et 90 s) ; 7 et 8 non.
  for (const megabits of [2, 4, 6, 7, 8]) {
    it(`renonce de la même façon qu'avant à ${megabits} Mbit/s pour un flux de 8`, () => {
      const scenario = {
        ecranMs: 1000 / 60,
        secondes: 120,
        arrivees: lienEtroit(120, megabits, 8),
      };
      const nouvelle = rejouer(etat, scenario);
      etat = doublures();
      const ancienne = rejouer(etat, { ...scenario, marge: "ancienne" });
      const dit = `nouvelle ${resume(nouvelle)} renonce à ${nouvelle.renonce}, ancienne ${resume(ancienne)} renonce à ${ancienne.renonce}`;
      expect(nouvelle.renonce === null, dit).toBe(ancienne.renonce === null);
      if (nouvelle.renonce !== null && ancienne.renonce !== null)
        // Mesuré en simulation le 27 novembre 2026 : 54 s contre 54 s à 2 et
        // 4 Mbit/s, 84 s contre 90 s à 6. L'écart vient des entrées, pas de la
        // règle : la page voit d'autres jets quand sa marge a grandi.
        expect(Math.abs(nouvelle.renonce - ancienne.renonce), dit).toBeLessThanOrEqual(6_000);
    });
  }
});

describe("la règle que l'adresse de la page demande", () => {
  // Le câblage, pas seulement la fonction : la session construit la vidéo sans
  // option, et c'est l'adresse qui doit décider (`margeDeLAdresse`).
  afterEach(() => history.replaceState(null, "", "/"));

  it("prend l'ancienne règle sous `?marge=ancienne`", () => {
    history.replaceState(null, "", "/r/1/?entrer=jouer&marge=ancienne");
    const video = new VideoStream(document.createElement("canvas"), (p) => p);
    expect(video.stats().marge).toBe("ancienne");
  });

  it("et la nouvelle sans le paramètre", () => {
    history.replaceState(null, "", "/r/1/?entrer=jouer");
    const video = new VideoStream(document.createElement("canvas"), (p) => p);
    expect(video.stats().marge).toBe("lisse");
  });
});
