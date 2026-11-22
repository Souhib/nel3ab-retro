import { describe, expect, it, vi } from "vitest";
import type { Liaison } from "./liaison";
import { SONDE_EVERY_MS, VeilleLiaison, type Flux } from "./veille";

/** Des flux qui vont bien: un jeu tourne, les images arrivent. */
function flux(video: Partial<Flux["video"]> = {}, rest: Partial<Omit<Flux, "video">> = {}): Flux {
  return {
    video: {
      connected: true,
      sinceOpenedMs: 300_000,
      downForMs: null,
      sinceHeardMs: 16,
      sinceUnitMs: 16,
      sincePaintedMs: 16,
      painted: 1000,
      units: 1000,
      sourceHz: 60,
      sinceStartedMs: 300_000,
      awaitingRestart: false,
      ...video,
    },
    sound: { sinceChunkMs: 20 },
    input: { sinceHeardMs: 300 },
    padOnly: false,
    ...rest,
  };
}
const tombee = (coupee = 3000) =>
  flux({ connected: false, sinceOpenedMs: null, downForMs: coupee, sinceHeardMs: null });

function veille(fetch: (url: string) => Promise<Response>, horloge = { t: 1_000_000 }) {
  const v = new VeilleLiaison({
    now: () => horloge.t,
    enLigne: () => true,
    visible: () => true,
    salle: () => 1,
    fetch,
  });
  v.dire({ jeu: true, demarrageA: null, proposer: false });
  return { v, horloge };
}
const salles = (ouverte: boolean) =>
  new Response(JSON.stringify([{ numero: 1, ouverte, chemin: "/r/1/", jeu: null }]), {
    status: 200,
  });
const attendre = () => new Promise((wake) => setTimeout(wake, 0));

describe("la sonde du site", () => {
  it("ne demande rien tant que l'image arrive", async () => {
    const fetch = vi.fn().mockResolvedValue(salles(true));
    const { v } = veille(fetch);
    v.lire(flux());
    await attendre();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("demande la liste des salles dès que la vidéo tombe, et dit « fermée » si elle l'est", async () => {
    const fetch = vi.fn().mockResolvedValue(salles(false));
    const { v } = veille(fetch);
    expect(v.lire(tombee()).etat).toBe("injoignable");
    await attendre();
    expect(fetch).toHaveBeenCalledWith("/api/salles", expect.anything());
    expect(v.lire(tombee()).etat).toBe("fermee");
  });

  it("jumeau: une salle ouverte qui ne répond pas reste « injoignable », site joignable", async () => {
    const { v } = veille(vi.fn().mockResolvedValue(salles(true)));
    v.lire(tombee());
    await attendre();
    expect(v.lire(tombee())).toMatchObject({ etat: "injoignable", siteRepond: true });
  });

  it("une sonde sans réponse veut dire que rien ne répond", async () => {
    const { v } = veille(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    v.lire(tombee());
    await attendre();
    expect(v.lire(tombee())).toMatchObject({ etat: "coupee", cause: "silence" });
  });

  it("ne sonde pas plus d'une fois toutes les trois secondes", async () => {
    const fetch = vi.fn().mockResolvedValue(salles(true));
    const { v, horloge } = veille(fetch);
    for (let i = 0; i < 6; i++) {
      v.lire(tombee());
      await attendre();
      horloge.t += 500;
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    horloge.t += SONDE_EVERY_MS;
    v.lire(tombee());
    await attendre();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("oublie une réponse trop vieille plutôt que de la croire encore", async () => {
    const { v, horloge } = veille(vi.fn().mockResolvedValue(salles(false)));
    v.lire(tombee());
    await attendre();
    expect(v.lire(tombee()).etat).toBe("fermee");
    // L'image revient, puis la salle retombe une minute plus tard: la vieille
    // réponse « fermée » ne vaut plus rien.
    v.lire(flux());
    horloge.t += 60_000;
    const vu: Liaison = v.lire(tombee());
    expect(vu.etat).toBe("injoignable");
  });
});

describe("ce que la veille a vu entre deux relevés", () => {
  it("rend les états vus, puis repart de zéro", () => {
    const { v } = veille(vi.fn().mockResolvedValue(salles(true)));
    v.lire(flux());
    v.lire(flux({ sinceHeardMs: 100, sinceUnitMs: 9000, sincePaintedMs: 9000 }));
    expect([...v.prendreVus()].sort()).toEqual(["figee", "ok"]);
    expect([...v.prendreVus()]).toEqual([]);
  });
});

describe("le contexte que la page lui donne", () => {
  it("un démarrage demandé passe avant tout le reste", () => {
    const { v, horloge } = veille(vi.fn().mockResolvedValue(salles(true)));
    v.dire({ jeu: true, demarrageA: horloge.t - 4000, proposer: false });
    expect(v.lire(tombee())).toEqual({ etat: "demarrage", depuisMs: 4000 });
  });
  it("une salle sans jeu n'attend pas d'image", () => {
    const { v } = veille(vi.fn().mockResolvedValue(salles(true)));
    v.dire({ jeu: false, demarrageA: null, proposer: false });
    expect(v.lire(tombee()).etat).toBe("ok");
  });
});
